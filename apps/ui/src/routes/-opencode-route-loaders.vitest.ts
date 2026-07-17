import { describe, expect, it } from 'vitest';
import opencodeWorkspaceRouteSource from './opencode.$workspaceKey.tsx?raw';
import opencodeIndexRouteSource from './opencode.index.tsx?raw';
import opencodeSessionRouteSource from './opencode-sessions.$sessionId.tsx?raw';

describe('OpenCode route data loading', () => {
    it('should prefetch workspaces before rendering the source index', () => {
        expect(opencodeIndexRouteSource).toContain('useSuspenseQuery');
        expect(opencodeIndexRouteSource).toContain(
            'loader: ({ context }) => context.queryClient.ensureQueryData(openCodeWorkspacesQueryOptions())',
        );
    });

    it('should prefetch the selected workspace and its sessions', () => {
        expect(opencodeWorkspaceRouteSource).toContain('useSuspenseQuery');
        expect(opencodeWorkspaceRouteSource).toContain('loader: async ({ context, params }) =>');
        expect(opencodeWorkspaceRouteSource).toContain(
            'context.queryClient.ensureQueryData(openCodeSessionsQueryOptions(params.workspaceKey))',
        );
    });

    it('should prefetch session detail before rendering the detail route', () => {
        expect(opencodeSessionRouteSource).toContain('useSuspenseQuery');
        expect(opencodeSessionRouteSource).toContain(
            'context.queryClient.ensureQueryData(openCodeSessionDetailQueryOptions(params.sessionId))',
        );
    });
});
