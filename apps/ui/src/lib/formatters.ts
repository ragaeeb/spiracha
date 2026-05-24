// Month abbreviations are fixed strings — deterministic regardless of locale,
// which avoids SSR/client hydration mismatches.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
};

export const formatTokens = (value: number) => {
    return `${formatNumber(value)} tokens`;
};

export const formatBytes = (value: number | null | undefined) => {
    if (!value || value <= 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const fractionDigits = size >= 100 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(fractionDigits)} ${units[unitIndex]}`;
};

export const formatDateTime = (value: number | string | null | undefined): string => {
    if (value === null || value === undefined || value === '') {
        return 'n/a';
    }

    const date = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'n/a';
    }

    // Format as locale-specific concise time: "May 16 · 2:30 PM" or "2:30 PM" if today
    const today = new Date();
    const isToday =
        date.getUTCDate() === today.getUTCDate() &&
        date.getUTCMonth() === today.getUTCMonth() &&
        date.getUTCFullYear() === today.getUTCFullYear();

    const month = MONTHS[date.getUTCMonth()];
    const day = date.getUTCDate();
    const hours12 = date.getUTCHours() % 12 || 12;
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const ampm = date.getUTCHours() >= 12 ? 'PM' : 'AM';

    if (isToday) {
        return `${hours12}:${minutes} ${ampm}`;
    }

    return `${month} ${day} · ${hours12}:${minutes} ${ampm}`;
};

export const formatList = (values: string[]) => {
    if (values.length === 0) {
        return 'n/a';
    }

    return values.join(', ');
};

export const formatPercent = (value: number, total: number) => {
    if (total <= 0) {
        return '0%';
    }

    return `${Math.round((value / total) * 100)}%`;
};

export const formatBooleanLabel = (value: boolean) => {
    return value ? 'Yes' : 'No';
};

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
