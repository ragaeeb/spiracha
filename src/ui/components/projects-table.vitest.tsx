import type { ProjectSummary } from '@spiracha/lib/codex-browser-types';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
    Link: ({
        children,
        className,
        params,
        to,
    }: {
        children: ReactNode;
        className: string;
        params: { project: string };
        to: string;
    }) => (
        <a className={className} href={to.replace('$project', params.project)}>
            {children}
        </a>
    ),
}));

import { ProjectsTable } from './projects-table';

const buildProject = (name: string, lastUpdatedAtMs: number): ProjectSummary => ({
    archivedThreadCount: 0,
    cwdPaths: [`/Users/example/workspace/${name}`],
    lastUpdatedAtMs,
    modelNames: ['gpt-5.5'],
    name,
    threadCount: 1,
    totalTokens: 100,
});

afterEach(() => {
    cleanup();
});

describe('ProjectsTable', () => {
    it('should sort projects by last updated descending by default', () => {
        render(
            <ProjectsTable
                projects={[
                    buildProject('older-project', 1_700_000_000_000),
                    buildProject('newest-project', 1_700_002_000_000),
                    buildProject('middle-project', 1_700_001_000_000),
                ]}
                onDeleteProject={vi.fn()}
            />,
        );

        const projectRows = screen.getAllByRole('row').slice(1);
        expect(projectRows.map((row) => within(row).getAllByRole('link')[0]?.textContent)).toEqual([
            'newest-project1 cwd path',
            'middle-project1 cwd path',
            'older-project1 cwd path',
        ]);
    });
});
