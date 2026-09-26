import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import path from 'node:path';
import { asRecord } from './grok-bot-payload';

const readEncryptedSession = async (persistenceDir: string) => {
    const file = Bun.file(path.join(path.dirname(persistenceDir), 'gateway-descriptor.json'));
    if (!(await file.exists())) {
        throw new Error(
            'Open Grok Bot and sign in before deleting bots or groups. No saved gateway session was found.',
        );
    }
    if (file.size > 1024 * 1024) {
        throw new Error('Invalid Grok Bot gateway session.');
    }
    const wrapped = asRecord(await file.json());
    let encrypted = wrapped?.encrypted;
    if (wrapped?.version === 2) {
        const entries = Object.values(asRecord(wrapped.entries) ?? {});
        if (entries.length !== 1) {
            throw new Error('Grok Bot gateway session is ambiguous or empty. Open Grok Bot and sign in again.');
        }
        encrypted = asRecord(entries[0])?.encrypted;
    } else if (wrapped?.version !== 1) {
        throw new Error('Unsupported Grok Bot gateway session version.');
    }
    if (typeof encrypted !== 'string' || !encrypted) {
        throw new Error('Invalid Grok Bot gateway session.');
    }
    const bytes = Buffer.from(encrypted, 'base64');
    if (bytes.subarray(0, 3).toString() !== 'v10' || process.platform !== 'darwin') {
        throw new Error('Grok Bot gateway deletion requires macOS Safe Storage.');
    }
    return bytes;
};

const loadGatewaySession = async (persistenceDir: string) => {
    const bytes = await readEncryptedSession(persistenceDir);
    let descriptor: Record<string, unknown> | null;
    try {
        const child = Bun.spawn(['/usr/bin/security', 'find-generic-password', '-w', '-s', 'Grok Bot Safe Storage'], {
            stderr: 'ignore',
            stdout: 'pipe',
            timeout: 10_000,
        });
        const [secret, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        if (exitCode !== 0 || !secret.trimEnd()) {
            throw new Error('Keychain unavailable');
        }
        const key = pbkdf2Sync(secret.trimEnd(), 'saltysalt', 1003, 16, 'sha1');
        const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
        descriptor = asRecord(
            JSON.parse(Buffer.concat([decipher.update(bytes.subarray(3)), decipher.final()]).toString()),
        );
    } catch {
        throw new Error(
            'Unable to unlock the Grok Bot gateway session. Allow Grok Bot Safe Storage access and sign in again.',
        );
    }
    if (typeof descriptor?.baseUrl !== 'string' || typeof descriptor.token !== 'string' || !descriptor.token) {
        throw new Error('Incomplete Grok Bot gateway session.');
    }
    const url = new URL(descriptor.baseUrl);
    const allowedHost = ['cursor.sh', 'cursor.com', 'cursorvm.com'].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    if (url.protocol !== 'https:' || !allowedHost || url.username || url.password || url.search || url.hash) {
        throw new Error('Refusing to send Grok Bot credentials to an unrecognized gateway.');
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(asRecord(descriptor.headers) ?? {})) {
        if (typeof value !== 'string') {
            throw new Error('Invalid Grok Bot gateway routing headers.');
        }
        headers.set(name, value);
    }
    headers.set('authorization', `Bearer ${descriptor.token}`);
    headers.set('content-type', 'application/json');
    return { baseUrl: url.href.replace(/\/$/u, ''), headers };
};

const gatewayCall = async (
    session: Awaited<ReturnType<typeof loadGatewaySession>>,
    method: 'listAgents' | 'deleteAgent',
    body: Record<string, string>,
): Promise<unknown> => {
    try {
        const response = await fetch(`${session.baseUrl}/api/${method}`, {
            body: JSON.stringify(body),
            headers: session.headers,
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error('Gateway rejected request');
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (response.body) {
            for await (const chunk of response.body) {
                size += chunk.byteLength;
                if (size > 2 * 1024 * 1024) {
                    throw new Error('Gateway response too large');
                }
                chunks.push(chunk);
            }
        }
        const text = Buffer.concat(chunks).toString();
        const data: unknown = text ? JSON.parse(text) : {};
        if (asRecord(data)?.error) {
            throw new Error('Gateway reported an error');
        }
        return data;
    } catch {
        throw new Error(
            method === 'deleteAgent'
                ? 'Grok Bot deletion was not confirmed. Check the bot/group in Grok Bot before retrying; local files were not changed.'
                : 'Unable to list bots/groups from the Grok Bot gateway. Open Grok Bot and check your sign-in and connection.',
        );
    }
};

export const deleteGrokBotAgent = async (persistenceDir: string, id: string): Promise<boolean> => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(id)) {
        throw new Error('Invalid Grok Bot conversation id.');
    }
    const session = await loadGatewaySession(persistenceDir);
    const roster = await gatewayCall(session, 'listAgents', {});
    const agents = Array.isArray(roster) ? roster : asRecord(roster)?.agents;
    if (
        !Array.isArray(agents) ||
        agents.some((agent) => {
            const record = asRecord(agent);
            return typeof (record?.id ?? record?.agentId) !== 'string';
        })
    ) {
        throw new Error('Invalid Grok Bot gateway roster.');
    }
    if (!agents.some((agent) => (asRecord(agent)?.id ?? asRecord(agent)?.agentId) === id)) {
        return false;
    }
    await gatewayCall(session, 'deleteAgent', { id });
    return true;
};
