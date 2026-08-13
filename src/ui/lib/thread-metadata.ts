const humanizePolicy = (value: string) => value.replaceAll(/[-_]+/gu, ' ');

export const formatSandboxPolicy = (serializedPolicy: string) => {
    const trimmed = serializedPolicy.trim();
    if (!trimmed) {
        return 'n/a';
    }

    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (typeof parsed === 'string') {
            return humanizePolicy(parsed);
        }
        if (parsed && typeof parsed === 'object' && 'type' in parsed && typeof parsed.type === 'string') {
            return humanizePolicy(parsed.type);
        }
    } catch {
        return humanizePolicy(trimmed);
    }

    return humanizePolicy(trimmed);
};
