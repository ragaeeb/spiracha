export const getMutationErrorMessage = (error: unknown, fallback: string): string | null => {
    if (!error) {
        return null;
    }

    return error instanceof Error ? error.message : fallback;
};
