import type { ConversationSource } from '../lib/conversation-data/types';

export type SourceFixtureOwner = {
    adapterTest: string;
    nativeTest: string;
    uiActionTest: string;
};

export const SOURCE_FIXTURE_OWNERS = {
    antigravity: {
        adapterTest: 'src/lib/conversation-data/antigravity-adapter.test.ts',
        nativeTest: 'src/lib/antigravity-db.test.ts',
        uiActionTest: 'src/ui/components/antigravity-conversations-table.vitest.tsx',
    },
    'claude-code': {
        adapterTest: 'src/lib/conversation-data/claude-code-adapter.test.ts',
        nativeTest: 'src/lib/claude-code-db.test.ts',
        uiActionTest: 'src/ui/components/source-tables.vitest.tsx',
    },
    cline: {
        adapterTest: 'src/lib/conversation-data/cline-adapter.test.ts',
        nativeTest: 'src/lib/cline-db.test.ts',
        uiActionTest: 'src/ui/components/source-tables.vitest.tsx',
    },
    codex: {
        adapterTest: 'src/lib/conversation-data/codex-adapter.test.ts',
        nativeTest: 'src/lib/codex-browser-db.test.ts',
        uiActionTest: 'src/ui/components/threads-table.vitest.tsx',
    },
    'command-code': {
        adapterTest: 'src/lib/conversation-data/command-code-adapter.test.ts',
        nativeTest: 'src/lib/command-code-db.test.ts',
        uiActionTest: 'src/ui/components/source-tables.vitest.tsx',
    },
    cursor: {
        adapterTest: 'src/lib/conversation-data/cursor-adapter.test.ts',
        nativeTest: 'src/lib/cursor-db.test.ts',
        uiActionTest: 'src/ui/components/cursor-threads-table.vitest.tsx',
    },
    fx: {
        adapterTest: 'src/lib/conversation-data/fx-adapter.test.ts',
        nativeTest: 'src/lib/fx-db.test.ts',
        uiActionTest: 'src/ui/components/fx-tables.vitest.tsx',
    },
    grok: {
        adapterTest: 'src/lib/conversation-data/grok-adapter.test.ts',
        nativeTest: 'src/lib/grok-db.test.ts',
        uiActionTest: 'src/ui/components/source-tables.vitest.tsx',
    },
    'grok-bot': {
        adapterTest: 'src/lib/conversation-data/grok-bot-adapter.test.ts',
        nativeTest: 'src/lib/grok-bot-db.test.ts',
        uiActionTest: 'src/ui/components/grok-bot-chats-table.vitest.tsx',
    },
    kiro: {
        adapterTest: 'src/lib/conversation-data/kiro-adapter.test.ts',
        nativeTest: 'src/lib/kiro-db.test.ts',
        uiActionTest: 'src/ui/components/source-tables.vitest.tsx',
    },
    'minimax-code': {
        adapterTest: 'src/lib/conversation-data/minimax-code-adapter.test.ts',
        nativeTest: 'src/lib/minimax-code-db.test.ts',
        uiActionTest: 'src/ui/components/minimax-code-tables.vitest.tsx',
    },
    opencode: {
        adapterTest: 'src/lib/conversation-data/opencode-adapter.test.ts',
        nativeTest: 'src/lib/opencode-db.test.ts',
        uiActionTest: 'src/ui/components/source-tables.vitest.tsx',
    },
    qoder: {
        adapterTest: 'src/lib/conversation-data/qoder-adapter.test.ts',
        nativeTest: 'src/lib/qoder-db.test.ts',
        uiActionTest: 'src/ui/components/qoder-sessions-table.vitest.tsx',
    },
} as const satisfies Record<ConversationSource, SourceFixtureOwner>;
