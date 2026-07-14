export const formatModelLabel = (value: string | null | undefined): string => {
    if (!value) {
        return 'Assistant';
    }

    const parts = value.split(/[-_\s]+/u).filter(Boolean);
    if (parts[0]?.toLowerCase() === 'claude') {
        const majorIndex = parts.findIndex(
            (part, index) => /^\d{1,2}$/u.test(part) && /^\d{1,2}$/u.test(parts[index + 1] ?? ''),
        );
        if (majorIndex >= 0) {
            parts.splice(majorIndex, 2, `${parts[majorIndex]}.${parts[majorIndex + 1]}`);
        }
    }

    return parts
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
