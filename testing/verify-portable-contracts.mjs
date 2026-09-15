import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Supplemental offline check, not a replacement for Bun, UI, package, or browser gates.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'spiracha-portable-contracts-'));
const compiler = process.env.TSC_BIN || path.join(root, 'node_modules', '.bin', 'tsc');
const require = createRequire(import.meta.url);

try {
    await Bun.write(
        path.join(temporary, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                lib: ['ES2023', 'DOM'],
                module: 'CommonJS',
                moduleResolution: 'Node',
                noEmitOnError: true,
                noUnusedLocals: true,
                noUnusedParameters: true,
                outDir: path.join(temporary, 'compiled'),
                rootDir: path.join(root, 'src'),
                skipLibCheck: true,
                strict: true,
                target: 'ES2022',
                types: [],
            },
            files: [
                'src/lib/conversation-data/source-catalog.ts',
                'src/lib/conversation-data/adapter-helpers.ts',
                'src/lib/raw-export-contract.ts',
                'src/lib/ui-export-archive.ts',
                'src/type-tests/source-contracts.ts',
            ].map((file) => path.join(root, file)),
        }),
    );
    const result = spawnSync(compiler, ['-p', path.join(temporary, 'tsconfig.json')], { encoding: 'utf8' });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.error) {
        throw result.error;
    }
    assert.equal(result.status, 0, 'Portable compilation and negative fixtures must pass');
    console.log('PASS portable TypeScript compilation, including compiler-negative fixtures');

    const load = (file) => require(path.join(temporary, 'compiled', 'lib', file));
    const { CONVERSATION_SOURCES } = load('conversation-data/types.js');
    const { SOURCE_CATALOG, sourceFromDetailRouteSegment } = load('conversation-data/source-catalog.js');
    const { createConversationUiPath } = load('conversation-data/adapter-helpers.js');
    const { decodeRawDownloadBase64 } = load('raw-export-contract.js');
    const { buildRawConversationExportFileName, resolveUniqueRawExportFileName } = load('ui-export-archive.js');
    assert.deepEqual(Object.keys(SOURCE_CATALOG).sort(), [...CONVERSATION_SOURCES].sort());
    const routeNames = await readdir(path.join(root, 'src', 'ui', 'routes'));
    for (const source of CONVERSATION_SOURCES) {
        const descriptor = SOURCE_CATALOG[source];
        assert.equal(descriptor.source, source);
        assert.equal(sourceFromDetailRouteSegment(descriptor.detailRouteSegment), source);
        assert.equal(
            createConversationUiPath(source, 'a/b ?#é'),
            `/${descriptor.detailRouteSegment}/a%2Fb%20%3F%23%C3%A9`,
        );
        assert(routeNames.includes(`${source}.index.tsx`), `${source}: missing inventory route`);
        const matches = routeNames.filter((name) => name.startsWith(`${descriptor.detailRouteSegment}.$`));
        assert.equal(matches.length, 1, `${source}: expected one detail file route`);
        const detailText = await Bun.file(path.join(root, 'src', 'ui', 'routes', matches[0])).text();
        assert(detailText.includes(`createFileRoute('/${descriptor.detailRouteSegment}/$`));
    }
    assert.equal(sourceFromDetailRouteSegment('web-chats'), null);
    assert.equal(sourceFromDetailRouteSegment('cloud'), null);
    assert.deepEqual(
        CONVERSATION_SOURCES.filter((source) => SOURCE_CATALOG[source].scope === 'global'),
        ['grok-bot'],
    );
    for (const source of CONVERSATION_SOURCES) {
        const descriptor = SOURCE_CATALOG[source];
        if (descriptor.scope === 'global') {
            assert.equal('workspaceRoute' in descriptor, false);
            continue;
        }
        const workspaceFile = `${source}.$${descriptor.workspaceRoute.parameterName}.tsx`;
        assert(routeNames.includes(workspaceFile), `${source}: missing workspace route`);
        const workspaceText = await Bun.file(path.join(root, 'src', 'ui', 'routes', workspaceFile)).text();
        assert(workspaceText.includes(`createFileRoute('${descriptor.workspaceRoute.pathTemplate}')`));
    }
    console.log(
        'PASS all 13 catalog IDs, real inventory/detail/workspace file routes, encoded IDs, and Web/Cloud separation',
    );

    assert.deepEqual([...decodeRawDownloadBase64('AP/AQQ0K')], [0, 255, 192, 65, 13, 10]);
    assert.deepEqual([...decodeRawDownloadBase64('')], []);
    assert.throws(() => decodeRawDownloadBase64('not base64!'));
    const blob = new Blob([decodeRawDownloadBase64('AP/AQQ0K')], { type: 'application/json' });
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0, 255, 192, 65, 13, 10]);
    console.log('PASS binary base64 and Blob fidelity: invalid UTF-8, NUL, CRLF, empty and malformed transport');

    assert.equal(buildRawConversationExportFileName('codex', 'id', 'messages.jsonl'), 'messages.jsonl');
    assert.equal(buildRawConversationExportFileName('grok-bot', 'id', '../replica.blob'), 'replica.blob');
    assert.equal(buildRawConversationExportFileName('grok', 'id', 'C:\\private\\history.json'), 'history.json');
    assert.equal(buildRawConversationExportFileName('codex', 'a/b', ''), 'codex-a b.bin');
    assert.equal(buildRawConversationExportFileName('codex', 'id', 'file\r\nname.JSONL'), 'file name.JSONL');
    const used = new Map();
    assert.equal(resolveUniqueRawExportFileName('messages.jsonl', used), 'messages.jsonl');
    assert.equal(resolveUniqueRawExportFileName('messages-2.jsonl', used), 'messages-2.jsonl');
    assert.equal(resolveUniqueRawExportFileName('MESSAGES.jsonl', used), 'MESSAGES-3.jsonl');
    assert.equal(resolveUniqueRawExportFileName('messages.json', used), 'messages.json');
    assert.equal(resolveUniqueRawExportFileName('é.blob', used), 'é.blob');
    assert.equal(resolveUniqueRawExportFileName('e\u0301.blob', used), 'e\u0301-2.blob');
    console.log(
        'PASS native filenames, extensions, sanitization, NFC/case collisions, and generated suffix collisions',
    );
} finally {
    await rm(temporary, { force: true, recursive: true });
}
