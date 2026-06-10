import type { ExportFormat } from './shared';

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
    const count = (usedCounts.get(baseName) ?? 0) + 1;
    usedCounts.set(baseName, count);
    return count === 1 ? baseName : `${baseName}-${count}`;
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
