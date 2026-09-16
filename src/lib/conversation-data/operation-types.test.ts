import { describe, expect, it } from 'bun:test';
import { isRejectedExceptionReason, serializeSourceOperation, validateOperationCapability } from './operation-types';
import { SOURCE_MUTATION_BINDINGS, SOURCE_READ_BINDINGS } from './source-bindings.server';
import { SOURCE_CATALOG } from './source-catalog';
import { CONVERSATION_SOURCES } from './types';

describe('source operation declarations', () => {
    it('should reject blank and placeholder exception reasons', () => {
        expect(isRejectedExceptionReason('')).toBe(true);
        expect(isRejectedExceptionReason('  not implemented  ')).toBe(true);
        expect(isRejectedExceptionReason('read-only adapter')).toBe(true);
        expect(isRejectedExceptionReason('later')).toBe(true);
        expect(isRejectedExceptionReason('Shared tables have no standalone conversation file.')).toBe(false);
        expect(() =>
            validateOperationCapability({
                reason: 'not implemented',
                reasonCode: 'pending',
                state: 'unsupported',
            } as never),
        ).toThrow(/reviewed reason/);
        expect(serializeSourceOperation({ state: 'supported', value: { owner: 'source_reader' } })).toEqual({
            owner: 'source_reader',
            state: 'supported',
        });
    });

    it('should bind required reads for every source and raw handlers only when supported', () => {
        for (const source of CONVERSATION_SOURCES) {
            const binding = SOURCE_READ_BINDINGS[source];
            expect(binding.source).toBe(source);
            expect(typeof binding.list.handler).toBe('function');
            expect(typeof binding.detail.handler).toBe('function');
            expect(Object.hasOwn(binding.original_raw, 'handler')).toBe(
                SOURCE_CATALOG[source].capabilities.original_raw.state === 'supported',
            );
            expect(typeof SOURCE_MUTATION_BINDINGS[source].delete.handler).toBe('function');
            expect(typeof SOURCE_MUTATION_BINDINGS[source].batch_delete.handler).toBe('function');
        }
    });
});
