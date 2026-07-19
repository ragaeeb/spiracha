export const getMutationErrorMessage = (error: unknown, fallback: string): string | null => {
    if (!error) {
        return null;
    }

    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) {
        return error.message;
    }

    return fallback;
};
