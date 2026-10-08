import { describe, expect, it } from 'vitest';
import { describeCodexExportIssues } from './codex-export-issues';

const titles: Record<string, string> = { a: 'Connel', b: 'Xenos' };
const titleOf = (threadId: string) => titles[threadId];

describe('describeCodexExportIssues', () => {
    it('should label skipped threads by title and explain each failure in plain language', () => {
        const issues = describeCodexExportIssues(
            {
                skippedThreads: [
                    {
                        code: 'CODEX_THREAD_NOT_FOUND',
                        message: 'Thread a was not found.',
                        status: 'missing',
                        threadId: 'a',
                    },
                    {
                        code: 'CODEX_ROLLOUT_MISSING',
                        message: 'Rollout file is missing',
                        status: 'missing',
                        threadId: 'b',
                    },
                    { code: 'CODEX_NO_EXPORTABLE_CONTENT', message: 'x', status: 'failed', threadId: 'c' },
                    {
                        code: 'CODEX_TRANSCRIPT_HISTORY_INVALID',
                        message: 'Bad fork metadata',
                        status: 'failed',
                        threadId: 'd',
                    },
                ],
            },
            titleOf,
        );

        expect(issues.skipped).toEqual([
            { label: 'Connel', reason: 'The thread no longer exists.' },
            { label: 'Xenos', reason: 'Its session file is missing.' },
            { label: 'c', reason: 'It had nothing to export with the selected options.' },
            { label: 'd', reason: 'Its history could not be read: Bad fork metadata' },
        ]);
    });

    it('should fall back to the raw message for an unrecognized failure', () => {
        const issues = describeCodexExportIssues(
            {
                skippedThreads: [
                    { code: 'CODEX_EXPORT_UNREADABLE', message: 'Disk on fire', status: 'failed', threadId: 'a' },
                ],
            },
            titleOf,
        );

        expect(issues.skipped).toEqual([{ label: 'Connel', reason: 'Disk on fire' }]);
    });

    it('should list threads exported without their earlier history', () => {
        const issues = describeCodexExportIssues(
            {
                partialThreads: [
                    {
                        note: 'History before the fork is unavailable: parent thread p no longer exists.',
                        threadId: 'b',
                    },
                ],
            },
            titleOf,
        );

        expect(issues).toEqual({
            partial: [
                { label: 'Xenos', reason: 'History before the fork is unavailable: parent thread p no longer exists.' },
            ],
            skipped: [],
        });
    });

    it('should report no issues when nothing was skipped or partial', () => {
        expect(describeCodexExportIssues({}, titleOf)).toEqual({ partial: [], skipped: [] });
    });
});
