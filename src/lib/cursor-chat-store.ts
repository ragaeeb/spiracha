import { createHash } from 'node:crypto';
import path from 'node:path';

export type CursorChatModel = {
    model: string;
    reasoningEffort: string | null;
};

const CURSOR_GROK_MODEL_PATTERN = /(?:^|[^A-Za-z0-9._-])cursor-(grok-[0-9.]+)-(low|medium|high)(?=$|[^A-Za-z0-9._-])/u;

export const decodeCursorChatModel = (values: Iterable<string | Uint8Array>): CursorChatModel | null => {
    const decoder = new TextDecoder();
    for (const value of values) {
        const text = typeof value === 'string' ? value : decoder.decode(value);
        const match = text.match(CURSOR_GROK_MODEL_PATTERN);
        if (match) {
            return { model: match[1], reasoningEffort: match[2] };
        }
    }

    return null;
};

export const resolveCursorChatStorePath = async (projectDir: string, composerId: string): Promise<string | null> => {
    try {
        const trustedWorkspace = (await Bun.file(path.join(projectDir, '.workspace-trusted')).json()) as {
            workspacePath?: unknown;
        };
        if (typeof trustedWorkspace.workspacePath !== 'string' || !trustedWorkspace.workspacePath.trim()) {
            return null;
        }

        const chatsDir = path.resolve(projectDir, '..', '..', 'chats');
        const workspaceHash = createHash('md5').update(trustedWorkspace.workspacePath).digest('hex');
        const storePath = path.resolve(chatsDir, workspaceHash, composerId, 'store.db');
        const relativePath = path.relative(chatsDir, storePath);
        if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
            return null;
        }

        return (await Bun.file(storePath).exists()) ? storePath : null;
    } catch {
        return null;
    }
};
