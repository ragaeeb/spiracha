import { formatModelLabel as formatSharedModelLabel } from '@spiracha/lib/model-label';

type DateTimeFormatOptions = {
    now?: Date;
    timeZone?: string;
};

type DateTimeFormatterSet = {
    dayKeyFormatter: Intl.DateTimeFormat;
    timePartsFormatter: Intl.DateTimeFormat;
};

const DATE_TIME_FORMATTERS = new Map<string, DateTimeFormatterSet>();

const getDateTimeFormatters = (timeZone?: string): DateTimeFormatterSet => {
    const cacheKey = timeZone ?? 'local';
    const cached = DATE_TIME_FORMATTERS.get(cacheKey);
    if (cached) {
        return cached;
    }

    const created = {
        dayKeyFormatter: new Intl.DateTimeFormat('en-CA', {
            day: '2-digit',
            month: '2-digit',
            timeZone,
            year: 'numeric',
        }),
        timePartsFormatter: new Intl.DateTimeFormat('en-US', {
            day: 'numeric',
            hour: 'numeric',
            hour12: true,
            minute: '2-digit',
            month: 'short',
            timeZone,
            year: 'numeric',
        }),
    };

    DATE_TIME_FORMATTERS.set(cacheKey, created);
    return created;
};

const buildDayKey = (date: Date, timeZone?: string) => {
    return getDateTimeFormatters(timeZone).dayKeyFormatter.format(date);
};

const formatTimeParts = (date: Date, timeZone?: string) => {
    const parts = getDateTimeFormatters(timeZone).timePartsFormatter.formatToParts(date);
    const partMap = new Map(parts.map((part) => [part.type, part.value]));
    const hour = partMap.get('hour');
    const minute = partMap.get('minute');
    const dayPeriod = partMap.get('dayPeriod');

    if (!hour || !minute || !dayPeriod) {
        return null;
    }

    return {
        day: partMap.get('day') ?? '',
        month: partMap.get('month') ?? '',
        time: `${hour}:${minute} ${dayPeriod}`.trim(),
        year: partMap.get('year') ?? '',
    };
};

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

export const formatDateTime = (
    value: number | string | null | undefined,
    options: DateTimeFormatOptions = {},
): string => {
    if (value === null || value === undefined || value === '') {
        return 'n/a';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'n/a';
    }

    const now = options.now ?? new Date();
    const parts = formatTimeParts(date, options.timeZone);
    if (!parts) {
        return 'n/a';
    }

    const { day, month, time, year } = parts;
    const isToday = buildDayKey(date, options.timeZone) === buildDayKey(now, options.timeZone);

    if (isToday) {
        return time;
    }

    const currentYear = formatTimeParts(now, options.timeZone)?.year;
    if (year && currentYear && year !== currentYear) {
        return `${month} ${day}, ${year} · ${time}`;
    }

    return `${month} ${day} · ${time}`;
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

export const formatModelLabel = formatSharedModelLabel;
