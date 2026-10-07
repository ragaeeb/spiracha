import type { ToolCallSearchHit } from '@spiracha/lib/conversation-data/tool-call-search';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolCallMatchSummary } from './tool-call-match-summary';

afterEach(() => {
    cleanup();
});

const hit = (overrides: Partial<ToolCallSearchHit> = {}): ToolCallSearchHit => ({
    conversationId: 'thread-1',
    likelyAuthor: false,
    matchCount: 1,
    matches: [
        {
            createdAtMs: null,
            field: 'output',
            messageId: 'm1',
            modifiesFile: false,
            snippet: '?? products/kodeback/src/file.test.ts',
            toolName: 'Bash',
        },
    ],
    title: 'Thread',
    updatedAtMs: null,
    ...overrides,
});

describe('ToolCallMatchSummary', () => {
    it('should show each matched tool call with its tool name and snippet', () => {
        render(<ToolCallMatchSummary hit={hit()} />);

        expect(screen.getByText('Bash')).toBeTruthy();
        expect(screen.getByText('?? products/kodeback/src/file.test.ts')).toBeTruthy();
        expect(screen.queryByText('Likely author')).toBeNull();
    });

    it('should flag threads that wrote the file as likely authors', () => {
        render(
            <ToolCallMatchSummary
                hit={hit({
                    likelyAuthor: true,
                    matches: [
                        {
                            createdAtMs: null,
                            field: 'input',
                            messageId: 'm2',
                            modifiesFile: true,
                            snippet: '{"file_path":"/repo/file.test.ts"}',
                            toolName: 'Write',
                        },
                    ],
                })}
            />,
        );

        expect(screen.getByText('Likely author')).toBeTruthy();
        expect(screen.getByText('Write')).toBeTruthy();
    });

    it('should say how many further matches are not shown', () => {
        render(<ToolCallMatchSummary hit={hit({ matchCount: 9 })} />);

        expect(screen.getByText('9 matches · showing 1')).toBeTruthy();
    });
});
