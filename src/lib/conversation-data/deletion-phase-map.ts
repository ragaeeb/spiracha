import { SOURCE_MUTATOR_OWNED, type SourceMutatorOwned } from './operation-types';
import type { ConversationSource } from './types';

export type DeletionPhaseMapEntry = {
    capability: SourceMutatorOwned;
    phases: readonly string[];
    reconciliation: 'durable_intent' | 'none';
    store: string;
};

export const DELETION_PHASE_MAP = {
    antigravity: {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['conversation_row', 'trajectory_files'],
        reconciliation: 'none',
        store: 'src/lib/antigravity-db.ts',
    },
    'claude-code': {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['session_files'],
        reconciliation: 'none',
        store: 'src/lib/claude-code-db.ts',
    },
    cline: {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['task_directory'],
        reconciliation: 'none',
        store: 'src/lib/cline-db.ts',
    },
    codex: {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['deletion_journal', 'thread_row', 'rollout_files', 'session_index'],
        reconciliation: 'durable_intent',
        store: 'src/lib/codex-deletion-journal.ts',
    },
    'command-code': {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['sidecar_receipt', 'meta_json', 'checkpoints_jsonl', 'jsonl_replica'],
        reconciliation: 'durable_intent',
        store: 'src/lib/command-code-db.ts',
    },
    cursor: {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['operation_journal', 'composer_row', 'optional_transcript_directory'],
        reconciliation: 'durable_intent',
        store: 'src/lib/cursor-operation-journal.ts',
    },
    fx: {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['session_directory', 'index_row', 'latest_pointer'],
        reconciliation: 'none',
        store: 'src/lib/fx-db.ts',
    },
    grok: {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['session_files'],
        reconciliation: 'none',
        store: 'src/lib/grok-db.ts',
    },
    'grok-bot': {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['gateway_delete_agent'],
        reconciliation: 'none',
        store: 'src/lib/grok-bot-gateway.ts',
    },
    kiro: {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['session_files'],
        reconciliation: 'none',
        store: 'src/lib/kiro-db.ts',
    },
    'minimax-code': {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['session_snapshot', 'runtime_row'],
        reconciliation: 'none',
        store: 'src/lib/minimax-code-db.ts',
    },
    opencode: {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['session_row', 'cleanup_retry'],
        reconciliation: 'durable_intent',
        store: 'src/lib/opencode-db.ts',
    },
    qoder: {
        capability: SOURCE_MUTATOR_OWNED,
        phases: ['mutation_lock', 'item_table_rows', 'receipt'],
        reconciliation: 'durable_intent',
        store: 'src/lib/qoder-sessions.ts',
    },
} as const satisfies Record<ConversationSource, DeletionPhaseMapEntry>;

export const hasDurableDeletionReconciliation = (source: ConversationSource) =>
    DELETION_PHASE_MAP[source].reconciliation === 'durable_intent';
