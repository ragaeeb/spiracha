import { describe, expect, it, spyOn } from 'bun:test';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { settleDeleteBatch } from './conversation-data/mutation-executor';
import { deleteGrokBotAgent } from './grok-bot-gateway';

const gatewayCases = [
    { error: 'Invalid Grok Bot gateway roster.', reasonCode: 'gateway_roster_invalid', scenario: 'malformed-roster' },
    { error: 'ambiguous or empty', reasonCode: 'gateway_session_unavailable', scenario: 'ambiguous' },
    { error: 'unrecognized gateway', reasonCode: 'gateway_session_unavailable', scenario: 'untrusted' },
];

const writeGatewayDescriptor = async (appDir: string, scenario: string) => {
    const baseUrl = scenario === 'untrusted' ? 'https://cursor.sh.attacker.test' : 'https://fixture.cursor.sh';
    const cipher = createCipheriv(
        'aes-128-cbc',
        pbkdf2Sync('fixture-secret', 'saltysalt', 1003, 16, 'sha1'),
        Buffer.alloc(16, 32),
    );
    const clear = JSON.stringify({ baseUrl, token: 'fixture-token' });
    const encrypted = Buffer.concat([Buffer.from('v10'), cipher.update(clear), cipher.final()]).toString('base64');
    const descriptor =
        scenario === 'ambiguous'
            ? { entries: { active: { encrypted }, other: { encrypted } }, version: 2 }
            : { encrypted, version: 1 };
    await Bun.write(path.join(appDir, 'gateway-descriptor.json'), JSON.stringify(descriptor));
};

describe.skipIf(process.platform !== 'darwin')('Grok Bot gateway pre-request conflicts', () => {
    it.each(gatewayCases)(
        'should classify $scenario failures as no-effect conflicts',
        async ({ error, reasonCode, scenario }) => {
            const appDir = await mkdtemp(path.join(os.tmpdir(), 'grok-gateway-conflict-'));
            const persistenceDir = path.join(appDir, 'sand-client-persistence');
            await mkdir(persistenceDir);
            const spawn = Bun.spawn;
            const processMock = spyOn(Bun, 'spawn').mockImplementation(() =>
                spawn([process.execPath, '-e', 'process.stdout.write("fixture-secret")'], { stdout: 'pipe' }),
            );
            const requests: string[] = [];
            const gateway = spyOn(globalThis, 'fetch').mockImplementation(
                Object.assign(
                    async (input: Parameters<typeof fetch>[0]) => {
                        requests.push(String(input));
                        return Response.json({ agents: [{ name: 'missing-id' }] });
                    },
                    { preconnect: fetch.preconnect },
                ),
            );
            try {
                await writeGatewayDescriptor(appDir, scenario);
                const id = 'bd5bbf01-a4e1-47f8-885f-f2188cf04aab';
                const failure = await deleteGrokBotAgent(persistenceDir, id).then(
                    () => null,
                    (caught: unknown) => caught,
                );

                expect(failure).toMatchObject({ reasonCode });
                requests.length = 0;
                const result = await settleDeleteBatch({
                    concurrency: 1,
                    deleteOne: async (targetId) => ({
                        deletedFiles: [],
                        deletedIds: (await deleteGrokBotAgent(persistenceDir, targetId)) ? [targetId] : [],
                    }),
                    ids: [id],
                });

                expect(result.outcomes[0]).toMatchObject({
                    effect: 'none',
                    error: { code: 'mutation_conflict', message: expect.stringContaining(error), retryable: true },
                    status: 'failed',
                });
                expect(requests).toEqual(
                    scenario === 'malformed-roster' ? ['https://fixture.cursor.sh/api/listAgents'] : [],
                );
            } finally {
                gateway.mockRestore();
                processMock.mockRestore();
                await rm(appDir, { force: true, recursive: true });
            }
        },
    );
});
