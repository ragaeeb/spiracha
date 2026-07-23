import type { ConversationEvidenceEvent, EvidenceAnchor, EvidenceLens } from './types';

type LensValidationError = { error: { message: string; path: string }; ok: false };
type LensValidationSuccess = { ok: true; value: EvidenceLens };
export type LensValidationResult = LensValidationError | LensValidationSuccess;

const LIMITS = {
    anchors: 32,
    budgetMax: 1_000_000,
    budgetMin: 2_000,
    contextWindow: 20,
    globStars: 8,
    maxOrderGap: 100,
    patternLength: 256,
    patternsPerAnchor: 32,
} as const;

export const DEFAULT_EVIDENCE_LENS: EvidenceLens = {
    anchors: [{ kind: 'tool', names: ['exec'] }],
    budget: {
        commentaryCharactersPerEpisode: 1_500,
        failedOutputCharacters: 6_000,
        successfulOutputCharacters: 1_500,
        totalCharacters: 40_000,
    },
    context: {
        commentaryAfter: 2,
        commentaryBefore: 2,
        followRetries: true,
        followWorkarounds: true,
        includeReasoningSummaries: true,
        maxOrderGap: 20,
    },
    name: 'Focused tool evidence',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const unknownField = (value: Record<string, unknown>, allowed: readonly string[], path: string) => {
    const key = Object.keys(value).find((candidate) => !allowed.includes(candidate));
    return key ? `${path}${path ? '.' : ''}${key}` : null;
};

const failure = (path: string, message: string): LensValidationError => ({ error: { message, path }, ok: false });

const validateStrings = (value: unknown, path: string, glob = false): LensValidationError | null => {
    if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.patternsPerAnchor) {
        return failure(path, `Expected 1-${LIMITS.patternsPerAnchor} strings.`);
    }
    for (const [index, item] of value.entries()) {
        if (typeof item !== 'string' || !item.trim() || item.length > LIMITS.patternLength || item.includes('\0')) {
            return failure(
                `${path}[${index}]`,
                `Expected a non-empty string up to ${LIMITS.patternLength} characters.`,
            );
        }
        if (glob && (item.match(/\*/gu)?.length ?? 0) > LIMITS.globStars) {
            return failure(`${path}[${index}]`, 'Glob is too complex.');
        }
    }
    return null;
};

const ANCHOR_FIELDS: Record<string, string[]> = {
    artifact: ['kind', 'globs'],
    cwd: ['kind', 'globs'],
    schema: ['kind', 'prefixes'],
    'shell-command': ['kind', 'executables', 'subcommands'],
    text: ['kind', 'literals'],
    tool: ['kind', 'names', 'namespaces'],
};

const validateToolAnchor = (value: Record<string, unknown>, path: string) => {
    if (value.names === undefined && value.namespaces === undefined) {
        return failure(path, 'Tool anchors require names or namespaces.');
    }
    return (
        (value.names === undefined ? null : validateStrings(value.names, `${path}.names`)) ??
        (value.namespaces === undefined ? null : validateStrings(value.namespaces, `${path}.namespaces`))
    );
};

const validateShellAnchor = (value: Record<string, unknown>, path: string) =>
    validateStrings(value.executables, `${path}.executables`) ??
    (value.subcommands === undefined ? null : validateStrings(value.subcommands, `${path}.subcommands`));

const validateSimpleAnchor = (value: Record<string, unknown>, path: string) => {
    const field = value.kind === 'schema' ? 'prefixes' : value.kind === 'text' ? 'literals' : 'globs';
    return validateStrings(value[field], `${path}.${field}`, field === 'globs');
};

