import { describe, expect, it } from 'bun:test';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../../..');

const ENTRYPOINTS = [
    'src/lib/conversation-data/capability.ts',
    'src/lib/conversation-data/operation-types.ts',
    'src/lib/conversation-data/source-catalog.ts',
    'src/lib/conversation-payload-types.ts',
    'src/lib/conversation-payload.ts',
];

const FORBIDDEN_SPECIFIERS =
    /^(?:node:|bun:|fs(?:\/promises)?|react(?:-dom)?(?:\/.*)?|@tanstack\/react-(?:router|start|query)(?:\/.*)?|.+keychain)/u;

const VALUE_FROM = /(?:^|\n)(?:import|export)(?!\s+type\b)[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT = /(?:^|\n)import\s+['"]([^'"]+)['"]/g;

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');

const collectMatches = (source: string, pattern: RegExp) =>
    [...source.matchAll(new RegExp(pattern.source, pattern.flags))].flatMap((match) => (match[1] ? [match[1]] : []));

const resolveExistingRelative = async (fromFile: string, specifier: string) => {
    const resolved = path.normalize(path.join(path.dirname(fromFile), specifier));
    for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.tsx`, path.join(resolved, 'index.ts')]) {
        if (candidate.startsWith('src/') && (await Bun.file(path.join(ROOT, candidate)).exists())) {
            return candidate;
        }
    }
    return null;
};

const runtimeSpecifiersFrom = (source: string) => [
    ...collectMatches(source, VALUE_FROM),
    ...collectMatches(source, SIDE_EFFECT),
];

const isFollowableModule = (next: string | null, seen: Set<string>) =>
    Boolean(next && !next.includes('.test.') && !next.includes('.vitest.') && !seen.has(next));

const walkRuntimeGraph = async () => {
    const queue = [...ENTRYPOINTS];
    const seen = new Set<string>();
    const runtimeSpecifiers: Array<{ file: string; specifier: string }> = [];

    while (queue.length > 0) {
        const relative = queue.pop();
        if (!relative || seen.has(relative)) {
            continue;
        }
        seen.add(relative);
        const source = stripComments(await Bun.file(path.join(ROOT, relative)).text());
        for (const specifier of runtimeSpecifiersFrom(source)) {
            runtimeSpecifiers.push({ file: relative, specifier });
            if (!specifier.startsWith('.')) {
                continue;
            }
            const next = await resolveExistingRelative(relative, specifier);
            if (isFollowableModule(next, seen)) {
                queue.push(next!);
            }
        }
    }

    return { runtimeSpecifiers, seen };
};

describe('portable catalog and payload import graph', () => {
    it('should keep catalog and payload runtime imports free of storage, React, and router modules', async () => {
        const { runtimeSpecifiers, seen } = await walkRuntimeGraph();
        expect(seen.size).toBeGreaterThan(ENTRYPOINTS.length);
        expect(runtimeSpecifiers.filter(({ specifier }) => FORBIDDEN_SPECIFIERS.test(specifier))).toEqual([]);
    });
});
