#!/usr/bin/env bun

import { rm } from 'node:fs/promises';
import path from 'node:path';

const sourceDirectory = path.join(process.cwd(), 'dist/server');
const outputDirectory = path.join(process.cwd(), 'dist/app');

await rm(outputDirectory, { force: true, recursive: true });
const result = await Bun.build({
    entrypoints: [path.join(sourceDirectory, 'server.js')],
    minify: true,
    outdir: outputDirectory,
    target: 'bun',
});

if (!result.success) {
    for (const log of result.logs) {
        console.error(log);
    }
    process.exitCode = 1;
}
