#!/usr/bin/env bun

type CoverageProfileName = 'root' | 'ui';

type CoverageProfile = {
    excludeSubstrings: string[];
    lcovPath: string;
    minimumLineCoverage: number;
};

type FileCoverageSummary = {
    filePath: string;
    functionCoverage: number;
    functionHits: number;
    functionTotal: number;
    lineCoverage: number;
    lineHits: number;
    lineTotal: number;
};

type CoverageSummary = {
    fileSummaries: FileCoverageSummary[];
    functionCoverage: number;
    functionHits: number;
    functionTotal: number;
    lineCoverage: number;
    lineHits: number;
    lineTotal: number;
    minimumLineCoverage: number;
    profile: CoverageProfileName;
};

const COVERAGE_PROFILES: Record<CoverageProfileName, CoverageProfile> = {
    root: {
        excludeSubstrings: ['src/coverage-check.ts', 'src/lib/codex-test-helpers.ts'],
        lcovPath: 'coverage/lcov.info',
        minimumLineCoverage: 90,
    },
    ui: {
        excludeSubstrings: [
            'src/ui/components/projects-table.tsx',
            'src/ui/components/ui/',
            'src/ui/integrations/',
            'src/ui/lib/codex-queries.ts',
            'src/ui/lib/codex-server.ts',
            'src/ui/router.tsx',
            'src/ui/routes/',
            'src/ui/routeTree.gen.ts',
        ],
        lcovPath: 'coverage/ui/lcov.info',
        minimumLineCoverage: 90,
    },
};

const normalizePercent = (hits: number, total: number) => {
    if (total <= 0) {
        return 100;
    }

    return Number(((hits / total) * 100).toFixed(2));
};

