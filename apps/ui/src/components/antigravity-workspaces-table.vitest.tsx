import type { AntigravityWorkspaceGroup } from '@spiracha/lib/antigravity-exporter-types';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AntigravityWorkspacesTable } from './antigravity-workspaces-table';

vi.mock('@tanstack/react-router', async () => {
    return {
        Link: ({
            children,
            params,
            to,
            ...props
        }: {
            children: ReactNode;
            params?: { workspaceKey?: string };
            to: string;
        }) => {
            const href = to.replace('$workspaceKey', encodeURIComponent(params?.workspaceKey ?? ''));
            return (
                <a href={href} {...props}>
                    {children}
                </a>
            );
        },
    };
});

const workspace: AntigravityWorkspaceGroup = {
    artifactCount: 4,
    conversationBytes: 8192,
    conversationCount: 2,
    key: 'folder:/Users/user/workspace/demo',
    label: 'demo',
    lastActiveMs: 1_700_000_000_000,
    transcriptCount: 1,
    uri: 'file:///Users/user/workspace/demo',
};

afterEach(() => {
    cleanup();
});

describe('AntigravityWorkspacesTable', () => {
    it('should render workspace links with the detail route href', () => {
        render(<AntigravityWorkspacesTable workspaces={[workspace]} />);

        const link = screen.getByRole('link', { name: /demo/i });
        expect(link.getAttribute('href')).toBe('/antigravity/folder%3A%2FUsers%2Fuser%2Fworkspace%2Fdemo');
    });
});
