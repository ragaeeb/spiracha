import { antigravityConversationAdapter } from './antigravity-adapter';
import type { CapabilityBinding } from './capability';
import { claudeCodeConversationAdapter } from './claude-code-adapter';
import { clineConversationAdapter } from './cline-adapter';
import { codexConversationAdapter } from './codex-adapter';
import { commandCodeConversationAdapter } from './command-code-adapter';
import { cursorConversationAdapter } from './cursor-adapter';
import { fxConversationAdapter } from './fx-adapter';
import { grokConversationAdapter } from './grok-adapter';
import { grokBotConversationAdapter } from './grok-bot-adapter';
import { kiroConversationAdapter } from './kiro-adapter';
import { minimaxCodeConversationAdapter } from './minimax-code-adapter';
import { opencodeConversationAdapter } from './opencode-adapter';
import { qoderConversationAdapter } from './qoder-adapter';
import type { SOURCE_CATALOG } from './source-catalog';
import type { ConversationAdapter, ConversationSource } from './types';

type SourceCapabilities<S extends ConversationSource> = (typeof SOURCE_CATALOG)[S]['capabilities'];

type SourceReadBindings<S extends ConversationSource> = {
    detail: CapabilityBinding<SourceCapabilities<S>['detail'], ConversationAdapter<S>['getConversation']>;
    list: CapabilityBinding<SourceCapabilities<S>['list'], ConversationAdapter<S>['listConversations']>;
    original_raw: CapabilityBinding<
        SourceCapabilities<S>['original_raw'],
        NonNullable<ConversationAdapter<S>['getConversationRaw']>
    >;
    source: S;
};

type SourceMutationBindings<S extends ConversationSource> = {
    batch_delete: CapabilityBinding<
        SourceCapabilities<S>['batch_delete'],
        NonNullable<ConversationAdapter<S>['deleteConversation']>
    >;
    delete: CapabilityBinding<
        SourceCapabilities<S>['delete'],
        NonNullable<ConversationAdapter<S>['deleteConversation']>
    >;
    source: S;
};

const bindMutation = <S extends ConversationSource, B extends SourceMutationBindings<S>>(binding: B): B => binding;

const bindSource = <S extends ConversationSource, B extends SourceReadBindings<S>>(binding: B): B => binding;

export const SOURCE_READ_BINDINGS = {
    antigravity: bindSource({
        detail: { handler: antigravityConversationAdapter.getConversation },
        list: { handler: antigravityConversationAdapter.listConversations },
        original_raw: { handler: antigravityConversationAdapter.getConversationRaw },
        source: 'antigravity',
    }),
    'claude-code': bindSource({
        detail: { handler: claudeCodeConversationAdapter.getConversation },
        list: { handler: claudeCodeConversationAdapter.listConversations },
        original_raw: { handler: claudeCodeConversationAdapter.getConversationRaw },
        source: 'claude-code',
    }),
    cline: bindSource({
        detail: { handler: clineConversationAdapter.getConversation },
        list: { handler: clineConversationAdapter.listConversations },
        original_raw: { handler: clineConversationAdapter.getConversationRaw },
        source: 'cline',
    }),
    codex: bindSource({
        detail: { handler: codexConversationAdapter.getConversation },
        list: { handler: codexConversationAdapter.listConversations },
        original_raw: { handler: codexConversationAdapter.getConversationRaw },
        source: 'codex',
    }),
    'command-code': bindSource({
        detail: { handler: commandCodeConversationAdapter.getConversation },
        list: { handler: commandCodeConversationAdapter.listConversations },
        original_raw: { handler: commandCodeConversationAdapter.getConversationRaw },
        source: 'command-code',
    }),
    cursor: bindSource({
        detail: { handler: cursorConversationAdapter.getConversation },
        list: { handler: cursorConversationAdapter.listConversations },
        original_raw: { handler: cursorConversationAdapter.getConversationRaw },
        source: 'cursor',
    }),
    fx: bindSource({
        detail: { handler: fxConversationAdapter.getConversation },
        list: { handler: fxConversationAdapter.listConversations },
        original_raw: { handler: fxConversationAdapter.getConversationRaw },
        source: 'fx',
    }),
    grok: bindSource({
        detail: { handler: grokConversationAdapter.getConversation },
        list: { handler: grokConversationAdapter.listConversations },
        original_raw: { handler: grokConversationAdapter.getConversationRaw },
        source: 'grok',
    }),
    'grok-bot': bindSource({
        detail: { handler: grokBotConversationAdapter.getConversation },
        list: { handler: grokBotConversationAdapter.listConversations },
        original_raw: { handler: grokBotConversationAdapter.getConversationRaw },
        source: 'grok-bot',
    }),
    kiro: bindSource({
        detail: { handler: kiroConversationAdapter.getConversation },
        list: { handler: kiroConversationAdapter.listConversations },
        original_raw: { handler: kiroConversationAdapter.getConversationRaw },
        source: 'kiro',
    }),
    'minimax-code': bindSource({
        detail: { handler: minimaxCodeConversationAdapter.getConversation },
        list: { handler: minimaxCodeConversationAdapter.listConversations },
        original_raw: { handler: minimaxCodeConversationAdapter.getConversationRaw },
        source: 'minimax-code',
    }),
    opencode: bindSource({
        detail: { handler: opencodeConversationAdapter.getConversation },
        list: { handler: opencodeConversationAdapter.listConversations },
        original_raw: {},
        source: 'opencode',
    }),
    qoder: bindSource({
        detail: { handler: qoderConversationAdapter.getConversation },
        list: { handler: qoderConversationAdapter.listConversations },
        original_raw: { handler: qoderConversationAdapter.getConversationRaw },
        source: 'qoder',
    }),
} satisfies { [S in ConversationSource]: SourceReadBindings<S> };

const bindDelete = <S extends ConversationSource>(adapter: ConversationAdapter<S>) =>
    bindMutation({
        batch_delete: { handler: adapter.deleteConversation },
        delete: { handler: adapter.deleteConversation },
        source: adapter.source,
    });

export const SOURCE_MUTATION_BINDINGS = {
    antigravity: bindDelete(antigravityConversationAdapter),
    'claude-code': bindDelete(claudeCodeConversationAdapter),
    cline: bindDelete(clineConversationAdapter),
    codex: bindDelete(codexConversationAdapter),
    'command-code': bindDelete(commandCodeConversationAdapter),
    cursor: bindDelete(cursorConversationAdapter),
    fx: bindDelete(fxConversationAdapter),
    grok: bindDelete(grokConversationAdapter),
    'grok-bot': bindDelete(grokBotConversationAdapter),
    kiro: bindDelete(kiroConversationAdapter),
    'minimax-code': bindDelete(minimaxCodeConversationAdapter),
    opencode: bindDelete(opencodeConversationAdapter),
    qoder: bindDelete(qoderConversationAdapter),
} satisfies { [S in ConversationSource]: SourceMutationBindings<S> };
