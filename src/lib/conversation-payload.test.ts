import { describe, expect, it } from 'bun:test';
import { createContext, runInContext } from 'node:vm';
import { convertConversationPayload } from './conversation-payload';
import { geminiResearchPayload, payloadSourceFixtures } from './conversation-payload-test-helpers';

describe('portable payload conversion', () => {
    it('should bundle and convert every source using only Web runtime APIs', async () => {
        const build = await Bun.build({
            entrypoints: [import.meta.dir + '/conversation-payload.ts'],
            format: 'cjs',
            plugins: [
                {
                    name: 'reject-runtime-imports',
                    setup(builder) {
                        builder.onResolve({ filter: /^(?:bun|node):/ }, ({ path }) => {
                            throw new Error(`Payload conversion imports a runtime dependency: ${path}`);
                        });
                    },
                },
            ],
            target: 'browser',
        });
        expect(build.success).toBe(true);
        const context = createContext({ crypto, module: { exports: {} }, TextEncoder, URL });
        runInContext(await build.outputs[0]!.text(), context);
        const portableConvert = runInContext(
            'module.exports.convertConversationPayload',
            context,
        ) as typeof convertConversationPayload;
        for (const fixture of payloadSourceFixtures) {
            const options = { payload: JSON.stringify(fixture.payload) };
            const actual = await portableConvert(options);
            expect(JSON.parse(JSON.stringify(actual))).toEqual(await convertConversationPayload(options));
            expect(actual[0]!.source).toBe(fixture.source);
            expect(actual[0]!.markdown).toContain('Consumer answer');
            await expect(portableConvert({ payload: {}, source: fixture.source })).rejects.toThrow();
        }
        const [research] = await portableConvert({
            fileName: 'Gemini.json',
            payload: JSON.stringify(geminiResearchPayload),
        });
        expect(research!.artifacts[0]!.content).toBe(
            '# Findings\n\nEvidence [cite: 1]\n\n## Works cited\n\n1. [Source](<https://example.com/source>)\n',
        );
        expect(research!.messages.some((message) => message.toolEvidence?.name === 'browse_page')).toBe(true);
        await expect(portableConvert({ payload: 'invalid JSON' })).rejects.toMatchObject({ code: 'invalid_json' });
        await expect(portableConvert({ payload: {}, source: 'claude-code' as never })).rejects.toMatchObject({
            code: 'unsupported_source',
        });
        await expect(portableConvert({ payload: 'ع'.repeat(13 * 1024 * 1024) })).rejects.toMatchObject({
            code: 'invalid_input',
        });
    });
});
