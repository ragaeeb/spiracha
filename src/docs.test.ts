import { describe, expect, it } from 'bun:test';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { CONVERSATION_SOURCES } from './lib/conversation-data/types';

type MarkdownLink = {
    file: string;
    target: string;
};

const isExternalTarget = (target: string): boolean => {
    return (
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('mailto:') ||
        target.startsWith('#') ||
        target.startsWith('data:')
    );
};

const cleanLinkTarget = (rawTarget: string): string | null => {
    const trimmed = rawTarget.trim();
    if (!trimmed || isExternalTarget(trimmed)) {
        return null;
    }
    return trimmed.split('#')[0]?.split('?')[0] || null;
};

const extractLinksByPattern = (markdown: string, filePath: string, pattern: RegExp): MarkdownLink[] => {
    const links: MarkdownLink[] = [];
    for (const match of markdown.matchAll(pattern)) {
        const cleaned = cleanLinkTarget(match[1] ?? match[2] ?? '');
        if (cleaned) {
            links.push({ file: filePath, target: cleaned });
        }
    }
    return links;
};

const extractLocalMarkdownLinks = (markdown: string, filePath: string): MarkdownLink[] => {
    const mdLinks = extractLinksByPattern(markdown, filePath, /\[[^\]]+\]\(([^)]+)\)/g);
    const htmlLinks = extractLinksByPattern(markdown, filePath, /(?:src|href)=["']([^"']+)["']/g);
    return [...mdLinks, ...htmlLinks];
};

const resolveLocalLink = (sourceFilePath: string, targetPath: string): string => {
    return path.resolve(path.dirname(sourceFilePath), targetPath);
};

describe('documentation drift checks', () => {
    it('should correctly detect broken relative links in arbitrary markdown', async () => {
        const fakeMarkdown = '[Valid Link](./README.md) and [Broken Link](./nonexistent-doc.md)';
        const extracted = extractLocalMarkdownLinks(fakeMarkdown, path.join(process.cwd(), 'README.md'));
        const resolvedBroken = resolveLocalLink(extracted[1].file, extracted[1].target);

        expect(await Bun.file(resolveLocalLink(extracted[0].file, extracted[0].target)).exists()).toBe(true);
        expect(await Bun.file(resolvedBroken).exists()).toBe(false);
    });

    it('should ensure all relative links in README.md and docs/*.md resolve to existing files', async () => {
        const glob = new Bun.Glob('docs/**/*.md');
        const docPaths = [path.join(process.cwd(), 'README.md')];

        for await (const docPath of glob.scan({ absolute: true, cwd: process.cwd() })) {
            docPaths.push(docPath);
        }

        const brokenLinks: { file: string; resolvedPath: string; target: string }[] = [];

        for (const docPath of docPaths) {
            const content = await Bun.file(docPath).text();
            const links = extractLocalMarkdownLinks(content, docPath);

            for (const link of links) {
                const resolved = resolveLocalLink(link.file, link.target);
                const fileExists =
                    (await Bun.file(resolved).exists()) ||
                    (await stat(resolved)
                        .then(() => true)
                        .catch(() => false));
                if (!fileExists) {
                    brokenLinks.push({
                        file: path.relative(process.cwd(), link.file),
                        resolvedPath: path.relative(process.cwd(), resolved),
                        target: link.target,
                    });
                }
            }
        }

        expect(brokenLinks).toEqual([]);
    });

    it('should mention every registered conversation source in documentation', async () => {
        const readmeContent = await Bun.file(path.join(process.cwd(), 'README.md')).text();
        const deletionSafetyContent = await Bun.file(path.join(process.cwd(), 'docs/deletion-safety.md')).text();

        for (const source of CONVERSATION_SOURCES) {
            const foundInReadme = readmeContent.toLowerCase().includes(source);
            const foundInDeletion = deletionSafetyContent.toLowerCase().includes(source);

            expect(
                foundInReadme || foundInDeletion,
                `Source '${source}' must be documented in README.md or deletion-safety.md`,
            ).toBe(true);
        }
    });
});
