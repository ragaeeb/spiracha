import { isRetryableSqliteError } from '@spiracha/lib/sqlite-error';

export type ErrorPresentation = {
    description: string;
    isDatabaseError: boolean;
    title: string;
};

type ErrorPresentationOptions = {
    fallbackTitle: string;
};

const DATABASE_ERROR_DESCRIPTION =
    'Spiracha could not open a local conversation database. The source application may have an exclusive lock on the file, or the database may not exist yet. Close the relevant application or wait a moment, then reload.';

export const getErrorPresentation = (error: Error, options: ErrorPresentationOptions): ErrorPresentation => {
    if (isRetryableSqliteError(error)) {
        return {
            description: DATABASE_ERROR_DESCRIPTION,
            isDatabaseError: true,
            title: 'Database unavailable',
        };
    }

    return {
        description: error.message,
        isDatabaseError: false,
        title: options.fallbackTitle,
    };
};
