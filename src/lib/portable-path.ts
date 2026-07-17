export const getPortablePathBasename = (value: string): string => {
    const trimmed = value.replace(/[\\/]+$/u, '');
    if (!trimmed) {
        return '';
    }

    const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return separatorIndex === -1 ? trimmed : trimmed.slice(separatorIndex + 1);
};
