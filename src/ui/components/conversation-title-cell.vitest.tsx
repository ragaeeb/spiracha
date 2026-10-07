import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationTitleCell } from './conversation-title-cell';
import { ToolCallHitsProvider } from './tool-call-hits-context';

afterEach(() => {
    cleanup();
});

const renderLink = (content: ReactNode, className: string) => (
    <a className={className} href="/conversation">
        {content}
    </a>
);

describe('ConversationTitleCell', () => {
    it('should show the title and the conversation id inside one link', () => {
        render(<ConversationTitleCell id="thread-1" renderLink={renderLink} title="Continue reverse engineering" />);

        const link = screen.getByRole('link');
        expect(link.textContent).toContain('Continue reverse engineering');
        expect(link.textContent).toContain('thread-1');
    });

    it('should render the id as muted small text without monospace', () => {
        render(<ConversationTitleCell id="thread-1" renderLink={renderLink} title="Title" />);

        const idLine = screen.getByText('thread-1');
        expect(idLine.className).toContain('text-xs');
        expect(idLine.className).toContain('text-[var(--muted-foreground)]');
        expect(idLine.className).not.toContain('font-mono');
    });

    it('should place badges beside the title and the footer outside the link', () => {
        render(
            <ConversationTitleCell
                badges={<span>archived</span>}
                footer={<span>Older moved snapshot</span>}
                id="id-1"
                renderLink={renderLink}
                title="Title"
            />,
        );

        const link = screen.getByRole('link');
        expect(link.textContent).toContain('archived');
        expect(link.textContent).not.toContain('Older moved snapshot');
        expect(screen.getByText('Older moved snapshot')).toBeTruthy();
    });

    it('should indent nested rows by depth and mark agent rows with a fork icon', () => {
        const { container } = render(
            <ConversationTitleCell depth={2} id="child" isNestedAgent renderLink={renderLink} title="Child" />,
        );

        const frame = container.querySelector('[data-row-depth="2"]') as HTMLElement | null;
        expect(frame?.style.paddingLeft).toBe('1.5rem');
        expect(frame?.className).toContain('border-l-2');
        expect(container.querySelector('svg')).toBeTruthy();
    });

    it('should not indent or add an icon for top-level rows', () => {
        const { container } = render(<ConversationTitleCell id="root" renderLink={renderLink} title="Root" />);

        const frame = container.querySelector('[data-row-depth="0"]') as HTMLElement | null;
        expect(frame?.style.paddingLeft).toBe('');
        expect(frame?.className).not.toContain('border-l-2');
        expect(container.querySelector('svg')).toBeNull();
    });

    it('should show tool call matches only for rows that have a hit in the active search', () => {
        const hit = {
            conversationId: 'thread-1',
            likelyAuthor: true,
            matchCount: 1,
            matches: [
                {
                    createdAtMs: null,
                    field: 'input' as const,
                    messageId: 'm1',
                    modifiesFile: true,
                    snippet: 'file.test.ts',
                    toolName: 'Write',
                },
            ],
            title: 'Thread',
            updatedAtMs: null,
        };
        render(
            <ToolCallHitsProvider hits={new Map([['thread-1', hit]])}>
                <ConversationTitleCell id="thread-1" renderLink={renderLink} title="Matched" />
                <ConversationTitleCell id="thread-2" renderLink={renderLink} title="Unmatched" />
            </ToolCallHitsProvider>,
        );

        expect(screen.getAllByText('Likely author')).toHaveLength(1);
        expect(screen.getByText('Write')).toBeTruthy();
    });
});
