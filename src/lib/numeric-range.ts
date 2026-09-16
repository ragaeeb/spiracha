export const getNumericMinimum = (values: readonly number[]): number =>
    values.reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY);

export const getNumericMaximum = (values: readonly number[]): number =>
    values.reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY);
