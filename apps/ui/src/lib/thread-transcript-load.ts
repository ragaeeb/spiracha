type TranscriptLoadState = {
    isPartial: boolean;
} | null;

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
