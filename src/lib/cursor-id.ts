const SAFE_CURSOR_COMPOSER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export const isSafeCursorComposerId = (value: string): boolean => {
    return SAFE_CURSOR_COMPOSER_ID_PATTERN.test(value) && !value.includes('..');
};

export const assertSafeCursorComposerId = (value: string): void => {
    if (!isSafeCursorComposerId(value)) {
        throw new Error(`Invalid Cursor composer id: ${value}`);
    }
};

const escapeSqlLikeValue = (value: string): string => value.replace(/[\\%_]/gu, '\\$&');

export const buildCursorBubbleKeyLikePattern = (composerId: string): string => {
    return `bubbleId:${escapeSqlLikeValue(composerId)}:%`;
};
