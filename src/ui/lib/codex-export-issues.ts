import type { CodexPartialThread, CodexSkippedThread } from '@spiracha/lib/codex-browser-export';
import type { ExportIssues } from '#/lib/export-options';

const REASONS: Record<string, (message: string) => string> = {
    CODEX_NO_EXPORTABLE_CONTENT: () => 'It had nothing to export with the selected options.',
    CODEX_ROLLOUT_CONTENT_INVALID: () => 'Its session file could not be read consistently.',
    CODEX_ROLLOUT_MISSING: () => 'Its session file is missing.',
    CODEX_ROLLOUT_MUTATED: () => 'It changed while it was being exported; try again.',
    CODEX_ROLLOUT_UNREADABLE: () => 'Its session file could not be read.',
    CODEX_THREAD_NOT_FOUND: () => 'The thread no longer exists.',
    CODEX_TRANSCRIPT_HISTORY_INVALID: (message) => `Its history could not be read: ${message}`,
};

/** Turns a Codex batch export's skipped and partial threads into labelled, plain-language lines for the dialog. */
export const describeCodexExportIssues = (
    download: { partialThreads?: CodexPartialThread[]; skippedThreads?: CodexSkippedThread[] },
    titleOf: (threadId: string) => string | undefined,
): ExportIssues => ({
    partial: (download.partialThreads ?? []).map((thread) => ({
        label: titleOf(thread.threadId) ?? thread.threadId,
        reason: thread.note,
    })),
    skipped: (download.skippedThreads ?? []).map((thread) => ({
        label: titleOf(thread.threadId) ?? thread.threadId,
        reason: REASONS[thread.code]?.(thread.message) ?? thread.message,
    })),
});
