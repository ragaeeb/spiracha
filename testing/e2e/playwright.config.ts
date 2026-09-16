import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.SPIRACHA_E2E_PORT ?? 4179);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('SPIRACHA_E2E_PORT must be an integer from 1024 to 65535.');
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    forbidOnly: Boolean(process.env.CI),
    fullyParallel: false,
    outputDir: path.join(root, 'test-results/e2e'),
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(root, 'playwright-report') }]],
    retries: 0,
    testDir: '.',
    testMatch: '*.e2e.ts',
    timeout: 30000,
    use: { baseURL, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
    webServer: {
        command: 'bun ./testing/e2e/server.ts',
        cwd: root,
        env: { SPIRACHA_E2E_PORT: String(port) },
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
        reuseExistingServer: false,
        timeout: 30000,
        url: `${baseURL}/api/v1/sources`,
    },
    workers: 1,
});
