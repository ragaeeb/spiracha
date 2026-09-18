import { chat, expect, jsonFile, test } from './fixtures';

test('should import a chat, hydrate its transcript, and survive a direct reload', async ({ page }) => {
    await page.goto('/web');
    await page
        .getByLabel('Import web chat JSON files')
        .setInputFiles(jsonFile('browser-chat.json', chat('e2e-single', 'E2E single import')));
    await expect(page).toHaveURL(/\/web-chats\//u);
    await expect(page.getByRole('heading', { exact: true, name: 'E2E single import' })).toBeVisible();
    await expect(page.getByText('Browser fixture answer 会🙂', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Browser fixture answer 会🙂', { exact: true })).toBeVisible();
    await page.getByRole('tab', { exact: true, name: 'Metadata' }).click();
    await expect(page.getByText('browser-chat.json', { exact: true })).toBeVisible();
});

test('should report one invalid file while retaining the successful import', async ({ page }) => {
    await page.goto('/web');
    await page
        .getByLabel('Import web chat JSON files')
        .setInputFiles([
            jsonFile('valid-mixed.json', chat('e2e-mixed', 'E2E mixed import')),
            { buffer: Buffer.from('not JSON'), mimeType: 'application/json', name: 'broken.json' },
        ]);
    await expect(page.getByRole('alert')).toContainText('broken.json');
    await expect(page.getByRole('alert')).toContainText('File is not valid JSON');
    await expect(page).toHaveURL(/\/web\/?$/u);
    await page.getByRole('link', { name: /^E2E mixed import/u }).click();
    await expect(page.getByText('Browser fixture answer 会🙂', { exact: true })).toBeVisible();
});

test('should download generated Markdown with exact UTF-8 and CRLF bytes', async ({ page }, testInfo) => {
    const content = '# Exact artifact\r\n\r\nOriginal 会🙂 body.  \r\n';
    const payload = {
        ...chat('e2e-artifact', 'E2E artifact import'),
        default_model_slug: 'gemini-3-pro',
        raw_payload: [['im_report', null, 'Report', null, content, [], null, null, [], 'im_report', 3]],
    };
    await page.goto('/web');
    await page.getByLabel('Import web chat JSON files').setInputFiles(jsonFile('gemini.json', payload));
    await expect(page).toHaveURL(/\/web-chats\//u);
    await page.getByRole('tab', { exact: true, name: 'Artifacts' }).click();
    const ready = page.waitForEvent('download');
    await page.getByRole('button', { exact: true, name: 'Download Markdown' }).click();
    const download = await ready;
    expect(download.suggestedFilename()).toBe('artifact-1.md');
    expect(await download.failure()).toBeNull();
    const target = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(target);
    expect(Buffer.from(await Bun.file(target).arrayBuffer())).toEqual(Buffer.from(content));
});
