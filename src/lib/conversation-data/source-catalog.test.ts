import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { SOURCE_CATALOG, sourceFromDetailRouteSegment } from './source-catalog';
import { CONVERSATION_SOURCES, type ConversationSource } from './types';

// These expectations are intentionally independent of catalog values.
const expectedRoutes = {
    antigravity: 'antigravity-conversations',
    'claude-code': 'claude-code-sessions',
    cline: 'cline-tasks',
    codex: 'threads',
    'command-code': 'command-code-sessions',
    cursor: 'cursor-threads',
    fx: 'fx-sessions',
    grok: 'grok-sessions',
    'grok-bot': 'grok-bot-chats',
    kiro: 'kiro-sessions',
    'minimax-code': 'minimax-code-sessions',
    opencode: 'opencode-sessions',
    qoder: 'qoder-sessions',
} satisfies Record<ConversationSource, string>;

const expectedWorkspaceRoutes = {
    antigravity: { parameterName: 'workspaceKey', pathTemplate: '/antigravity/$workspaceKey' },
    'claude-code': { parameterName: 'workspaceKey', pathTemplate: '/claude-code/$workspaceKey' },
    cline: { parameterName: 'workspaceKey', pathTemplate: '/cline/$workspaceKey' },
    codex: { parameterName: 'project', pathTemplate: '/codex/$project' },
    'command-code': { parameterName: 'workspaceKey', pathTemplate: '/command-code/$workspaceKey' },
    cursor: { parameterName: 'workspaceKey', pathTemplate: '/cursor/$workspaceKey' },
    fx: { parameterName: 'workspaceKey', pathTemplate: '/fx/$workspaceKey' },
    grok: { parameterName: 'workspaceKey', pathTemplate: '/grok/$workspaceKey' },
    kiro: { parameterName: 'workspaceKey', pathTemplate: '/kiro/$workspaceKey' },
    'minimax-code': { parameterName: 'workspaceKey', pathTemplate: '/minimax-code/$workspaceKey' },
    opencode: { parameterName: 'workspaceKey', pathTemplate: '/opencode/$workspaceKey' },
    qoder: { parameterName: 'workspaceKey', pathTemplate: '/qoder/$workspaceKey' },
} as const;

