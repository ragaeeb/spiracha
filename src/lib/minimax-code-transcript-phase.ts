import type { MiniMaxCodeTranscriptMessage } from './minimax-code-exporter-types';

export type MiniMaxCodeMessagePhase = 'commentary' | 'final_answer' | null;

export const getMiniMaxCodeMessagePhase = (message: MiniMaxCodeTranscriptMessage): MiniMaxCodeMessagePhase => {
    if (message.role !== 'assistant') {
        return null;
    }

    return message.finishReason === 'stop' ? 'final_answer' : 'commentary';
};
