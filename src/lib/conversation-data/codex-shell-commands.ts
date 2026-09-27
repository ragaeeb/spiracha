// Extract only literal exec_command arguments. Never evaluate executor JavaScript.
// Computed arguments, template strings and malformed objects remain opaque.
const findMatchingCallBrace = (tokens: string[], openingBrace: number) => {
    let depth = 0;
    for (let index = openingBrace; index < tokens.length; index += 1) {
        if (tokens[index] === '{') {
            depth += 1;
        } else if (tokens[index] === '}') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return tokens.length;
};

const readLiteralCommand = (tokens: string[]) => {
    const object = tokens
        .map((token, index, parts) =>
            /^[A-Za-z_$][\w$]*$/u.test(token) && parts[index + 1] === ':' ? JSON.stringify(token) : token,
        )
        .filter((token, index, parts) => token !== ',' || parts[index + 1] !== '}')
        .join('');
    try {
        const args: unknown = JSON.parse(object);
        return args && typeof args === 'object' && 'cmd' in args && typeof args.cmd === 'string' ? args.cmd : null;
    } catch {
        return null;
    }
};

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
    for (let index = 0; index < meaningful.length && commands.length < 32; index += 1) {
        if (meaningful.slice(index, index + 5).join(' ') !== 'tools . exec_command ( {') {
            continue;
        }
        const end = findMatchingCallBrace(meaningful, index + 4);
        if (end === meaningful.length || meaningful[end + 1] !== ')') {
            continue;
        }
        const command = readLiteralCommand(meaningful.slice(index + 4, end + 1));
        if (command !== null) {
            commands.push(command);
        }
        index = end;
    }
    return commands;
};
