import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { RouteStateResetBoundary } from './route-state-reset';

const StatefulContent = () => {
    const [count, setCount] = useState(0);
    return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
            {count}
        </button>
    );
};

describe('RouteStateResetBoundary', () => {
    it('should remount route content when its identity changes', () => {
        const { rerender } = render(
            <RouteStateResetBoundary routeKey="thread-a">
                <StatefulContent />
            </RouteStateResetBoundary>,
        );
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByRole('button').textContent).toBe('1');

        rerender(
            <RouteStateResetBoundary routeKey="thread-b">
                <StatefulContent />
            </RouteStateResetBoundary>,
        );

        expect(screen.getByRole('button').textContent).toBe('0');
    });
});
