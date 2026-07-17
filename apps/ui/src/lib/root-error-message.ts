import { isRetryableSqliteError } from '@spiracha/lib/sqlite-error';

export type RootErrorPresentation = {
    description: string;
    isDatabaseError: boolean;
    title: string;
};

export const getRootErrorPresentation = (error: Error): RootErrorPresentation => {
    if (isRetryableSqliteError(error)) {
        return {
            description:
                'Spiracha could not open a local conversation database. The source application may have an exclusive lock on the file, or the database may not exist yet. Close the relevant application or wait a moment, then reload.',
            isDatabaseError: true,
            title: 'Database unavailable',
        };
    }

    return {
        description: error.message,
        isDatabaseError: false,
        title: 'Something went wrong',
    };
};