const readLcovCount = (lines: string[], label: string, required = true): number | undefined => {
    const values = lines.filter((line) => line.startsWith(`${label}:`)).map((line) => line.slice(label.length + 1));
    if (!required && values.length === 0) {
        return undefined;
    }
    const value = Number(values[0]);
    if (values.length !== 1 || !/^\d+$/u.test(values[0]) || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Invalid LCOV ${label} count.`);
    }
    return value;
};

const parseLcovBlock = (block: string) => {
    const lines = block.trim().split(/\r?\n/u);
    const sourceLines = lines.filter((line) => line.startsWith('SF:'));
    if (sourceLines.length === 0) {
        return null;
    }
    const filePath = sourceLines[0].slice(3).replaceAll('\\', '/');
    if (sourceLines.length !== 1 || !filePath.trim()) {
        throw new Error('Invalid LCOV source record.');
    }
    const lineTotal = readLcovCount(lines, 'LF')!;
    const lineHits = readLcovCount(lines, 'LH')!;
    const functionTotal = readLcovCount(lines, 'FNF', false);
    const functionHits = readLcovCount(lines, 'FNH', false);
    if (
        lineHits > lineTotal ||
        (functionTotal === undefined) !== (functionHits === undefined) ||
        (functionHits ?? 0) > (functionTotal ?? 0)
    ) {
        throw new Error(`Invalid LCOV hit/total counts for ${filePath}.`);
    }
    return {
        filePath,
        functionHits: functionHits ?? 0,
        functionTotal: functionTotal ?? 0,
        lineHits,
        lineTotal,
    };
};

export const summarizeLcovReport = (profile: CoverageProfileName, lcovText: string): CoverageSummary => {
    const profileConfig = COVERAGE_PROFILES[profile];
    if (!lcovText.trimEnd().endsWith('end_of_record')) {
        throw new Error('Invalid LCOV report: missing completed source records.');
    }
    const blocks = lcovText
        .split(/\r?\nend_of_record\r?\n?/u)
        .map((block) => block.trim())
        .filter(Boolean);
    const fileSummaries: FileCoverageSummary[] = [];
    const sourcePaths = new Set<string>();

    for (const block of blocks) {
        const parsed = parseLcovBlock(block);
        if (!parsed) {
            continue;
        }

        if (profileConfig.excludeSubstrings.some((substring) => parsed.filePath.includes(substring))) {
            continue;
        }

        if (sourcePaths.has(parsed.filePath)) {
            throw new Error(`Duplicate LCOV source record: ${parsed.filePath}`);
        }
        sourcePaths.add(parsed.filePath);

        fileSummaries.push({
            filePath: parsed.filePath,
            functionCoverage: normalizePercent(parsed.functionHits, parsed.functionTotal),
            functionHits: parsed.functionHits,
            functionTotal: parsed.functionTotal,
            lineCoverage: normalizePercent(parsed.lineHits, parsed.lineTotal),
            lineHits: parsed.lineHits,
            lineTotal: parsed.lineTotal,
        });
    }

    const functionHits = fileSummaries.reduce((sum, file) => sum + file.functionHits, 0);
    const functionTotal = fileSummaries.reduce((sum, file) => sum + file.functionTotal, 0);
    const lineHits = fileSummaries.reduce((sum, file) => sum + file.lineHits, 0);
    const lineTotal = fileSummaries.reduce((sum, file) => sum + file.lineTotal, 0);

    if (lineTotal === 0) {
        throw new Error(`Coverage report contains no measurable source lines for ${profile}.`);
    }
    if (![lineHits, lineTotal, functionHits, functionTotal].every(Number.isSafeInteger)) {
        throw new Error('Invalid LCOV aggregate counts.');
    }

    return {
        fileSummaries,
        functionCoverage: normalizePercent(functionHits, functionTotal),
        functionHits,
        functionTotal,
        lineCoverage: normalizePercent(lineHits, lineTotal),
        lineHits,
        lineTotal,
        minimumLineCoverage: profileConfig.minimumLineCoverage,
        profile,
    };
};

const getCoverageSummaryText = (summary: CoverageSummary) => {
    const hotspotLines = summary.fileSummaries
        .filter((file) => file.lineCoverage < summary.minimumLineCoverage)
        .sort((left, right) => left.lineCoverage - right.lineCoverage)
        .map((file) => `  - ${file.filePath}: ${file.lineCoverage}% lines, ${file.functionCoverage}% functions`);

    return [
        `[coverage:${summary.profile}] ${summary.lineCoverage}% line coverage (${summary.lineHits}/${summary.lineTotal})`,
        `[coverage:${summary.profile}] ${summary.functionCoverage}% function coverage (${summary.functionHits}/${summary.functionTotal})`,
        hotspotLines.length > 0
            ? `[coverage:${summary.profile}] files below ${summary.minimumLineCoverage}% line coverage:`
            : '',
        ...hotspotLines,
    ]
        .filter(Boolean)
        .join('\n');
};

export const assertCoverageThreshold = (summary: CoverageSummary) => {
    if (summary.lineHits / summary.lineTotal < summary.minimumLineCoverage / 100) {
        throw new Error(
            `Coverage check failed for ${summary.profile}: ${summary.lineHits}/${summary.lineTotal} covered lines ` +
                `is below ${summary.minimumLineCoverage}% (displayed: ${summary.lineCoverage}%).`,
        );
    }
};

export const runCoverageCheck = async (profile: CoverageProfileName) => {
    const profileConfig = COVERAGE_PROFILES[profile];
    const lcovText = await Bun.file(profileConfig.lcovPath).text();
    const summary = summarizeLcovReport(profile, lcovText);
    console.log(getCoverageSummaryText(summary));
    assertCoverageThreshold(summary);
};

if (import.meta.main) {
    const profileArg = process.argv[2];
    if (profileArg !== 'root' && profileArg !== 'ui') {
        throw new Error('Usage: bun run ./src/coverage-check.ts <root|ui>');
    }

    await runCoverageCheck(profileArg);
}
