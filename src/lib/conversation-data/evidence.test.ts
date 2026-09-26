import { describe, expect, it } from 'bun:test';
import { toCanonicalMessage } from './adapter-helpers';
import { normalizeAntigravityConversationMessages } from './antigravity-message-normalizer';
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
): ConversationMessage =>
    toCanonicalMessage({
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
    messageCount: 6,
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
        expect(parseShellInvocation('cd "/repo;name" && rtk proxy bun test')).toEqual({
            executable: 'bun',
            subcommand: 'test',
        });
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

    it('should retain the exact ordered-fallback output for call-id-less calls', () => {
        const input = conversation('kiro');
        input.messages = [
            message(0, 'tool_call', 'A', tool({ callId: null, command: 'A', inputText: 'A', name: 'A' })),
            message(1, 'tool_call', 'B', tool({ callId: null, command: 'B', inputText: 'B', name: 'B' })),
            message(
                2,
                'tool_output',
                'B output',
                tool({ callId: null, name: 'B', outputText: 'B output', status: 'succeeded' }),
            ),
            message(
                3,
                'tool_output',
                'A output',
                tool({ callId: null, name: 'A', outputText: 'A output', status: 'succeeded' }),
            ),
        ];

        const episodes = buildEvidenceEpisodes(buildEvidenceEvents(input), {
            ...lens,
            anchors: [{ kind: 'tool', names: ['A'] }],
            context: {
                ...lens.context,
                commentaryAfter: 0,
                commentaryBefore: 0,
                followRetries: false,
                followWorkarounds: false,
                maxOrderGap: 10,
            },
        });

        expect(episodes[0]?.events.map((event) => event.text)).toEqual(['A', 'A output']);
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
        input.messages = input.messages.map((entry, index) => ({
            ...entry,
            createdAtMs: index,
            id: `message-${index}`,
            order: index,
        }));

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
        expect(result.markdown).toContain('Renderer: focused-evidence/v5');
        expect(result.markdown).toContain('## Episode 1: exec — succeeded');
        expect(result.markdown).toContain('````text');
        expect(result.markdown).toContain('## Omitted evidence');
        expect(result.markdown).toContain('call call-1; exact');
        expect(result.markdown).toContain('call call-2; exact');
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
        expect(result.markdown).toContain('Message: message-0');
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
        expect(JSON.parse(structured)).toEqual({
            a: 'kept',
            z: { itemCount: 5, omittedItems: 2, sample: [1, 2, 3] },
        });
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

    it('should fit structured evidence before truncating values and preserve whitespace inside strings', () => {
        const payload = {
            code: 143,
            guidance: 'Send TERM once; preserve the child_signal envelope.',
            message: 'worker  stopped\ncleanup pending',
            status: 'failed',
        };
        const state = createEvidenceProjectionState(1, 200);
        const budget = JSON.stringify(payload).length;
        const projected = projectEvidenceText(JSON.stringify(payload, null, 2), budget, state);
        expect(projected).not.toContain('[truncated');
        expect(JSON.parse(projected)).toEqual(payload);
        expect(projected.length).toBeLessThanOrEqual(budget);
        expect(state.stats.truncatedFields).toBe(0);
    });

    it('should preserve scalar leaves at the structured depth limit', () => {
        const state = createEvidenceProjectionState(1, 100);
        let nested: unknown = 'deep scalar';
        for (let index = 0; index < 6; index += 1) {
            nested = { value: nested };
        }

        const projected = projectEvidenceText(JSON.stringify(nested), 500, state);

        expect(projected).toContain('deep scalar');
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
            {
                ...lens,
                anchors: [{ kind: 'text', literals: ['data:image/png;base64'] }],
                budget: { ...lens.budget, totalCharacters: 4_000 },
            },
            {
                generatedAt: '2026-07-19T12:00:00.000Z',
            },
        );
        expect(result.markdown.length).toBeLessThanOrEqual(4_000);
        expect(result.markdown).not.toContain('AAAA');
        expect(result.meta.omission.omittedBinaryPayloads).toBe(1);
        expect(result.meta.omission.renderedMatchedEvents).toBe(0);
        expect(performance.now() - startedAt).toBeLessThan(1_000);
    });

    it('should report only retained invocation retries and reject an impossible total budget', () => {
        const input = conversation();
        input.messages[1] = message(
            1,
            'tool_call',
            'first invocation',
            tool({ command: 'first '.repeat(100), inputText: 'first '.repeat(100) }),
        );
        input.messages[4] = message(
            4,
            'tool_call',
            'second invocation',
            tool({ callId: 'call-2', command: 'second '.repeat(100), inputText: 'second '.repeat(100) }),
        );

        const result = buildEvidenceExport(
            input,
            { ...lens, budget: { ...lens.budget, successfulOutputCharacters: 0 } },
            { generatedAt: '2026-07-19T12:00:00.000Z' },
        );
        expect(result.markdown).not.toContain('_None retained._');
        expect(result.markdown).not.toContain('Retries:');

        expect(() =>
            buildEvidenceExport(input, lens, {
                generatedAt: 'x'.repeat(10_000),
            }),
        ).toThrow('cannot fit within the configured character budget');
    });
});

describe('focused evidence field regressions', () => {
    const topicLens: EvidenceLens = {
        ...lens,
        anchors: [{ kind: 'text', literals: ['SIGTERM'] }],
        budget: { ...lens.budget, totalCharacters: 12000 },
    };

    it('should render a matched final answer beside its tools and initiating request', () => {
        const input = conversation();
        input.messages = [
            { ...message(0, 'unknown', 'Please repair cancellation.'), role: 'user' },
            message(1, 'tool_call', 'SIGTERM reproduction', tool()),
            message(2, 'tool_output', 'exit 143', tool({ outputText: 'exit 143' })),
            message(3, 'commentary', 'Checking SIGTERM repair.'),
            message(4, 'final_answer', 'Fixed SIGTERM: one signal, cleanup grace, intact envelopes.'),
        ];
        const result = buildEvidenceExport(input, topicLens);
        expect(result.markdown).toContain('Fixed SIGTERM: one signal, cleanup grace, intact envelopes.');
        expect(result.markdown).toContain('Please repair cancellation.');
    });

    it('should select an output-only match with its invocation', () => {
        const input = conversation();
        input.messages = [
            message(0, 'tool_call', 'run check', tool()),
            message(1, 'tool_output', 'SIGTERM exit 143', tool({ outputText: 'SIGTERM exit 143' })),
        ];
        const result = buildEvidenceExport(input, topicLens);
        expect(result.markdown).toContain('SIGTERM exit 143');
        expect(result.markdown).toContain('bun test src/widget.test.ts');
    });

    it('should preserve distinct status updates sharing a diagnostic paragraph and identify speakers', () => {
        const input = conversation('grok-bot');
        input.messages = ['P3 commit abc123', 'P4 commit def456'].map((delta, i) => ({
            ...message(i, 'final_answer', `SIGTERM error resolved. ${'same diagnostic '.repeat(12)}\n\n${delta}`),
            metadata: { authorId: `agent-${i}`, authorName: `Reviewer ${i}` },
        }));
        const result = buildEvidenceExport(input, topicLens);
        expect(result.markdown).toContain('P3 commit abc123');
        expect(result.markdown).toContain('P4 commit def456');
        expect(result.markdown).toContain('Reviewer 1');
        expect(result.markdown).not.toContain('No invocation text available');
        expect(result.markdown).not.toContain('No paired result available');
    });

    it('should keep matched paragraphs in the middle of long answers instead of an unrelated tail', () => {
        const input = conversation();
        input.messages = [
            message(
                0,
                'final_answer',
                `${'Unrelated opening. '.repeat(150)}\n\nSIGTERM fails because signals repeat. Send TERM once and allow cleanup grace.\n\n${'Unrelated ending. '.repeat(150)}`,
            ),
        ];
        const result = buildEvidenceExport(input, topicLens);
        expect(result.markdown).toContain('Send TERM once and allow cleanup grace.');
        expect(result.markdown).not.toContain('Unrelated ending. Unrelated ending.');
    });

    it('should share the commentary allowance across an episode while preserving matched evidence', () => {
        const input = conversation();
        input.messages = [
            message(0, 'commentary', 'earlier context '.repeat(40)),
            message(1, 'commentary', 'recent context '.repeat(40)),
            message(2, 'tool_call', 'SIGTERM check', tool({ command: 'SIGTERM check' })),
            message(3, 'tool_output', 'SIGTERM failure details', tool({ outputText: 'SIGTERM failure details' })),
            message(4, 'final_answer', 'SIGTERM repaired; verified one TERM and intact child_signal.'),
        ];
        const result = buildEvidenceExport(input, {
            ...topicLens,
            budget: { ...topicLens.budget, commentaryCharactersPerEpisode: 300 },
        });
        const contextBodies = [...result.markdown.matchAll(/\*\*Context\*\*[^\n]*\n```text\n([\s\S]*?)\n```/gu)];
        expect(contextBodies.length).toBeGreaterThan(0);
        expect(contextBodies.reduce((sum, match) => sum + match[1]!.length, 0)).toBeLessThanOrEqual(300);
        expect(result.markdown).toContain('SIGTERM failure details');
        expect(result.markdown).toContain('SIGTERM repaired; verified one TERM and intact child_signal.');
        expect(result.meta.omission.sectionBudgetReached).toBe(true);
        expect(result.markdown).not.toContain('_None retained._');
    });

    it('should retain terminal resolution under pressure and disclose the candidate cap', () => {
        const input = conversation();
        input.messages = Array.from({ length: 300 }, (_, i) =>
            message(i, 'final_answer', `SIGTERM investigation ${i}: ${'context '.repeat(40)}`),
        );
        input.messages.push(message(300, 'final_answer', 'SIGTERM RESOLVED: verified intact child_signal envelopes.'));
        const result = buildEvidenceExport(input, {
            ...topicLens,
            budget: { ...topicLens.budget, totalCharacters: 2000 },
        });
        expect(result.markdown).toContain('SIGTERM RESOLVED');
        expect(result.markdown.length).toBeLessThanOrEqual(2000);
        expect(result.meta.omission).toMatchObject({ budgetReached: true, candidateLimitReached: true });
    });

    it('should not merge a chain of unrelated calls through shared commentary or label them retries', () => {
        const input = conversation();
        input.messages = Array.from({ length: 30 }, (_, i) => [
            message(i * 3, 'commentary', `Inspect area ${i}`),
            message(i * 3 + 1, 'tool_call', `read area ${i}`, tool({ callId: `call-${i}`, command: `cat area-${i}` })),
            message(
                i * 3 + 2,
                'tool_output',
                `area ${i}`,
                tool({ callId: `call-${i}`, exitCode: 0, outputText: `area ${i}`, status: 'succeeded' }),
            ),
        ]).flat();
        const result = buildEvidenceExport(input, {
            ...lens,
            anchors: [{ kind: 'tool', names: ['exec'] }],
            budget: { ...lens.budget, totalCharacters: 40000 },
        });
        expect(result.meta.episodeCount).toBeGreaterThan(1);
        expect(result.markdown).not.toContain('Retry:');
    });
});

it('should retain generic Antigravity results with honest fallback confidence and reject ambiguity', () => {
    const input = conversation('antigravity');
    input.messages = normalizeAntigravityConversationMessages('native', 'trajectory', [
        {
            createdAtMs: 1,
            metadata: { status: 'DONE', type: 'PLANNER_RESPONSE' },
            order: 1,
            phase: 'tool_call',
            role: 'tool',
            text: JSON.stringify({
                args: { CommandLine: 'bun test', Cwd: '/repo' },
                id: 'native-call',
                name: 'run_command',
            }),
        },
        {
            createdAtMs: 2,
            metadata: { status: 'DONE', type: 'GENERIC' },
            order: 2,
            phase: 'tool_output',
            role: 'tool',
            text: 'The command exited with code 0.\nOutput:\n7 checks passed',
        },
    ]);
    const shellLens: EvidenceLens = { ...lens, anchors: [{ executables: ['bun'], kind: 'shell-command' }] };
    const result = buildEvidenceExport(input, shellLens);
    expect(result.markdown).toContain('7 checks passed');
    expect(result.markdown).toContain('ordered_fallback');
    expect(result.markdown).not.toContain('abandoned');
    input.messages.splice(1, 0, {
        ...input.messages[0]!,
        id: 'other',
        order: 0.5,
        toolEvidence: { ...input.messages[0]!.toolEvidence!, callId: 'other-call' },
    });
    const ambiguous = buildEvidenceEpisodes(buildEvidenceEvents(input), shellLens);
    expect(
        ambiguous
            .flatMap((e) => e.events)
            .filter((e) => e.phase === 'tool_call')
            .every((e) => e.pairingConfidence === 'unpaired'),
    ).toBe(true);
});
