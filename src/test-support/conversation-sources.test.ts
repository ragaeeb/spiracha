import { describe, expect, it } from 'bun:test';
import { CONVERSATION_SOURCES } from '../lib/conversation-data/types';
import { SOURCE_FIXTURE_OWNERS } from './conversation-sources';

describe('source fixture owners', () => {
    it('should register an actual native, adapter, and UI action test for every source', async () => {
        expect(Object.keys(SOURCE_FIXTURE_OWNERS).sort()).toEqual([...CONVERSATION_SOURCES].sort());
        for (const source of CONVERSATION_SOURCES) {
            const owner = SOURCE_FIXTURE_OWNERS[source];
            expect(owner.nativeTest.length).toBeGreaterThan(0);
            expect(await Bun.file(owner.nativeTest).exists()).toBe(true);
            expect(await Bun.file(owner.adapterTest).exists()).toBe(true);
            expect(await Bun.file(owner.uiActionTest).exists()).toBe(true);
        }
    });
});
