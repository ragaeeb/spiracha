import { describe, expect, it } from 'vitest';
import antigravityWorkspaceRouteSource from './antigravity.$workspaceKey.tsx?raw';
import claudeCodeWorkspaceRouteSource from './claude-code.$workspaceKey.tsx?raw';
import codexProjectRouteSource from './codex.$project.tsx?raw';
import cursorWorkspaceRouteSource from './cursor.$workspaceKey.tsx?raw';
import grokWorkspaceRouteSource from './grok.$workspaceKey.tsx?raw';
import kiroWorkspaceRouteSource from './kiro.$workspaceKey.tsx?raw';
import opencodeWorkspaceRouteSource from './opencode.$workspaceKey.tsx?raw';
import qoderWorkspaceRouteSource from './qoder.$workspaceKey.tsx?raw';

const workspaceRoutes = [
    ['Antigravity', antigravityWorkspaceRouteSource, 'exportConversationsMutation'],
    ['Claude Code', claudeCodeWorkspaceRouteSource, 'exportMutation'],
    ['Codex', codexProjectRouteSource, 'exportThreadMutation'],
    ['Cursor', cursorWorkspaceRouteSource, 'exportMutation'],
    ['Grok', grokWorkspaceRouteSource, 'exportMutation'],
    ['Kiro', kiroWorkspaceRouteSource, 'exportMutation'],
    ['OpenCode', opencodeWorkspaceRouteSource, 'exportMutation'],
    ['Qoder', qoderWorkspaceRouteSource, 'exportMutation'],
] as const;

describe('source workspace export errors', () => {
    it.each(
        workspaceRoutes,
    )('should render %s export failures inside the export dialog', (_sourceName, source, mutationName) => {
        const exportDialogStart = source.indexOf('<ExportDialog');
        const exportDialogSource = source.slice(exportDialogStart, source.indexOf('/>', exportDialogStart) + 2);

        expect(exportDialogSource).toContain('errorMessage={');
        expect(exportDialogSource).toContain(`${mutationName}.reset()`);
        expect(source.match(new RegExp(`${mutationName}\\.isError`, 'gu')) ?? []).toHaveLength(
            mutationName === 'exportThreadMutation' ? 0 : 1,
        );
    });
});
