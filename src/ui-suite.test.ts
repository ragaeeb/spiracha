import { describe, expect, it } from 'bun:test';

const UI_SUITE_TIMEOUT_MS = 60_000;

type SpawnResult = {
    exitCode: number;
    stderrText: string;
    stdoutText: string;
};

const runUiVitestSuite = async (packageRoot: string): Promise<SpawnResult> => {
    const proc = Bun.spawn(['bun', 'run', 'test:ui'], {
        cwd: packageRoot,
        stderr: 'pipe',
        stdout: 'pipe',
    });

    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
        const exitCode = await Promise.race([
            proc.exited,
            new Promise<never>((_, reject) => {
                timeoutId = setTimeout(async () => {
                    proc.kill();

                    const [stdoutText, stderrText] = await Promise.all([
                        stdoutPromise.catch(() => ''),
                        stderrPromise.catch(() => ''),
                    ]);

                    reject(
                        new Error(
                            [
                                `UI Vitest suite exceeded ${UI_SUITE_TIMEOUT_MS}ms`,
                                stdoutText.trim() ? `stdout:\n${stdoutText}` : '',
                                stderrText.trim() ? `stderr:\n${stderrText}` : '',
                            ]
                                .filter(Boolean)
                                .join('\n\n'),
                        ),
                    );
                }, UI_SUITE_TIMEOUT_MS);
            }),
        ]);

        const [stdoutText, stderrText] = await Promise.all([stdoutPromise, stderrPromise]);

        return {
            exitCode,
            stderrText,
            stdoutText,
        };
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        if (proc.exitCode === null) {
            proc.kill();
            await proc.exited.catch(() => undefined);
        }
    }
};

describe('UI tests', () => {
    it(
        'should pass the Vitest UI suite',
        async () => {
            const packageRoot = process.cwd();
            const { exitCode, stderrText, stdoutText } = await runUiVitestSuite(packageRoot);

            expect(exitCode).toBe(0);
            expect(`${stdoutText}\n${stderrText}`).not.toContain('FAIL');
        },
        UI_SUITE_TIMEOUT_MS + 5_000,
    );
});
