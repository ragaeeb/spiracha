import { describe, expect, it } from 'vitest';
import { shouldLoadFullThreadTranscript } from './thread-transcript-load';

describe('thread transcript load helpers', () => {
    it('should allow loading a full transcript when the snapshot only has a partial preview', () => {
        expect(
            shouldLoadFullThreadTranscript({
                shouldLoadTranscript: true,
                snapshotTranscript: { isPartial: true },
                transcriptMissing: false,
            }),
        ).toBe(true);
    });

    it('should not load again when the snapshot already has the full transcript', () => {
        expect(
            shouldLoadFullThreadTranscript({
                shouldLoadTranscript: true,
                snapshotTranscript: { isPartial: false },
                transcriptMissing: false,
            }),
        ).toBe(false);
    });

    it('should require an explicit load request and an available transcript file', () => {
        expect(
            shouldLoadFullThreadTranscript({
                shouldLoadTranscript: false,
                snapshotTranscript: { isPartial: true },
                transcriptMissing: false,
            }),
        ).toBe(false);
        expect(
            shouldLoadFullThreadTranscript({
                shouldLoadTranscript: true,
                snapshotTranscript: { isPartial: true },
                transcriptMissing: true,
            }),
        ).toBe(false);
    });
});
