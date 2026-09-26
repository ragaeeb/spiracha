// Extract only literal exec_command arguments. Never evaluate executor JavaScript.
// Computed arguments, template strings and malformed objects remain opaque.
export const codexShellCommands = (code: string): string[] => {
    if (code.length > 100_000) {
        return [];
    }
    const tokens =
        code.match(
            /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/(?![/*])(?:\\.|[^/\\\n])+\/[dgimsuvy]*|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s]/gu,
        ) ?? [];
    const meaningful = tokens.filter((token) => !token.startsWith('//') && !token.startsWith('/*'));
    const commands: string[] = [];
    for (let i = 0; i < meaningful.length && commands.length < 32; i += 1) {
        if (meaningful.slice(i, i + 5).join(' ') !== 'tools . exec_command ( {') {
            continue;
        }
        const end = meaningful.indexOf('}', i + 5);
        if (end < 0 || meaningful[end + 1] !== ')') {
            continue;
        }
        const object = meaningful
            .slice(i + 4, end + 1)
            .map((token, index, parts) =>
                /^[A-Za-z_$][\w$]*$/u.test(token) && parts[index + 1] === ':' ? JSON.stringify(token) : token,
            )
            .filter((token, index, parts) => token !== ',' || parts[index + 1] !== '}')
            .join('');
        try {
            const args: unknown = JSON.parse(object);
            if (args && typeof args === 'object' && 'cmd' in args && typeof args.cmd === 'string') {
                commands.push(args.cmd);
            }
        } catch {
            /* Computed or unsupported syntax is not shell evidence. */
        }
        i = end;
    }
    return commands;
};
