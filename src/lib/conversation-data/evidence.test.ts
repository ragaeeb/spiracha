import { describe, expect, it } from 'bun:test';
import { buildEvidenceEpisodes } from './evidence-episodes';
import { buildEvidenceEvents } from './evidence-events';
import { matchEvidenceEvent, parseShellInvocation, validateEvidenceLens } from './evidence-lens';
import { buildEvidenceExport } from './evidence-markdown';
import { createEvidenceProjectionState, projectEvidenceText } from './evidence-projector';
import type {
    ConversationDetail,
    ConversationMessage,
    ConversationSource,
    ConversationToolEvidence,
    EvidenceLens,
} from './types';

const lens: EvidenceLens = {
    anchors: [
        { executables: ['bun'], kind: 'shell-command', subcommands: ['test'] },
        { kind: 'tool', namespaces: ['workspace'] },
        { globs: ['reports/**/*.json'], kind: 'artifact' },
        { kind: 'schema', prefixes: ['evidence/'] },
        { globs: ['/repo/**'], kind: 'cwd' },
        { kind: 'text', literals: ['repair guidance'] },
    ],
    budget: {
        commentaryCharactersPerEpisode: 500,
        failedOutputCharacters: 1_000,
        successfulOutputCharacters: 300,
        totalCharacters: 8_000,
    },
    context: {
        commentaryAfter: 2,
        commentaryBefore: 2,
        followRetries: true,
        followWorkarounds: true,
        includeReasoningSummaries: true,
        maxOrderGap: 8,
    },
    name: 'Generic CLI evidence',
};

const tool = (overrides: Partial<ConversationToolEvidence> = {}): ConversationToolEvidence => ({
    callId: 'call-1',
    command: 'bun test src/widget.test.ts',
    durationMs: 42,
    exitCode: 1,
    inputText: '{"command":"bun test src/widget.test.ts"}',
    name: 'exec',
    namespace: 'workspace',
    outputText: null,
    status: 'failed',
    workdir: '/repo',
    ...overrides,
});

const message = (
    order: number,
    phase: ConversationMessage['phase'],
    text: string,
    toolEvidence: ConversationToolEvidence | null = null,
): ConversationMessage => ({
    createdAtMs: order,
    id: `message-${order}`,
    metadata: {},
    order,
    phase,
    role: phase.startsWith('tool_') ? 'tool' : 'assistant',
    text,
    toolEvidence,
});

const conversation = (source: ConversationSource = 'codex'): ConversationDetail => ({
    createdAtMs: 1,
    deepLinks: { native: null, spiracha: `spiracha://conversation/${source}/conversation-1`, ui: '/conversation-1' },
    id: 'conversation-1',
    matches: [],
    messageCount: 5,
    messages: [
        message(0, 'commentary', 'I will run the focused check.'),
        message(1, 'tool_call', 'bun test src/widget.test.ts', tool()),
        message(
            2,
            'tool_output',
            'ERROR: repair guidance\n```nested```',
            tool({ outputText: 'ERROR: repair guidance\n```nested```' }),
        ),
        message(3, 'commentary', 'The failure requires a config workaround.'),
        message(
            4,
            'tool_call',
            'bun test src/widget.test.ts',
            tool({ callId: 'call-2', inputText: '{"command":"bun test src/widget.test.ts","retry":true}' }),
        ),
        message(
            5,
            'tool_output',
            '{"status":"ok","items":[1,2,3,4,5]}',
            tool({
                callId: 'call-2',
                exitCode: 0,
                outputText: '{"status":"ok","items":[1,2,3,4,5]}',
                status: 'succeeded',
            }),
        ),
    ],
    metadata: { schemaVersion: 'evidence/v1' },
    source,
    title: 'Widget repair',
    updatedAtMs: 2,
    workspaceKey: 'folder:/repo',
    workspacePath: '/repo',
});

