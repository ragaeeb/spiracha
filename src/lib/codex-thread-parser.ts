import type { ParsedCodexTranscript } from './codex-browser-types';
import {
    consumeTranscriptRecord,
    createEmptySessionMeta,
    createTranscriptState,
    finalizeTranscript,
    type ParseCodexTranscriptOptions,
} from './codex-transcript-records';
import { readJsonlObjects } from './shared';

export const parseCodexTranscriptFile = async (
    sessionFile: string,
    options: ParseCodexTranscriptOptions = {},
): Promise<ParsedCodexTranscript> => {
    const sessionMeta = createEmptySessionMeta();
    const state = createTranscriptState(options);
    for await (const parsed of readJsonlObjects(sessionFile)) {
        consumeTranscriptRecord(parsed, state, sessionMeta);
        if (state.shouldStop) {
            break;
        }
    }
    return finalizeTranscript(state, sessionMeta, options);
};