const validateAnchor = (value: unknown, index: number): LensValidationError | null => {
    const path = `anchors[${index}]`;
    if (!isRecord(value) || typeof value.kind !== 'string') {
        return failure(path, 'Expected an anchor object with a kind.');
    }
    const allowed = ANCHOR_FIELDS[value.kind];
    if (!allowed) {
        return failure(`${path}.kind`, 'Unknown anchor kind.');
    }
    const unknown = unknownField(value, allowed, path);
    if (unknown) {
        return failure(unknown, 'Unknown field.');
    }
    if (value.kind === 'tool') {
        return validateToolAnchor(value, path);
    }
    if (value.kind === 'shell-command') {
        return validateShellAnchor(value, path);
    }
    return validateSimpleAnchor(value, path);
};

const validateInteger = (value: unknown, path: string, minimum: number, maximum: number) =>
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
        ? null
        : failure(path, `Expected an integer from ${minimum} to ${maximum}.`);

const validateLensRoot = (value: Record<string, unknown>): LensValidationError | null => {
    const unknown = unknownField(value, ['name', 'anchors', 'context', 'budget'], '');
    if (unknown) {
        return failure(unknown, 'Unknown field.');
    }
    if (
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        value.name.length > 120 ||
        /[\u0000-\u001f\u007f]/u.test(value.name)
    ) {
        return failure('name', 'Expected a non-empty name up to 120 characters without control characters.');
    }
    if (!Array.isArray(value.anchors) || value.anchors.length === 0 || value.anchors.length > LIMITS.anchors) {
        return failure('anchors', `Expected 1-${LIMITS.anchors} anchors.`);
    }
    return null;
};

const validateAnchors = (anchors: unknown[]) => {
    for (const [index, anchor] of anchors.entries()) {
        const error = validateAnchor(anchor, index);
        if (error) {
            return error;
        }
        if (anchors.slice(0, index).some((candidate) => JSON.stringify(candidate) === JSON.stringify(anchor))) {
            return failure(`anchors[${index}]`, 'Duplicate anchor.');
        }
    }
    return null;
};

const validateContext = (context: unknown): LensValidationError | null => {
    if (!isRecord(context)) {
        return failure('context', 'Expected a context object.');
    }
    const contextUnknown = unknownField(
        context,
        [
            'commentaryBefore',
            'commentaryAfter',
            'includeReasoningSummaries',
            'followRetries',
            'followWorkarounds',
            'maxOrderGap',
        ],
        'context',
    );
    if (contextUnknown) {
        return failure(contextUnknown, 'Unknown field.');
    }
    for (const field of ['includeReasoningSummaries', 'followRetries', 'followWorkarounds'] as const) {
        if (typeof context[field] !== 'boolean') {
            return failure(`context.${field}`, 'Expected a boolean.');
        }
    }
    for (const field of ['commentaryBefore', 'commentaryAfter'] as const) {
        const error = validateInteger(context[field], `context.${field}`, 0, LIMITS.contextWindow);
        if (error) {
            return error;
        }
    }
    return validateInteger(context.maxOrderGap, 'context.maxOrderGap', 1, LIMITS.maxOrderGap);
};

const BUDGET_FIELDS = [
    'totalCharacters',
    'successfulOutputCharacters',
    'failedOutputCharacters',
    'commentaryCharactersPerEpisode',
] as const;

const validateBudget = (budget: unknown): LensValidationError | null => {
    if (!isRecord(budget)) {
        return failure('budget', 'Expected a budget object.');
    }
    const budgetUnknown = unknownField(budget, BUDGET_FIELDS, 'budget');
    if (budgetUnknown) {
        return failure(budgetUnknown, 'Unknown field.');
    }
    for (const field of BUDGET_FIELDS) {
        const minimum = field === 'totalCharacters' ? LIMITS.budgetMin : 0;
        const error = validateInteger(budget[field], `budget.${field}`, minimum, LIMITS.budgetMax);
        if (error) {
            return error;
        }
    }
    if ((budget.failedOutputCharacters as number) > (budget.totalCharacters as number)) {
        return failure('budget.failedOutputCharacters', 'Section budget cannot exceed the total budget.');
    }
    if ((budget.successfulOutputCharacters as number) > (budget.totalCharacters as number)) {
        return failure('budget.successfulOutputCharacters', 'Section budget cannot exceed the total budget.');
    }
    return null;
};

