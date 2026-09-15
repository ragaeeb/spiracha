import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodexBrowserFixture } from '../../src/lib/codex-test-helpers';
import { buildIsolatedRuntimeEnv } from '../../src/lib/isolated-runtime-test-helpers';

if (!(await Bun.file('dist/app/server.js').exists())) {
    throw new Error('Browser E2E requires the production app build. Run bun run build first.');
}
const root = await mkdtemp(path.join(os.tmpdir(), 'spiracha-browser-e2e-'));
let child: ReturnType<typeof Bun.spawn> | undefined;
let forceKill: ReturnType<typeof setTimeout> | undefined;
const stop = () => {
    child?.kill('SIGTERM');
    forceKill = setTimeout(() => child?.kill('SIGKILL'), 3000);
    forceKill.unref();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
    const fixture = await createCodexBrowserFixture(root);
    child = Bun.spawn([process.execPath, './testing/e2e/app-server.ts'], {
        cwd: process.cwd(),
        env: {
            ...buildIsolatedRuntimeEnv(process.env, root),
            PORT: process.env.SPIRACHA_E2E_PORT ?? '4179',
            SPIRACHA_CODEX_DB: fixture.dbPath,
        },
        stderr: 'inherit',
        stdout: 'inherit',
    });
    process.exitCode = await child.exited;
} finally {
    clearTimeout(forceKill);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await rm(root, { force: true, recursive: true });
}
