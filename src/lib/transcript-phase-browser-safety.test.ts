import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

describe('browser-safe transcript phase modules', () => {
    it('should not import Node or Bun runtime modules', async () => {
        const moduleNames = (await readdir(import.meta.dir))
            .filter((name) => name.endsWith('-transcript-phase.ts'))
            .sort();
        const unsafeImports: string[] = [];

        for (const moduleName of moduleNames) {
            const source = await Bun.file(path.join(import.meta.dir, moduleName)).text();
            for (const line of source.split('\n')) {
                if (/^import\s+(?!type\b).*?from\s+['"](?:node:|bun:)/u.test(line.trim())) {
                    unsafeImports.push(`${moduleName}: ${line.trim()}`);
                }
            }
        }

        expect(moduleNames.length).toBeGreaterThan(0);
        expect(unsafeImports).toEqual([]);
    });
});
