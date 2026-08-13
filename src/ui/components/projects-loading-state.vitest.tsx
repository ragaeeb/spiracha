import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectsLoadingState } from './projects-loading-state';

afterEach(() => {
    cleanup();
});

describe('ProjectsLoadingState', () => {
    it('should show progress feedback while Codex projects load', () => {
        render(<ProjectsLoadingState />);

        expect(screen.getByText('Codex')).toBeTruthy();
        expect(screen.getByRole('status').textContent).toContain('Loading Codex projects');
        expect(screen.getByText('Scanning project summaries. Large local histories can take a moment.')).toBeTruthy();
        expect(screen.getAllByLabelText(/loading project row/i)).toHaveLength(5);
    });
});
