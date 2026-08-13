type TranscriptLoadState = {
    isPartial: boolean;
} | null;

export const shouldRequestThreadTranscript = ({
    fullRequested,
    shouldDeferTranscriptLoad,
    transcriptMissing,
}: {
    fullRequested: boolean;
    shouldDeferTranscriptLoad: boolean;
    transcriptMissing: boolean;
}) => {
    return fullRequested || (!shouldDeferTranscriptLoad && !transcriptMissing);
};

export const shouldLoadFullThreadTranscript = ({
    shouldLoadTranscript,
    snapshotTranscript,
    transcriptMissing,
}: {
    shouldLoadTranscript: boolean;
    snapshotTranscript: TranscriptLoadState;
    transcriptMissing: boolean;
}) => {
    return shouldLoadTranscript && !transcriptMissing && (snapshotTranscript === null || snapshotTranscript.isPartial);
};
