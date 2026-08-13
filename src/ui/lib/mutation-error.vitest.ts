import { describe, expect, it } from 'vitest';
import { getMutationErrorMessage } from './mutation-error';

describe('getMutationErrorMessage', () => {
    it('should expose Error messages and normalize unknown failures', () => {
        expect(getMutationErrorMessage(null, 'Delete failed')).toBeNull();
        expect(getMutationErrorMessage(new Error('Database is busy'), 'Delete failed')).toBe('Database is busy');
        expect(getMutationErrorMessage('failure', 'Delete failed')).toBe('Delete failed');
        expect(getMutationErrorMessage({ message: 'Structured delete failure' }, 'Delete failed')).toBe(
            'Structured delete failure',
        );
    });
});
