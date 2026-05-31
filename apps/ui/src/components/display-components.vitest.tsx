import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Breadcrumbs } from './breadcrumbs';
import { JsonPanel } from './json-panel';
import { LoadingPanel } from './loading-panel';
import { MetadataSection } from './metadata-section';
import { MetricCard } from './metric-card';
import { PageHeader } from './page-header';
import { TextDocumentPanel } from './text-document-panel';

vi.mock('@tanstack/react-router', () => ({
    Link: ({
        children,
        className,
        params,
        to,
    }: {
        children: ReactNode;
        className?: string;
        params?: Record<string, string>;
        to: string;
    }) => {
        let href = to;
        for (const [key, value] of Object.entries(params ?? {})) {
            href = href.replace(`$${key}`, value);
        }
        return (
            <a className={className} href={href}>
                {children}
            </a>
        );
    },
}));

describe('display components', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

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
                <TextDocumentPanel content={'# Heading\n\nbody'} title="Transcript" />
                <Breadcrumbs
                    items={[
                        { label: 'Codex', to: '/projects' },
                        { label: 'demo', params: { project: 'demo' }, to: '/projects/$project' },
                        { label: 'Current thread' },
                    ]}
                />
            </div>,
        );

        expect(screen.getByRole('heading', { name: 'Raw' })).toBeTruthy();
        expect(screen.getByText((content) => content.includes('"ok": true'))).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Metadata' })).toBeTruthy();
        expect(screen.getByText('gpt-5.4')).toBeTruthy();
        expect(screen.getByText('Across all threads')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Transcript' })).toBeTruthy();
        expect(screen.getByText((content) => content.includes('# Heading'))).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Codex' }).getAttribute('href')).toBe('/projects');
        expect(screen.getByRole('link', { name: 'demo' }).getAttribute('href')).toBe('/projects/demo');
        expect(screen.getByText('Current thread').getAttribute('aria-current')).toBe('page');
    });

    it('should render loading and page headers with optional content', () => {
        render(
            <div>
                <LoadingPanel description="Loading thread analytics." title="Loading analytics" />
                <PageHeader
                    actions={<button type="button">Refresh</button>}
                    breadcrumb={<div>Breadcrumb trail</div>}
                    eyebrow="Analytics"
                    subtitle={'Line one\nLine two'}
                    title="Token usage"
                />
            </div>,
        );

        expect(screen.getByText('Loading analytics')).toBeTruthy();
        expect(screen.getByText('Loading thread analytics.')).toBeTruthy();
        expect(screen.getByText('Breadcrumb trail')).toBeTruthy();
        expect(screen.getByText('Analytics')).toBeTruthy();
        expect(screen.getByText('Token usage')).toBeTruthy();
        expect(
            screen.getByText((content) => content.includes('Line one') && content.includes('Line two')),
        ).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    });

    it('should avoid duplicate React keys when breadcrumb labels and destinations repeat', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <Breadcrumbs
                items={[{ label: 'Codex', to: '/projects' }, { label: 'Codex', to: '/projects' }, { label: 'Codex' }]}
            />,
        );

        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
});
