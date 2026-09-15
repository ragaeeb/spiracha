import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';

const threadId = '019e36d7-ba2d-7fa1-b662-3f70fbbda248';

test('should download a real fixture transcript through the export dialog', async ({ page }, testInfo) => {
    await page.goto(`/threads/${threadId}`);
    await expect(page.getByRole('heading', { name: 'Implement the Spiracha UI', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Zip archive', exact: true }).uncheck();
    const ready = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download export', exact: true }).click();
    const download = await ready;
    expect(download.suggestedFilename()).toMatch(/\.md$/u);
    expect(await download.failure()).toBeNull();
    const target = testInfo.outputPath('conversation.md');
    await download.saveAs(target);
    expect(await readFile(target, 'utf8')).toContain('Implemented /Users/example/workspace/spiracha/src/index.ts');
});

test('should leave the conversation intact when deletion is cancelled', async ({ page, request }) => {
    await page.goto(`/threads/${threadId}`);
    const before = await request.get(`/api/v1/conversations/codex/${threadId}`);
    expect(before.ok()).toBe(true);
    const detail = await before.json();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('checkbox', { name: 'Delete Session files', exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const after = await request.get(`/api/v1/conversations/codex/${threadId}`);
    expect(after.ok()).toBe(true);
    expect(await after.json()).toEqual(detail);
});

test('should deny a hostile-origin destructive request against the production server', async ({ request }) => {
    const response = await request.delete(`/api/v1/conversations/codex/${threadId}`, {
        headers: { Origin: 'https://untrusted.invalid' },
    });
    expect(response.status()).toBe(403);
    expect((await request.get(`/api/v1/conversations/codex/${threadId}`)).ok()).toBe(true);
});
