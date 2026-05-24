type NativeOpenTarget = {
    kind: 'path' | 'url';
    value: string;
};

const resolveNativeOpenCommand = () => {
    if (process.platform === 'darwin') {
        return {
            argv: (target: NativeOpenTarget) => ['open', target.value],
            label: 'open',
        };
    }

    if (process.platform === 'win32') {
        return {
            argv: (target: NativeOpenTarget) => ['cmd', '/c', 'start', '', target.value],
            label: 'start',
        };
    }

    return {
        argv: (target: NativeOpenTarget) => ['xdg-open', target.value],
        label: 'xdg-open',
    };
};

const openNatively = async (target: NativeOpenTarget) => {
    const command = resolveNativeOpenCommand();
    const proc = Bun.spawn(command.argv(target), {
        stderr: 'pipe',
        stdout: 'ignore',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        const errorText = await new Response(proc.stderr).text();
        throw new Error(
            `Failed to open ${target.value} with ${command.label}: ${errorText.trim() || `exit code ${exitCode}`}`,
        );
    }
};

export const openPathNatively = async (targetPath: string) => {
    await openNatively({
        kind: 'path',
        value: targetPath,
    });
};

export const openUrlNatively = async (url: string) => {
    await openNatively({
        kind: 'url',
        value: url,
    });
};
