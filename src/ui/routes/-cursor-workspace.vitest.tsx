import { expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    createFileRoute:
        () =>
        (options: unknown): { options: unknown } => ({ options }),
    Link: ({ children }: { children: unknown }) => children,
    useNavigate: () => vi.fn(),
}));

import { getCursorWorkspaceQueryOptions } from './cursor.$workspaceKey';

it('should disable workspace discovery refetch while a deletion can be retried', () => {
    expect(getCursorWorkspaceQueryOptions(true).refetchOnWindowFocus).toBe(false);
    expect(getCursorWorkspaceQueryOptions(false).refetchOnWindowFocus).toBeUndefined();
});
