import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThreadGoalsPanel } from './thread-goals-panel';

describe('ThreadGoalsPanel', () => {
    afterEach(cleanup);

    it('should show goal status, token progress, and elapsed time', () => {
        render(
            <ThreadGoalsPanel
                goals={[
                    {
                        createdAtMs: 1,
                        goalId: 'goal-1',
                        objective: 'Ship the dedicated tools view',
                        status: 'in_progress',
                        timeUsedSeconds: 125,
                        tokenBudget: 20_000,
                        tokensUsed: 3_400,
                        updatedAtMs: 2,
                    },
                ]}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Goals' })).toBeTruthy();
        expect(screen.getByText('Ship the dedicated tools view')).toBeTruthy();
        expect(screen.getByText('in progress')).toBeTruthy();
        expect(screen.getByText('3,400 / 20,000 tokens')).toBeTruthy();
        expect(screen.getByText('2m 5s')).toBeTruthy();
    });

    it('should explain when a thread has no recorded goals', () => {
        render(<ThreadGoalsPanel goals={[]} />);

        expect(screen.getByText('No goals were recorded for this thread.')).toBeTruthy();
    });
});
