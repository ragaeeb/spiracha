import type { FxTranscriptMessage } from './fx-exporter-types';

export type FxMessagePhase = 'commentary' | 'final_answer' | null;

export const getFxMessagePhase = (message: FxTranscriptMessage): FxMessagePhase => {
    if (message.role !== 'assistant') {
        return null;
    }
    return message.finishReason === 'stop' ? 'final_answer' : 'commentary';
};
