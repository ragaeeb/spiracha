export type CodexThreadLiveStatus = 'connected' | 'connecting' | 'reconnecting';

type QueryInvalidator = {
    invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<unknown>;
};

type ConnectCodexThreadLiveUpdatesOptions = {
    onStatusChange: (status: CodexThreadLiveStatus) => void;
    onTranscriptChange: () => void;
    threadId: string;
};

export const connectCodexThreadLiveUpdates = ({
    onStatusChange,
    onTranscriptChange,
    threadId,
}: ConnectCodexThreadLiveUpdatesOptions) => {
    onStatusChange('connecting');
    const source = new EventSource(`/api/v1/codex/threads/${encodeURIComponent(threadId)}/events`);
    source.onopen = () => onStatusChange('connected');
    source.onerror = () => onStatusChange('reconnecting');
    source.addEventListener('transcript-changed', onTranscriptChange);
    return () => source.close();
};

export const refreshCodexThreadLiveQueries = async (queryClient: QueryInvalidator, threadId: string) => {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread', threadId] }),
        queryClient.invalidateQueries({ queryKey: ['thread-transcript-preview', threadId] }),
        queryClient.invalidateQueries({ queryKey: ['thread-transcript', threadId] }),
    ]);
};
