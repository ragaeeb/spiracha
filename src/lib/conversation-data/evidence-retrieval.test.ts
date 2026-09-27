import { expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSpirachaCli } from '../../../bin/spiracha';
import type { ConversationClient } from '../../client';
import { createConversationClient } from '../../client';
import { toCanonicalMessage } from './adapter-helpers';
import { buildEvidenceExport } from './evidence-markdown';
import { evidenceRevision, retrieveEvidencePage } from './evidence-retrieval';
import type { ConversationDetail } from './types';

const conversation: ConversationDetail = {
    createdAtMs: null,
    deepLinks: { native: null, spiracha: 'spiracha://conversation/codex/test', ui: '' },
    id: 'test',
    matches: [],
    messageCount: 2,
    messages: [0, 1].map((order) =>
        toCanonicalMessage({
            createdAtMs: null,
            id: `message-${order}`,
            metadata: {},
            order,
            phase: 'commentary',
            role: 'assistant',
            text: order === 0 ? 'irrelevant' : 'hidden detail 😀'.repeat(100),
        }),
    ),
    metadata: {},
    source: 'codex',
    title: null,
    updatedAtMs: null,
    workspaceKey: null,
    workspacePath: null,
};

it('should recover exact normalized messages across bounded pages and reject stale or invalid requests', () => {
    const revision = evidenceRevision(conversation);
    let offset = 0;
    let recovered = '';
    do {
        const page = retrieveEvidencePage(conversation, {
            maxCharacters: 100,
            messageId: 'message-1',
            offset,
            revision,
        });
        expect(page.content.length).toBeLessThanOrEqual(100);
        recovered += page.content;
        if (page.nextOffset === null) {
            break;
        }
        expect(page.nextOffset).toBeGreaterThan(offset);
        offset = page.nextOffset;
    } while (offset > 0);
    expect(JSON.parse(recovered)).toEqual([conversation.messages[1]]);
    expect(JSON.parse(retrieveEvidencePage(conversation, { endOrder: 0, revision, startOrder: 0 }).content)).toEqual([
        conversation.messages[0],
    ]);
    for (const invalid of [
        { revision: 'stale' },
        { messageId: 'missing', revision },
        { maxCharacters: 0, revision },
        { offset: 100000, revision },
        { offset: 0.5, revision },
        { endOrder: Number.NaN, revision },
        { revision, startOrder: Number.POSITIVE_INFINITY },
        { revision, startOrder: -0.5 },
        { endOrder: 1, revision, startOrder: 2 },
        { messageId: 'message-1', revision, startOrder: 0 },
    ]) {
        expect(() => retrieveEvidencePage(conversation, invalid)).toThrow();
    }
    const changed = { ...conversation, messages: [...conversation.messages].reverse() };
    changed.messages[0] = { ...changed.messages[0], text: 'changed' };
    expect(() => retrieveEvidencePage(changed, { revision })).toThrow('changed');
});

it('should retrieve messages using fractional event-order bounds emitted by focused evidence', () => {
    const fractionalConversation = {
        ...conversation,
        messages: conversation.messages.map((message, index) => ({ ...message, order: index + 0.5 })),
    };
    const exported = buildEvidenceExport(
        fractionalConversation,
        {
            anchors: [{ kind: 'text', literals: ['hidden detail'] }],
            budget: {
                commentaryCharactersPerEpisode: 500,
                failedOutputCharacters: 1_000,
                successfulOutputCharacters: 300,
                totalCharacters: 8_000,
            },
            context: {
                commentaryAfter: 1,
                commentaryBefore: 1,
                followRetries: false,
                followWorkarounds: false,
                includeReasoningSummaries: false,
                maxOrderGap: 4,
            },
            name: 'Fractional event order',
        },
        { generatedAt: '2026-09-27T00:00:00.000Z' },
    );
    const requestText = /JSON: `([^`]+)`/u.exec(exported.markdown)?.[1];
    if (!requestText) {
        throw new Error('Expected the evidence export to include a retrieval request.');
    }
    const request = JSON.parse(requestText) as {
        endOrder: number;
        revision: string;
        startOrder: number;
    };

    expect(request.endOrder).toBe(1.5);
    const page = retrieveEvidencePage(fractionalConversation, request);
    expect(JSON.parse(page.content)).toEqual(fractionalConversation.messages);
});

it('should read a retrieval request through the CLI without printing other messages and report deleted sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spiracha-retrieve-'));
    try {
        const request = join(root, 'request.json');
        await Bun.write(request, JSON.stringify({ messageId: 'message-1', revision: evidenceRevision(conversation) }));
        let deleted = false;
        const client: ConversationClient = {
            ...createConversationClient(),
            getConversation: async (options) => {
                expect(options.messageSelector).toBe('all');
                return deleted ? null : conversation;
            },
            resolveConversationRef: async (ref) => {
                expect(ref).toBe(conversation.deepLinks.spiracha);
                return { id: 'test', source: 'codex' };
            },
        };
        const output: Array<string | Uint8Array> = [];
        const errors: string[] = [];
        const dependencies = {
            client,
            io: {
                stderr: (text: string) => {
                    errors.push(text);
                },
                stdout: (text: string | Uint8Array) => {
                    output.push(text);
                },
            },
        };
        const args = ['retrieve', conversation.deepLinks.spiracha, '--request', request];
        expect(await runSpirachaCli(args, dependencies)).toBe(0);
        expect(JSON.parse(JSON.parse(output[0] as string).content)).toEqual([conversation.messages[1]]);
        deleted = true;
        expect(await runSpirachaCli(args, dependencies)).toBe(1);
        expect(errors.join('')).toContain('no longer available');
        expect(output).toHaveLength(1);
    } finally {
        await rm(root, { force: true, recursive: true });
    }
});
