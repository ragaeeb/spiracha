import { describe, expect, it } from 'bun:test';
import { SOURCE_FIXTURE_OWNERS } from '../../test-support/conversation-sources';
import { antigravityConversationAdapter } from './antigravity-adapter';
import { claudeCodeConversationAdapter } from './claude-code-adapter';
import { clineConversationAdapter } from './cline-adapter';
import { codexConversationAdapter } from './codex-adapter';
import { commandCodeConversationAdapter } from './command-code-adapter';
import { cursorConversationAdapter } from './cursor-adapter';
import { DELETION_PHASE_MAP } from './deletion-phase-map';
import { fxConversationAdapter } from './fx-adapter';
import { grokConversationAdapter } from './grok-adapter';
import { grokBotConversationAdapter } from './grok-bot-adapter';
import { kiroConversationAdapter } from './kiro-adapter';
import { minimaxCodeConversationAdapter } from './minimax-code-adapter';
import { opencodeConversationAdapter } from './opencode-adapter';
import { qoderConversationAdapter } from './qoder-adapter';
import { SOURCE_CATALOG } from './source-catalog';
import { CONVERSATION_SOURCES, type ConversationAdapter, type ConversationSource } from './types';

const adapters = {
    antigravity: antigravityConversationAdapter,
    'claude-code': claudeCodeConversationAdapter,
    cline: clineConversationAdapter,
    codex: codexConversationAdapter,
    'command-code': commandCodeConversationAdapter,
    cursor: cursorConversationAdapter,
    fx: fxConversationAdapter,
    grok: grokConversationAdapter,
    'grok-bot': grokBotConversationAdapter,
    kiro: kiroConversationAdapter,
    'minimax-code': minimaxCodeConversationAdapter,
    opencode: opencodeConversationAdapter,
    qoder: qoderConversationAdapter,
} satisfies Record<ConversationSource, ConversationAdapter>;

describe('source contract conformance', () => {
    it('should require delete on every adapter and original raw except OpenCode', () => {
        for (const source of CONVERSATION_SOURCES) {
            const adapter = adapters[source];
            expect(adapter.source).toBe(source);
            expect(typeof adapter.deleteConversation).toBe('function');
            expect(typeof adapter.getConversation).toBe('function');
            expect(typeof adapter.listConversations).toBe('function');
            expect('getConversationRaw' in adapter).toBe(source !== 'opencode');
            expect(SOURCE_CATALOG[source].capabilities.original_raw.state === 'supported').toBe(source !== 'opencode');
        }
    });

    it('should keep Web and Cloud as surfaces rather than conversation sources', () => {
        expect(CONVERSATION_SOURCES).not.toContain('web');
        expect(CONVERSATION_SOURCES).not.toContain('cloud');
        expect(CONVERSATION_SOURCES).not.toContain('codex-cloud');
    });

    it('should keep catalog deletion reconciliation aligned with durable phase-map intent', () => {
        for (const source of CONVERSATION_SOURCES) {
            const declared = 'deletion_reconciliation' in SOURCE_CATALOG[source].capabilities;
            expect(declared).toBe(DELETION_PHASE_MAP[source].reconciliation === 'durable_intent');
        }
    });

    it('should keep native, adapter, and UI fixture owners on disk for every source', async () => {
        for (const source of CONVERSATION_SOURCES) {
            const owner = SOURCE_FIXTURE_OWNERS[source];
            expect(await Bun.file(owner.adapterTest).exists()).toBe(true);
            expect(await Bun.file(owner.nativeTest).exists()).toBe(true);
            expect(await Bun.file(owner.uiActionTest).exists()).toBe(true);
        }
    });
});
