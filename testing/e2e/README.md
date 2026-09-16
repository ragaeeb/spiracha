# Production browser checks

These tests run Chromium against the built app, with real TanStack server functions, SQLite fixtures, hydration and downloads. They do not substitute a mocked HTTP backend. They are not the packaged CLI smoke test; the runner uses the existing production-server function directly.

## Setup (required; not completed in the audit environment)

1. Use the repository's Bun 1.4.2+ toolchain and run `bun install --frozen-lockfile`.
2. Run `bun add --dev --exact @playwright/test`. Review and commit **both** root `package.json` and `bun.lock`. No Playwright dependency or fabricated lock entry was added offline. Do not create another application manifest. Pin the resolved version and use that same version for the browser installation.
3. Run `bunx playwright install chromium` (or `bunx playwright install --with-deps chromium` in a suitable Linux CI image).
4. Run `bunx tsc --noEmit --project testing/e2e/tsconfig.json`.
5. Run `bun run build` and then `bunx playwright test --config testing/e2e/playwright.config.ts`.

The original archive lacks `bin/spiracha.ts`. Restore that original file before package/CLI validation. The browser runner itself does not invent or require a replacement CLI, but it does require `dist/app/server.js` and `dist/client` from the real build.

## Isolation and diagnostics

The launcher uses a unique temporary HOME, source discovery roots, database, caches and export directory. It drops inherited credentials, proxy variables and runtime preload options. It never reuses an existing server. Port 4179 is reserved by default; set `SPIRACHA_E2E_PORT` to an unused nonprivileged port for concurrent jobs. Chromium uses a fresh context per test. Non-loopback browser requests are blocked. The fixtures are not a sandbox against arbitrary server code: run CI with no live credentials, no mounted personal agent directories and outbound network disabled where practical.

Files deliberately use `.e2e.ts` rather than `.test.ts` or `.spec.ts`, so Bun does not discover Playwright tests in the ordinary root suite. The separate TypeScript project checks the browser harness after its optional dependency is installed.

Tests run serially without retries to expose failures. Downloads are read back and compared, not merely clicked. Unexpected browser JavaScript errors fail the test. Trace, screenshot and download evidence is saved on failure. Review traces as sensitive artifacts even with fixtures. Stop signals terminate the child and remove its temporary directory; SIGKILL cannot execute cleanup and is outside that guarantee.

The tests were authored and syntax-checked, **not executed** in the supplied environment. First run may expose browser selectors or framework-version differences; fix the assertions or product behavior without weakening them. Pending expansion: destructive confirmation and persistence, SSE reconnect/append, ZIP menu download, keyboard/focus checks, offline/errors and browser/viewport matrix. See the ledger for individual acceptance criteria.

The payload portability spec serves only the compiled `dist/payload/*.js` graph into Chromium and a real module Worker, then compares results for all 12 existing portable-source fixtures. It requires `bun run build:payload`. A browser Worker is not an emulation of Cloudflare's runtime; deployment-specific Worker validation remains pending. No loader shim, Node global, Bun global or mocked converter is used in the browser tests.
