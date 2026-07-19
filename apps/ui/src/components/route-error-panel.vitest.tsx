import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteErrorPanel } from './route-error-panel';

describe('RouteErrorPanel', () => {
    it('should render centralized database guidance for every retryable SQLite error', () => {
        render(<RouteErrorPanel error={new Error('SQLITE_CANTOPEN: missing database')} title="Failed to load Qoder" />);

        expect(screen.getByText('Database unavailable')).toBeTruthy();
        expect(screen.getByText(/local conversation database/iu)).toBeTruthy();
        expect(screen.queryByText('Failed to load Qoder')).toBeNull();
    });

    it('should preserve a route-specific title and error message for unrelated failures', () => {
        render(<RouteErrorPanel error={new Error('Unexpected parser failure')} title="Failed to load Qoder" />);

        expect(screen.getByText('Failed to load Qoder')).toBeTruthy();
        expect(screen.getByText('Unexpected parser failure')).toBeTruthy();
    });
});