export const validateEvidenceLens = (value: unknown): LensValidationResult => {
    if (!isRecord(value)) {
        return failure('', 'Expected a lens object.');
    }
    const error =
        validateLensRoot(value) ??
        validateAnchors(value.anchors as unknown[]) ??
        validateContext(value.context) ??
        validateBudget(value.budget);
    return error ?? { ok: true, value: value as EvidenceLens };
};

const tokenizeShell = (command: string): string[] | null => {
    const trimmed = command.trim();
    if (!trimmed || trimmed.startsWith('#')) {
        return null;
    }
    const segment = trimmed.slice(0, 4096).split(/\s*(?:&&|\|\||[;|])\s*/u, 1)[0] ?? '';
    const rawTokens = segment.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s"']+/gu) ?? [];
    const tokens = rawTokens.map((token) => token.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2'));
    return tokens.length > 0 ? tokens : null;
};

export const parseShellInvocation = (command: string): { executable: string; subcommand: string | null } | null => {
    const tokens = tokenizeShell(command);
    if (!tokens) {
        return null;
    }
    let index = tokens.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(token));
    if (index < 0) {
        return null;
    }
    if (tokens[index] === 'env') {
        index += 1;
        while (tokens[index] && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index]!)) {
            index += 1;
        }
    }
    if (tokens[index] === 'rtk') {
        index += 1;
    }
    const rawExecutable = tokens[index];
    if (!rawExecutable) {
        return null;
    }
    const executable = rawExecutable.split(/[\\/]/u).at(-1) ?? rawExecutable;
    return { executable, subcommand: tokens[index + 1] ?? null };
};

const globMatches = (value: string, glob: string) => {
    if (glob.endsWith('/**') && value === glob.slice(0, -3)) {
        return true;
    }
    let valueIndex = 0;
    let globIndex = 0;
    let starIndex = -1;
    let retryValueIndex = 0;
    while (valueIndex < value.length) {
        const globCharacter = glob[globIndex];
        if (globCharacter === '?' || globCharacter === value[valueIndex]) {
            valueIndex += 1;
            globIndex += 1;
        } else if (globCharacter === '*') {
            starIndex = globIndex;
            globIndex += 1;
            retryValueIndex = valueIndex;
        } else if (starIndex >= 0) {
            globIndex = starIndex + 1;
            retryValueIndex += 1;
            valueIndex = retryValueIndex;
        } else {
            return false;
        }
    }
    while (glob[globIndex] === '*') {
        globIndex += 1;
    }
    return globIndex === glob.length;
};

const matchesOne = (value: string | null, candidates: string[] | undefined) =>
    candidates === undefined || (value !== null && candidates.includes(value));

export const matchEvidenceEvent = (event: ConversationEvidenceEvent, anchor: EvidenceAnchor): boolean => {
    if (anchor.kind === 'tool') {
        return Boolean(
            event.tool &&
                matchesOne(event.tool.name, anchor.names) &&
                matchesOne(event.tool.namespace, anchor.namespaces),
        );
    }
    if (anchor.kind === 'shell-command') {
        const invocation = event.tool?.command ? parseShellInvocation(event.tool.command) : null;
        return Boolean(
            invocation &&
                anchor.executables.includes(invocation.executable) &&
                matchesOne(invocation.subcommand, anchor.subcommands),
        );
    }
    if (anchor.kind === 'artifact') {
        return event.artifacts.some((artifact) => anchor.globs.some((glob) => globMatches(artifact, glob)));
    }
    if (anchor.kind === 'cwd') {
        return Boolean(event.tool?.workdir && anchor.globs.some((glob) => globMatches(event.tool!.workdir!, glob)));
    }
    if (anchor.kind === 'text') {
        return anchor.literals.some((literal) => event.text.includes(literal));
    }
    const values = Object.values(event.metadata).filter((item): item is string => typeof item === 'string');
    return values.some((item) => anchor.prefixes.some((prefix) => item.startsWith(prefix)));
};
