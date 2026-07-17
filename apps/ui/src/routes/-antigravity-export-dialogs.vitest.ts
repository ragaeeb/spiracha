import { describe, expect, it } from 'vitest';
import workspaceRouteSource from './antigravity.$workspaceKey.tsx?raw';
import conversationRouteSource from './antigravity-conversations.$conversationId.tsx?raw';

describe('Antigravity export routes', () => {
    it('should open the configurable export dialog for a single workspace conversation', () => {
        expect(workspaceRouteSource).toContain(
            'onExportConversation={(conversation) => openExportForConversations([conversation])}',
        );
        expect(workspaceRouteSource).toContain('errorMessage={');
        expect(workspaceRouteSource).not.toContain('batchExportError=');
        expect(workspaceRouteSource).toContain(
            'showCommentaryOption={pendingExport?.supportsTranscriptFilters ?? true}',
        );
        expect(workspaceRouteSource).toContain('showToolsOption={pendingExport?.supportsTranscriptFilters ?? true}');
    });

    it('should open the configurable export dialog from conversation detail and forward every option', () => {
        expect(conversationRouteSource).toContain('onExportConversation={() => setExportOpen(true)}');
        expect(conversationRouteSource).toContain('<ExportDialog');
        expect(conversationRouteSource).toContain('includeCommentary: options.includeCommentary');
        expect(conversationRouteSource).toContain('includeMetadata: options.includeMetadata');
        expect(conversationRouteSource).toContain('includeTools: options.includeTools');
        expect(conversationRouteSource).toContain('outputFormat: options.outputFormat');
        expect(conversationRouteSource).toContain('zipArchive: options.zipArchive');
    });
});
