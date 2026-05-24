const SQLITE_RETRYABLE_PATTERNS = [
    /unable to open database file/iu,
    /database is locked/iu,
    /SQLITE_BUSY/iu,
    /SQLITE_CANTOPEN/iu,
];

export const isRetryableSqliteError = (error: unknown) => {
    if (!(error instanceof Error)) {
        return false;
    }

    return SQLITE_RETRYABLE_PATTERNS.some((pattern) => pattern.test(error.message));
};
