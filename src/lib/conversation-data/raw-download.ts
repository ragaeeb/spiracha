import path from 'node:path';
import type { ConversationRawDownload } from './types';

export const createRawConversationDownload = async (filePath: string): Promise<ConversationRawDownload | null> => {
    const extension = path.extname(filePath).toLowerCase();
    if (extension !== '.json' && extension !== '.jsonl') {
        return null;
    }
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
        return null;
    }

    return {
        blob: file,
        fileName: path.basename(filePath),
        mimeType: extension === '.jsonl' ? 'application/x-ndjson' : 'application/json',
    };
};