describe('focused evidence', () => {
    it('should validate bounded lenses and reject unknown or unsafe fields with a precise path', () => {
        expect(validateEvidenceLens(lens)).toEqual({ ok: true, value: lens });
        expect(validateEvidenceLens({ ...lens, typo: true })).toEqual({
            error: { message: 'Unknown field.', path: 'typo' },
            ok: false,
        });
        expect(
            validateEvidenceLens({ ...lens, anchors: [{ globs: ['**/**/**/**/**/**/**/**/**/**'], kind: 'cwd' }] }),
        ).toEqual({
            error: { message: 'Glob is too complex.', path: 'anchors[0].globs[0]' },
            ok: false,
        });
        expect(validateEvidenceLens({ ...lens, name: 'Evidence\n## injected' })).toEqual({
            error: {
                message: 'Expected a non-empty name up to 120 characters without control characters.',
                path: 'name',
            },
            ok: false,
        });
    });

    it('should parse shell invocations without matching comments or output substrings', () => {
        expect(parseShellInvocation('FOO=1 bun test src/a.test.ts')).toEqual({ executable: 'bun', subcommand: 'test' });
        expect(parseShellInvocation('rtk bun run lint')).toEqual({ executable: 'bun', subcommand: 'run' });
        expect(parseShellInvocation('# bun test')).toBeNull();
    });

    it('should match every anchor kind with AND semantics inside an anchor', () => {
        const [event] = buildEvidenceEvents(conversation());
        expect(event).toBeDefined();
        expect(matchEvidenceEvent(event!, lens.anchors[0]!)).toBe(false);
        const call = buildEvidenceEvents(conversation())[1]!;
        expect(matchEvidenceEvent(call, { kind: 'tool', names: ['exec'], namespaces: ['workspace'] })).toBe(true);
        expect(matchEvidenceEvent(call, { kind: 'tool', names: ['read'], namespaces: ['workspace'] })).toBe(false);
        expect(matchEvidenceEvent(call, { executables: ['bun'], kind: 'shell-command', subcommands: ['test'] })).toBe(
            true,
        );
        expect(matchEvidenceEvent(call, { globs: ['/repo/**'], kind: 'cwd' })).toBe(true);
        expect(matchEvidenceEvent(call, { kind: 'schema', prefixes: ['evidence/'] })).toBe(true);
        expect(matchEvidenceEvent(call, { kind: 'schema', prefixes: ['other/'] })).toBe(false);
        expect(matchEvidenceEvent(call, { kind: 'text', literals: ['widget.test'] })).toBe(true);
    });

    it('should pair by call id, use explicit ordered fallback, merge retries, and preserve source order', () => {
        const exactEpisodes = buildEvidenceEpisodes(buildEvidenceEvents(conversation()), lens);
        expect(exactEpisodes).toHaveLength(1);
        expect(exactEpisodes[0]?.outcome).toBe('succeeded');
        expect(exactEpisodes[0]?.events.map((event) => event.order)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(exactEpisodes[0]?.events.find((event) => event.phase === 'tool_output')?.pairingConfidence).toBe(
            'exact',
        );

        const fallbackConversation = conversation('kiro');
        fallbackConversation.messages = fallbackConversation.messages.slice(0, 3).map((entry) => ({
            ...entry,
            toolEvidence: entry.toolEvidence ? { ...entry.toolEvidence, callId: null } : null,
        }));
        const fallbackEpisodes = buildEvidenceEpisodes(buildEvidenceEvents(fallbackConversation), lens);
        expect(fallbackEpisodes[0]?.events.at(-1)?.pairingConfidence).toBe('ordered_fallback');
    });

    it('should omit mechanical progress while following configured linked tool activity', () => {
        const input = conversation();
        input.messages[3] = message(3, 'commentary', 'Waiting for the command to complete.');
        input.messages.splice(
            4,
            0,
            message(4, 'tool_call', 'workspace repair', tool({ callId: 'call-3', name: 'repair' })),
            message(
                5,
                'tool_output',
                'repair complete',
                tool({ callId: 'call-3', name: 'repair', outputText: 'repair complete', status: 'succeeded' }),
            ),
        );

        const [episode] = buildEvidenceEpisodes(buildEvidenceEvents(input), lens);
        expect(episode?.events.map((event) => event.text)).not.toContain('Waiting for the command to complete.');
        expect(episode?.events.some((event) => event.tool?.callId === 'call-3')).toBe(true);
    });

    it('should produce the same semantic episode for every supported source', () => {
        const sources: ConversationSource[] = [
            'codex',
            'claude-code',
            'grok',
            'kiro',
            'qoder',
            'cursor',
            'antigravity',
            'opencode',
        ];
        const semantics = sources.map((source) => {
            const episodes = buildEvidenceEpisodes(buildEvidenceEvents(conversation(source)), lens);
            return episodes.map((episode) => ({
                eventPhases: episode.events.map((event) => event.phase),
                outcome: episode.outcome,
                toolNames: episode.events.flatMap((event) => (event.tool ? [event.tool.name] : [])),
            }));
        });

        expect(semantics.every((value) => JSON.stringify(value) === JSON.stringify(semantics[0]))).toBe(true);
    });

    it('should render deterministic, traceable, fence-safe Markdown within the hard budget', () => {
        const result = buildEvidenceExport(conversation(), lens, { generatedAt: '2026-07-19T12:00:00.000Z' });
        expect(result.markdown.length).toBeLessThanOrEqual(lens.budget.totalCharacters);
        expect(result.markdown).toContain('# Focused evidence: Widget repair');
        expect(result.markdown).toContain('Renderer: focused-evidence/v2');
        expect(result.markdown).toContain('## Episode 1: exec — succeeded');
        expect(result.markdown).toContain('````text');
        expect(result.markdown).toContain('## Omitted evidence');
        expect(result.markdown).toContain('Call IDs: call-1, call-2');
        expect(result.meta.episodeCount).toBe(1);
        expect(result.meta.generatedAt).toBe('2026-07-19T12:00:00.000Z');
    });

    it('should render the body of a matched non-tool message instead of retaining only its trace', () => {
        const input = conversation('kiro');
        input.messages = [
            {
                ...message(
                    0,
                    'final_answer',
                    `The compacted continuation completed successfully. ${'context '.repeat(12)}MATCHED_BODY_SENTINEL`,
                ),
                role: 'assistant',
            },
        ];
        const result = buildEvidenceExport(
            input,
            {
                ...lens,
                anchors: [{ kind: 'text', literals: ['MATCHED_BODY_SENTINEL'] }],
            },
            { generatedAt: '2026-07-19T12:00:00.000Z' },
        );

        expect(result.markdown).toContain('**Matched evidence**');
        expect(result.markdown).toContain('MATCHED_BODY_SENTINEL');
        expect(result.markdown).toContain('Message IDs: message-0');
    });

    it('should sanitize portable headings and retain a complete ledger at the minimum budget', () => {
        const input = conversation();
        input.workspacePath = '/Users/example/workspace/project';
        input.title = '/Users/example/workspace/project\n## injected';
        input.messages[1] = message(
            1,
            'tool_call',
            'unsafe tool',
            tool({ name: '/Users/example/workspace/project\n## injected' }),
        );
        const result = buildEvidenceExport(
            input,
            {
                ...lens,
                anchors: [{ kind: 'tool', names: ['/Users/example/workspace/project\n## injected'] }],
                budget: { ...lens.budget, totalCharacters: 2_000 },
            },
            { generatedAt: '2026-07-19T12:00:00.000Z' },
        );

        expect(result.markdown.length).toBeLessThanOrEqual(2_000);
        expect(result.markdown).not.toContain('/Users/example');
        expect(result.markdown).not.toContain('\n## injected');
        expect(result.markdown).toMatch(/- Retained source event-order ranges: (?:none|\d+-\d+(?:, \d+-\d+)*)\n$/u);
    });

    it('should project structured arrays, truncate unknown text, and deduplicate diagnostics with accounting', () => {
        const state = createEvidenceProjectionState(3, 1_000);
        const structured = projectEvidenceText('{"z":[1,2,3,4,5],"a":"kept"}', 500, state);
        const diagnostic = projectEvidenceText('ERROR: invalid configuration', 500, state);
        const duplicate = projectEvidenceText('ERROR: invalid configuration', 500, state);
        const truncated = projectEvidenceText(`prefix-${'x'.repeat(500)}-suffix`, 100, state);

        expect(structured.indexOf('"a"')).toBeLessThan(structured.indexOf('"z"'));
        expect(structured).toContain('"itemCount": 5');
        expect(structured).toContain('"omittedItems": 2');
        expect(diagnostic).toBe('ERROR: invalid configuration');
        expect(duplicate).toBe('[deduplicated diagnostic]');
        expect(truncated).toContain('[truncated');
        expect(truncated).toEndWith('-suffix');
        expect(state.stats).toMatchObject({
            deduplicatedDiagnostics: 1,
            truncatedArrays: 1,
            truncatedFields: 1,
        });
    });

    it('should bound multi-megabyte outputs before rendering and account for binary payloads', () => {
        const largeConversation = conversation();
        largeConversation.messages[2] = message(
            2,
            'tool_output',
            `data:image/png;base64,${'A'.repeat(3_000_000)}`,
            tool({ outputText: `data:image/png;base64,${'A'.repeat(3_000_000)}` }),
        );
        const startedAt = performance.now();
        const result = buildEvidenceExport(
            largeConversation,
            { ...lens, budget: { ...lens.budget, totalCharacters: 4_000 } },
            {
                generatedAt: '2026-07-19T12:00:00.000Z',
            },
        );
        expect(result.markdown.length).toBeLessThanOrEqual(4_000);
        expect(result.markdown).not.toContain('AAAA');
        expect(result.meta.omission.omittedBinaryPayloads).toBe(1);
        expect(performance.now() - startedAt).toBeLessThan(1_000);
    });
});
