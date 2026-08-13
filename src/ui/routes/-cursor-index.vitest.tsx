import { render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    createFileRoute:
        () =>
        (options: unknown): { options: unknown } => ({ options }),
    Link: ({ children }: { children: ReactNode }) => children,
}));

import { Route } from './cursor.index';

it('should immediately show the Cursor loading state while the initial route is pending', () => {
    const routeOptions = (Route as unknown as { options: { pendingComponent?: ComponentType; pendingMs?: number } })
        .options;
    const PendingComponent = routeOptions.pendingComponent;

    expect(PendingComponent).toBeTypeOf('function');
    expect(routeOptions.pendingMs).toBe(0);
    if (!PendingComponent) {
        throw new Error('Expected Cursor route to define a pending component');
    }
    render(<PendingComponent />);

    expect(screen.getByText('Loading Cursor')).toBeTruthy();
    expect(screen.getByText('Loading Cursor workspace and thread metadata.')).toBeTruthy();
});
