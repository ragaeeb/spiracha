import type { WebChatFileInput, WebChatImportError } from '@spiracha/lib/web-chat';
import { MAX_WEB_CHAT_FILE_BYTES, MAX_WEB_CHAT_FILES, MAX_WEB_CHAT_IMPORT_BYTES } from './web-chat-limits';

type ImportFile = Pick<File, 'name' | 'size' | 'text'>;
type ReadResult = { error: WebChatImportError; file?: never } | { error?: never; file: WebChatFileInput };

const readImportFile = async (file: ImportFile): Promise<ReadResult> => {
    if (file.size > MAX_WEB_CHAT_FILE_BYTES) {
        return { error: { fileName: file.name, message: 'File exceeds the 25 MB limit.' } };
    }
    try {
        return { file: { content: await file.text(), name: file.name } };
    } catch {
        return { error: { fileName: file.name, message: 'Could not read this file.' } };
    }
};

export const readImportFiles = async (files: readonly ImportFile[]) => {
    if (files.length > MAX_WEB_CHAT_FILES) {
        throw new Error(`Import at most ${MAX_WEB_CHAT_FILES} files at once.`);
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_WEB_CHAT_IMPORT_BYTES) {
        throw new Error('The selected files exceed the 100 MB import limit.');
    }
    const results = await Promise.all(files.map(readImportFile));
    const errors: WebChatImportError[] = [];
    const payload: WebChatFileInput[] = [];
    for (const result of results) {
        if (result.error) {
            errors.push(result.error);
        } else {
            payload.push(result.file);
        }
    }
    return { errors, payload };
};

export const dedupeImportErrors = (errors: WebChatImportError[]): WebChatImportError[] => [
    ...new Map(errors.map((error) => [`${error.fileName}\0${error.message}`, error])).values(),
];
