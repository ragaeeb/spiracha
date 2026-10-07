import { describe, expect, it } from 'vitest';

const routeSources = import.meta.glob<string>(['./*.$workspaceKey.tsx', './codex.$project.tsx'], {
    eager: true,
    import: 'default',
    query: '?raw',
});
const workspaceRoutes = Object.entries(routeSources);

describe('workspace thread list routes', () => {
    it('should cover every workspace-scoped source route', () => {
        expect(workspaceRoutes).toHaveLength(12);
    });

    it.each(workspaceRoutes)('should offer tool call search on %s', (_route, source) => {
        expect(source).toContain('useToolCallSearch');
        expect(source).toContain('<ToolCallSearchBar');
        expect(source).toContain('<ToolCallHitsProvider');
    });
});
