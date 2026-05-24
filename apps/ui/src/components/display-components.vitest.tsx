import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JsonPanel } from './json-panel';
import { LoadingPanel } from './loading-panel';
import { MetadataSection } from './metadata-section';
import { MetricCard } from './metric-card';
import { PageHeader } from './page-header';

describe('display components', () => {
    it('should render json panels and metadata cards', () => {
        render(
            <div>
                <JsonPanel title="Raw" value={{ ok: true }} />
                <MetadataSection
                    items={[
                        { label: 'Model', value: 'gpt-5.4' },
                        { label: 'Tokens', value: '42' },
                    ]}
                    title="Metadata"
                />
                <MetricCard helper="Across all threads" label="Tokens" value="42" />
            </div>,
        );

        expect(screen.getByRole('heading', { name: 'Raw' })).toBeTruthy();
        expect(screen.getByText((content) => content.includes('"ok": true'))).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Metadata' })).toBeTruthy();
        expect(screen.getByText('gpt-5.4')).toBeTruthy();
        expect(screen.getByText('Across all threads')).toBeTruthy();
    });

    it('should render loading and page headers with optional content', () => {
        render(
            <div>
                <LoadingPanel description="Loading thread analytics." title="Loading analytics" />
                <PageHeader
                    actions={<button type="button">Refresh</button>}
                    eyebrow="Analytics"
                    subtitle={'Line one\nLine two'}
                    title="Token usage"
                />
            </div>,
        );

        expect(screen.getByText('Loading analytics')).toBeTruthy();
        expect(screen.getByText('Loading thread analytics.')).toBeTruthy();
        expect(screen.getByText('Analytics')).toBeTruthy();
        expect(screen.getByText('Token usage')).toBeTruthy();
        expect(
            screen.getByText((content) => content.includes('Line one') && content.includes('Line two')),
        ).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    });
});
