import { describe, expect, it } from 'bun:test';
import { DELETION_PHASE_MAP, hasDurableDeletionReconciliation } from './deletion-phase-map';
import { CONVERSATION_SOURCES } from './types';

describe('deletion phase map', () => {
    it('should declare owned stores for every source without inventing not-applicable cells', () => {
        expect(Object.keys(DELETION_PHASE_MAP).sort()).toEqual([...CONVERSATION_SOURCES].sort());
        expect(hasDurableDeletionReconciliation('codex')).toBe(true);
        expect(hasDurableDeletionReconciliation('cursor')).toBe(true);
        expect(hasDurableDeletionReconciliation('command-code')).toBe(true);
        expect(hasDurableDeletionReconciliation('grok-bot')).toBe(true);
        expect(hasDurableDeletionReconciliation('qoder')).toBe(true);
        expect(hasDurableDeletionReconciliation('opencode')).toBe(true);
        expect(hasDurableDeletionReconciliation('cline')).toBe(false);
        for (const source of CONVERSATION_SOURCES) {
            expect(DELETION_PHASE_MAP[source].phases.length).toBeGreaterThan(0);
            expect(DELETION_PHASE_MAP[source].capability.state).toBe('supported');
        }
    });
});