describe('portable source catalog', () => {
    it('should cover every source with unique inventory and detail routes', () => {
        expect(Object.keys(SOURCE_CATALOG).sort()).toEqual([...CONVERSATION_SOURCES].sort());
        const descriptors = CONVERSATION_SOURCES.map((source) => SOURCE_CATALOG[source]);
        expect(new Set(descriptors.map((entry) => entry.inventoryPath)).size).toBe(CONVERSATION_SOURCES.length);
        expect(new Set(descriptors.map((entry) => entry.detailRouteSegment)).size).toBe(CONVERSATION_SOURCES.length);
        for (const source of CONVERSATION_SOURCES) {
            expect(SOURCE_CATALOG[source].source).toBe(source);
            expect(SOURCE_CATALOG[source].detailRouteSegment as string).toBe(expectedRoutes[source]);
            expect(sourceFromDetailRouteSegment(expectedRoutes[source])).toBe(source);
        }
    });

    it('should bind every catalog source to actual inventory and detail route files', async () => {
        const routeDirectory = new URL('../../ui/routes/', import.meta.url);
        const routeFiles = await readdir(routeDirectory);
        for (const source of CONVERSATION_SOURCES) {
            expect(routeFiles).toContain(`${source}.index.tsx`);
            const segment = expectedRoutes[source];
            const detailFiles = routeFiles.filter((file) => file.startsWith(`${segment}.$`));
            expect(detailFiles).toHaveLength(1);
            const content = await Bun.file(new URL(detailFiles[0]!, routeDirectory)).text();
            expect(content).toContain(`createFileRoute('/${segment}/$`);
        }
    });

    it('should register independently expected paths in the generated route tree', async () => {
        const tree = await Bun.file(new URL('../../ui/routeTree.gen.ts', import.meta.url)).text();
        expect(tree).not.toContain("id: '/grok-bot/$workspaceKey'");
        for (const source of CONVERSATION_SOURCES) {
            expect(tree).toContain(`id: '/${source}/'`);
            expect(tree).toContain(`id: '/${expectedRoutes[source]}/$`);
            if (source === 'grok-bot') {
                continue;
            }
            const workspace = expectedWorkspaceRoutes[source];
            expect(tree).toContain(`id: '${workspace.pathTemplate}'`);
        }
    });

    it('should bind workspace routes only for workspace-scoped sources', async () => {
        const routeDirectory = new URL('../../ui/routes/', import.meta.url);
        const routeFiles = await readdir(routeDirectory);
        expect(routeFiles).not.toContain('grok-bot.$workspaceKey.tsx');
        expect('workspaceRoute' in SOURCE_CATALOG['grok-bot']).toBe(false);

        for (const source of CONVERSATION_SOURCES) {
            const descriptor = SOURCE_CATALOG[source];
            if (descriptor.scope === 'global') {
                continue;
            }
            const workspaceSource = source as Exclude<ConversationSource, 'grok-bot'>;
            expect(descriptor.workspaceRoute).toEqual(expectedWorkspaceRoutes[workspaceSource]);
            const workspaceFile = `${source}.$${descriptor.workspaceRoute.parameterName}.tsx`;
            expect(routeFiles).toContain(workspaceFile);
            const content = await Bun.file(new URL(workspaceFile, routeDirectory)).text();
            expect(content).toContain(`createFileRoute('${descriptor.workspaceRoute.pathTemplate}')`);
        }
    });

    it('should preserve global scope and historical export platform names', () => {
        expect(CONVERSATION_SOURCES.filter((source) => SOURCE_CATALOG[source].scope === 'global')).toEqual([
            'grok-bot',
        ]);
        expect(SOURCE_CATALOG['claude-code'].exportPlatform).toBe('claude');
        expect(SOURCE_CATALOG['minimax-code'].exportPlatform).toBe('minimax');
        expect(sourceFromDetailRouteSegment('web-chats')).toBeNull();
        expect(sourceFromDetailRouteSegment('cloud')).toBeNull();
        expect(sourceFromDetailRouteSegment('unknown')).toBeNull();
    });

    it('should declare required reads and reviewed original-raw states independently of adapters', async () => {
        const expectedOriginalRaw = {
            antigravity: 'supported',
            'claude-code': 'supported',
            cline: 'supported',
            codex: 'supported',
            'command-code': 'supported',
            cursor: 'supported',
            fx: 'supported',
            grok: 'supported',
            'grok-bot': 'supported',
            kiro: 'supported',
            'minimax-code': 'supported',
            opencode: 'unsupported',
            qoder: 'supported',
        } satisfies Record<ConversationSource, 'supported' | 'unsupported'>;
        const expectedDurableDeletion = {
            antigravity: false,
            'claude-code': false,
            cline: false,
            codex: true,
            'command-code': true,
            cursor: true,
            fx: false,
            grok: false,
            'grok-bot': false,
            kiro: false,
            'minimax-code': false,
            opencode: true,
            qoder: true,
        } satisfies Record<ConversationSource, boolean>;
        const repoRoot = new URL('../../..', import.meta.url);

        for (const source of CONVERSATION_SOURCES) {
            const capabilities = SOURCE_CATALOG[source].capabilities;
            expect(capabilities.list.state).toBe('supported');
            expect(capabilities.detail.state).toBe('supported');
            expect(capabilities.original_raw.state).toBe(expectedOriginalRaw[source]);
            expect(capabilities.normalized_export.state).toBe('supported');
            expect(capabilities.batch_normalized_export.state).toBe('supported');
            expect(capabilities.focused_evidence.state).toBe('supported');
            expect(capabilities.inventory.state).toBe('supported');
            expect(capabilities.multi_selection.state).toBe('supported');
            expect('deletion_reconciliation' in capabilities).toBe(expectedDurableDeletion[source]);
            if (capabilities.original_raw.state === 'unsupported') {
                const [evidence] = capabilities.original_raw.evidence;
                expect(capabilities.original_raw.reasonCode).toBe('no_native_conversation_file');
                expect(await Bun.file(new URL(evidence!.path, repoRoot)).exists()).toBe(true);
                const testSource = await Bun.file(
                    new URL('src/lib/conversation-data/opencode-adapter.test.ts', repoRoot),
                ).text();
                expect(testSource).toContain(evidence!.testId);
            }
        }
    });
});
