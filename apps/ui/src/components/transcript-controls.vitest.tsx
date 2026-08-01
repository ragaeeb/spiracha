import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranscriptControls } from './transcript-controls';

afterEach(cleanup);

const renderControls = (overrides: Partial<ComponentProps<typeof TranscriptControls>> = {}) => {
    const callbacks = {
        onShowCommentaryChange: vi.fn(),
        onShowExtraEventsChange: vi.fn(),
        onShowRawJsonChange: vi.fn(),
        onShowToolCallsChange: vi.fn(),
        onShowUserMessagesChange: vi.fn(),
    };
    render(
        <TranscriptControls
            showCommentary={false}
            showExtraEvents={false}
            showRawJson={false}
            showToolCalls={false}
            showUserMessages={false}
            {...callbacks}
            {...overrides}
        />,
    );
    return callbacks;
};

describe('TranscriptControls', () => {
    it('should expose every transcript display toggle through labelled controls', () => {
        const callbacks = renderControls();

        fireEvent.click(screen.getByLabelText('Show tool calls'));
        fireEvent.click(screen.getByLabelText('Show commentary'));
        fireEvent.click(screen.getByLabelText('Show extra events'));
        fireEvent.click(screen.getByLabelText('Raw JSON'));
        fireEvent.click(screen.getByLabelText('User'));

        expect(callbacks.onShowToolCallsChange).toHaveBeenCalledWith(true);
        expect(callbacks.onShowCommentaryChange).toHaveBeenCalledWith(true);
        expect(callbacks.onShowExtraEventsChange).toHaveBeenCalledWith(true);
        expect(callbacks.onShowRawJsonChange).toHaveBeenCalledWith(true);
        expect(callbacks.onShowUserMessagesChange).toHaveBeenCalledWith(true);
    });

    it('should disable raw JSON without disabling the other controls', () => {
        renderControls({ rawJsonDisabled: true });

        expect((screen.getByLabelText('Raw JSON') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByLabelText('Show commentary') as HTMLButtonElement).disabled).toBe(false);
    });
});
