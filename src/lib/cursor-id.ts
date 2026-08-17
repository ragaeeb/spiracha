const SAFE_CURSOR_COMPOSER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export const isSafeCursorComposerId = (value: string): boolean => {
    return SAFE_CURSOR_COMPOSER_ID_PATTERN.test(value) && !value.includes('..');
};

export const assertSafeCursorComposerId = (value: string): void => {
    if (!isSafeCursorComposerId(value)) {
        throw new Error(`Invalid Cursor composer id: ${value}`);
    }
};

// The semicolon terminator is the next code point after the colon, so this half-open range
// requires BINARY collation on the key column to remain an indexed prefix scan.
export const getCursorBubbleKeyRange = (composerId: string): { end: string; start: string } => ({
    end: `bubbleId:${composerId};`,
    start: `bubbleId:${composerId}:`,
});

const readStoredCursorBubbleId = (value: string): string | null => {
    try {
        const bubbleId = (JSON.parse(value) as { bubbleId?: unknown } | null)?.bubbleId;
        return typeof bubbleId === 'string' ? bubbleId : null;
    } catch {
        return null;
    }
};

// Composer ids may contain ':', so a lexical half-open range cannot identify the key boundary by itself.
// Valid bubble payloads carry their id; malformed legacy payloads are accepted only when the suffix has no
// additional ':' so a short composer id cannot consume a colon-bearing composer id's rows.
export const isCursorBubbleKeyForComposer = (key: string, value: string, composerId: string): boolean => {
    const prefix = `bubbleId:${composerId}:`;
    if (!key.startsWith(prefix)) {
        return false;
    }

    const suffix = key.slice(prefix.length);
    const storedBubbleId = readStoredCursorBubbleId(value);
    return storedBubbleId === null ? !suffix.includes(':') : storedBubbleId === suffix;
};
