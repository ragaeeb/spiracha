import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnalyticsBreakdowns } from './analytics-breakdowns';

describe('AnalyticsBreakdowns', () => {
    it('should render tool, model, source, and reasoning-effort breakdowns', () => {
        render(
            <AnalyticsBreakdowns
                modelsByTokens={[{ model: 'gpt-5.4', threadCount: 2, totalTokens: 1200 }]}
                reasoningEfforts={[{ count: 2, label: 'high' }]}
                sources={[{ count: 2, label: 'vscode' }]}
                toolUsage={[{ count: 3, name: 'exec_command' }]}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Most frequent tool calls' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Model token breakdown' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Client source breakdown' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Reasoning effort breakdown' })).toBeTruthy();
        expect(screen.getByText('exec_command')).toBeTruthy();
        expect(screen.getByText('gpt-5.4')).toBeTruthy();
        expect(screen.getByText('vscode')).toBeTruthy();
        expect(screen.getByText('high')).toBeTruthy();
    });
});
