import type { ThreadEvent } from './codex-browser-types';

const isCommentaryMessage = (event: ThreadEvent) =>
    event.kind === 'message' && event.role === 'assistant' && event.phase === 'commentary';

export type CodexTranscriptEventFilters = {
    showCommentary: boolean;
    showExtraEvents: boolean;
    showToolCalls: boolean;
    showUserMessages: boolean;
};

export const shouldShowCodexTranscriptEvent = (event: ThreadEvent, filters: CodexTranscriptEventFilters) => {
    if (isCommentaryMessage(event) && !filters.showCommentary) {
        return false;
    }

    if (event.kind === 'message') {
        if (event.role === 'user' && !filters.showUserMessages) {
            return false;
        }

        return !event.isHiddenByDefault || filters.showExtraEvents;
    }

    if (event.kind === 'tool_call' || event.kind === 'tool_output') {
        return filters.showToolCalls;
    }

    return filters.showExtraEvents;
};
