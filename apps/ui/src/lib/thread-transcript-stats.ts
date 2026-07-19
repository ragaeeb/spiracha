import type { ThreadEvent, ThreadTranscriptStats } from '@spiracha/lib/codex-browser-types';

const EXEC_TOOL_NAMES = new Set([
    'bash',
    'exec',
    'exec_command',
    'execute',
    'execute_command',
    'run_command',
    'shell',
    'terminal',
]);

const isExecToolName = (name: string | null | undefined): boolean => {
    return EXEC_TOOL_NAMES.has((name ?? '').trim().toLowerCase());
};

const updateMessageStats = (stats: ThreadTranscriptStats, event: Extract<ThreadEvent, { kind: 'message' }>) => {
    stats.messageCount += 1;
    if (event.role === 'assistant') {
        stats.assistantMessageCount += 1;
    }
    if (event.role === 'user') {
        stats.userMessageCount += 1;
    }
    if (event.phase === 'commentary') {
        stats.commentaryCount += 1;
    }
    if (event.phase === 'final_answer') {
        stats.finalAnswerCount += 1;
    }
};

export const getThreadTranscriptStats = (events: ThreadEvent[]): ThreadTranscriptStats => {
    const stats: ThreadTranscriptStats = {
        assistantMessageCount: 0,
        commentaryCount: 0,
        execCommandCount: 0,
        finalAnswerCount: 0,
        messageCount: 0,
        toolCallCount: 0,
        toolOutputCount: 0,
        userMessageCount: 0,
        webSearchEventCount: 0,
    };

    for (const event of events) {
        if (event.kind === 'message') {
            updateMessageStats(stats, event);
        }
        if (event.kind === 'tool_call') {
            stats.toolCallCount += 1;
            if (isExecToolName(event.name)) {
                stats.execCommandCount += 1;
            }
        }
        if (event.kind === 'tool_output') {
            stats.toolOutputCount += 1;
        }
        if (event.kind === 'web_search') {
            stats.webSearchEventCount += 1;
        }
    }

    return stats;
};
