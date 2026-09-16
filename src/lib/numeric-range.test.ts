import { describe, expect, it } from 'bun:test';
import { getNumericMaximum, getNumericMinimum } from './numeric-range';

describe('numeric range', () => {
    it('should preserve numeric bounds including empty arrays and non-finite values', () => {
        expect(getNumericMinimum([])).toBe(Number.POSITIVE_INFINITY);
        expect(getNumericMaximum([])).toBe(Number.NEGATIVE_INFINITY);
        expect(getNumericMinimum([1.5, -2, 0])).toBe(-2);
        expect(getNumericMaximum([1.5, -2, 0])).toBe(1.5);
        expect(getNumericMinimum([Number.NaN])).toBe(Number.NaN);
        expect(getNumericMaximum([Number.POSITIVE_INFINITY])).toBe(Number.POSITIVE_INFINITY);
    });
});
