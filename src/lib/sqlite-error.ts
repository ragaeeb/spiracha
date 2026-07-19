const SQLITE_RETRYABLE_CODES = new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_CANTOPEN', 'SQLITE_LOCKED']);
const SQLITE_OPERATION_PREFIX = String.raw`(?:SQLite operation failed after \d+ attempts?:\s*)?`;
const SQLITE_RETRYABLE_PATTERNS = [
    new RegExp(`^${SQLITE_OPERATION_PREFIX}unable to open database(?: file)?(?:$|:)`, 'iu'),
    new RegExp(`^${SQLITE_OPERATION_PREFIX}database(?: table)? is locked(?:$|:)`, 'iu'),
    /^SQLITE_(?:BUSY|CANTOPEN|LOCKED)(?:_[A-Z_]+)?(?:$|:)/u,
];
const SQLITE_DATABASE_PATTERNS = [
    ...SQLITE_RETRYABLE_PATTERNS,
    /^SQLITE_[A-Z_]+(?:$|:)/u,
    new RegExp(
        `^${SQLITE_OPERATION_PREFIX}(?:attempt to write a readonly database|database disk image is malformed|disk I/O error)(?:$|:)`,
        'iu',
    ),
];

const getSqliteCode = (error: Error): string | null => {
    const code = 'code' in error ? error.code : null;
    return typeof code === 'string' && code.startsWith('SQLITE_') ? code.toUpperCase() : null;
};

export const isRetryableSqliteError = (error: unknown) => {
    if (!(error instanceof Error)) {
        return false;
    }

    const code = getSqliteCode(error);
    return (
        Boolean(code && SQLITE_RETRYABLE_CODES.has(code)) ||
        SQLITE_RETRYABLE_PATTERNS.some((pattern) => pattern.test(error.message))
    );
};

export const isSqliteDatabaseError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
        return false;
    }

    return getSqliteCode(error) !== null || SQLITE_DATABASE_PATTERNS.some((pattern) => pattern.test(error.message));
};
