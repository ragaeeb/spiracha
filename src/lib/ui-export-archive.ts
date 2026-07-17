import type { ExportFormat } from './shared';

type BatchExportNameEntry = {
    cwd: string | null;
    updatedAtMs: number | null;
};

type ConversationExportNameEntry = BatchExportNameEntry & {
    id: string;
};

const getPortablePathBasename = (value: string): string => {
    const trimmed = value.replace(/[\\/]+$/u, '');
    if (!trimmed) {
        return '';
    }

    const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return separatorIndex === -1 ? trimmed : trimmed.slice(separatorIndex + 1);
};

export const sanitizeExportFileName = (value: string) => {
    return value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, ' ')
        .replace(/\.\.+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
};

export const getExportMimeType = (outputFormat: ExportFormat) => {
    return outputFormat === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';
};

export const resolveUniqueExportFileBaseName = (baseName: string, usedCounts: Map<string, number>) => {
    const normalizeKey = (value: string) => value.normalize('NFC').toLowerCase();
    const baseKey = normalizeKey(baseName);
    let count = (usedCounts.get(baseKey) ?? 0) + 1;
    let candidate = count === 1 ? baseName : `${baseName}-${count}`;

    while (usedCounts.has(normalizeKey(candidate))) {
        count += 1;
        candidate = `${baseName}-${count}`;
    }

    usedCounts.set(baseKey, count);
    usedCounts.set(normalizeKey(candidate), Math.max(usedCounts.get(normalizeKey(candidate)) ?? 0, 1));
    return candidate;
};

const formatBatchExportDate = (value: number) => {
    const date = new Date(value);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}-${hours}${minutes}`;
};

const resolveExportProjectName = (cwd: string | null, fallbackProjectName: string) => {
    return sanitizeExportFileName(getPortablePathBasename(cwd ?? '') || fallbackProjectName) || 'threads';
};

export const buildConversationExportBaseName = (
    { cwd, id, updatedAtMs }: ConversationExportNameEntry,
    fallbackProjectName: string,
) => {
    const projectName = resolveExportProjectName(cwd, fallbackProjectName);
    const shortId = sanitizeExportFileName(id).slice(0, 8) || 'conversation';
    return Number.isFinite(updatedAtMs) && (updatedAtMs ?? 0) > 0
        ? `${projectName}-${formatBatchExportDate(updatedAtMs!)}-${shortId}`
        : `${projectName}-${shortId}`;
};

export const buildBatchExportBaseName = (entries: BatchExportNameEntry[], fallbackProjectName: string) => {
    if (entries.length === 0) {
        throw new Error('No conversations selected for export');
    }

    const firstCwd = entries.find((entry) => entry.cwd?.trim())?.cwd ?? null;
    const projectName = resolveExportProjectName(firstCwd, fallbackProjectName);
    const latestUpdatedAtMs = Math.max(
        ...entries.map((entry) => (Number.isFinite(entry.updatedAtMs) ? (entry.updatedAtMs ?? 0) : 0)),
    );

    return latestUpdatedAtMs > 0
        ? `${projectName}-${formatBatchExportDate(latestUpdatedAtMs)}-threads-${entries.length}`
        : `${projectName}-threads-${entries.length}`;
};

const readPipeText = async (pipe: ReadableStream<Uint8Array> | number | undefined) => {
    return pipe && typeof pipe !== 'number' ? new Response(pipe).text() : '';
};

const runZip = async (args: string[], options: { cwd?: string } = {}) => {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
        proc = Bun.spawn(['zip', '-9', ...args], {
            cwd: options.cwd,
            stderr: 'pipe',
            stdout: 'pipe',
        });
    } catch (error) {
        throw new Error(
            `zip command failed to start. Install the "zip" executable or choose a non-zip export. ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    const [stdoutText, stderrText, exitCode] = await Promise.all([
        readPipeText(proc.stdout),
        readPipeText(proc.stderr),
        proc.exited,
    ]);

    if (exitCode !== 0) {
        const output = (stderrText || stdoutText).trim();
        throw new Error(
            output
                ? `zip command failed (${exitCode}): ${output}`
                : `zip command failed (${exitCode}). Install the "zip" executable or choose a non-zip export.`,
        );
    }
};

export const zipExportFile = async (sourcePath: string, zipPath: string) => {
    await runZip(['-j', zipPath, sourcePath]);
};

export const zipExportDirectory = async (sourceDirectory: string, zipPath: string) => {
    await runZip(['-r', zipPath, '.'], { cwd: sourceDirectory });
};
