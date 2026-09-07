#!/usr/bin/env bun

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const outputDirectory = path.join(process.cwd(), 'dist/payload');
const declarationsDirectory = await mkdtemp(path.join(os.tmpdir(), 'spiracha-payload-types-'));

try {
    await rm(outputDirectory, { force: true, recursive: true });
    await Bun.build({
        entrypoints: ['./src/lib/conversation-payload.ts'],
        format: 'esm',
        outdir: outputDirectory,
        target: 'browser',
    });
    const compiler = Bun.spawn(
        [
            process.execPath,
            'x',
            '--no-install',
            'tsc',
            '--project',
            'tsconfig.payload.json',
            '--outDir',
            declarationsDirectory,
        ],
        { stderr: 'inherit', stdout: 'inherit' },
    );
    if ((await compiler.exited) !== 0) {
        throw new Error('Payload declaration generation failed.');
    }

    for (const file of [
        'conversation-payload.d.ts',
        'conversation-payload-types.d.ts',
        'conversation-data/types.d.ts',
    ]) {
        const declaration = await Bun.file(path.join(declarationsDirectory, file)).text();
        await Bun.write(
            path.join(outputDirectory, file),
            declaration.replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/gu, '$1$2.js$3'),
        );
    }
} finally {
    await rm(declarationsDirectory, { force: true, recursive: true });
}
