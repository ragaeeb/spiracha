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
        excludeSubstrings: [
            'src/coverage-check.ts',
            'src/lib/codex-test-helpers.ts',
            'src/lib/interactive-cli.ts',
            'src/lib/native-open.ts',
            'src/package-ui-smoke.ts',
            'src/spiracha.ts',
            'src/ui-cli.ts',
        ],
        lcovPath: 'coverage/lcov.info',
        minimumLineCoverage: 90,
    },
    ui: {
        excludeSubstrings: [
            'src/components/projects-table.tsx',
            'src/components/ui/',
            'src/integrations/',
            'src/lib/codex-queries.ts',
            'src/lib/codex-server.ts',
            'src/router.tsx',
            'src/routes/',
            'src/routeTree.gen.ts',
        ],
        lcovPath: 'apps/ui/coverage/lcov.info',
        minimumLineCoverage: 90,
    },
};

const normalizePercent = (hits: number, total: number) => {
    if (total <= 0) {
        return 100;
    }

    return Number(((hits / total) * 100).toFixed(2));
};

const parseLcovBlock = (block: string) => {
    const lines = block.trim().split(/\n/u);
    const filePath = lines.find((line) => line.startsWith('SF:'))?.slice(3);
    if (!filePath) {
        return null;
    }

    let functionTotal = 0;
    let functionHits = 0;
    let lineTotal = 0;
    let lineHits = 0;

    for (const line of lines) {
        if (line.startsWith('FNF:')) {
            functionTotal = Number(line.slice(4));
        }
        if (line.startsWith('FNH:')) {
            functionHits = Number(line.slice(4));
        }
        if (line.startsWith('LF:')) {
            lineTotal = Number(line.slice(3));
        }
        if (line.startsWith('LH:')) {
            lineHits = Number(line.slice(3));
        }
    }

    return {
        filePath,
        functionHits,
        functionTotal,
        lineHits,
        lineTotal,
    };
};

export const summarizeLcovReport = (profile: CoverageProfileName, lcovText: string): CoverageSummary => {
    const profileConfig = COVERAGE_PROFILES[profile];
    const blocks = lcovText
        .split(/\r?\nend_of_record\r?\n?/u)
        .map((block) => block.trim())
        .filter(Boolean);
    const fileSummaries: FileCoverageSummary[] = [];

    for (const block of blocks) {
        const parsed = parseLcovBlock(block);
        if (!parsed) {
            continue;
        }

        if (profileConfig.excludeSubstrings.some((substring) => parsed.filePath.includes(substring))) {
            continue;
        }

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

export const runCoverageCheck = async (profile: CoverageProfileName) => {
    const profileConfig = COVERAGE_PROFILES[profile];
    const lcovText = await Bun.file(profileConfig.lcovPath).text();
    const summary = summarizeLcovReport(profile, lcovText);
    console.log(getCoverageSummaryText(summary));

    if (summary.lineCoverage < summary.minimumLineCoverage) {
        throw new Error(
            `Coverage check failed for ${profile}: ${summary.lineCoverage}% is below ${summary.minimumLineCoverage}%`,
        );
    }
};

if (import.meta.main) {
    const profileArg = process.argv[2];
    if (profileArg !== 'root' && profileArg !== 'ui') {
        throw new Error('Usage: bun run ./src/coverage-check.ts <root|ui>');
    }

    await runCoverageCheck(profileArg);
}
