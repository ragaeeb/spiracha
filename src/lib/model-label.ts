export const formatModelLabel = (value: string | null | undefined): string => {
    if (!value) {
        return 'Assistant';
    }

    return value
        .split(/[-_\s]+/u)
        .filter(Boolean)
        .map((part) => {
            const lower = part.toLowerCase();
            if (lower === 'gpt') {
                return 'GPT';
            }
            if (/^[a-z]\d$/u.test(lower)) {
                return lower.toUpperCase();
            }
            if (/^\d+(\.\d+)*$/u.test(part)) {
                return part;
            }

            return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
        })
        .join(' ');
};
