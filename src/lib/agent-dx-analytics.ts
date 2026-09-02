import type { JsonValue } from './shared';
import { asObject, asString, readJsonlObjects } from './shared';

export const AGENT_DX_ANALYTICS_SCHEMA = 'agent-dx/v1' as const;

export const AGENT_DX_EVENT_CLASSES = [
    'assistant',
    'artifact',
    'childStream',
    'metadata',
    'other',
    'reasoning',
    'toolInput',
    'toolOutput',
    'user',
] as const;

export type AgentDxEventClass = (typeof AGENT_DX_EVENT_CLASSES)[number];

export type AgentDxRetainedBytes = Record<AgentDxEventClass, number>;

export type AgentDxUsageSemantics = 'cumulative' | 'estimated' | 'incremental' | 'unknown';

export type AgentDxTerminalOutcome = 'blocked' | 'complete' | 'failed' | 'unknown';

export type AgentDxIncrementalTokens = {
    cachedInput: number | null;
    input: number | null;
    output: number | null;
    reasoning: number | null;
};

export type AgentDxUsage = {
    semantics: AgentDxUsageSemantics;
    value: number | null;
};

export type AgentDxDistributionItem = {
    count: number;
    label: string;
};

export type AgentDxWarningCode = 'cross-child-same-state-reread' | 'output-saturation' | 'same-state-rerun';

export type AgentDxWarning = {
    code: AgentDxWarningCode;
    count: number;
    message: string;
};

export type AgentDxReadObservation = {
    fingerprint: string;
    state: string;
};

export type AgentDxThreadSummary = {
    assignmentId: string | null;
    childStreamBlocks: number;
    commandFingerprints: string[];
    discoveryCallCount: number;
    discoveryOutputBytes: number;
    externalCursorConversationOrRunRef: string | null;
    firstMutationLatencyMs: number | null;
    gateFingerprints: string[];
    incrementalTokens: AgentDxIncrementalTokens;
    koterInvocationId: string | null;
    largeOutputBlocks: number;
    largeOutputBytes: number;
    operationId: string | null;
    outputSaturationBlocks: number;
    outputSaturationBytes: number;
    parentToolCallId: string | null;
    pollWaitCount: number;
    postimageEvidenceReferences: string[];
    readObservations: AgentDxReadObservation[];
    reasoningEventBytes: number;
    repeatedCommandCalls: number;
    repeatedGateCalls: number;
    repeatedReadCalls: number;
    reportedUsage: AgentDxUsage;
    repositoryIdentityAfter: string | null;
    repositoryIdentityBefore: string | null;
    roleFanout: string[];
    statusReadCount: number;
    taskLabelAndKaluRow: string | null;
    terminalOutcome: AgentDxTerminalOutcome;
    terminalReadCount: number;
    terminalStatusAndEvidenceReferences: string[];
    toolCallBytes: number;
    toolOutputBytes: number;
    truncationBlocks: number;
    turnOrGoalIds: string[];
    retainedBytesByEventClass: AgentDxRetainedBytes;
    verifierWaves: number;
    warnings: AgentDxWarning[];
};

export type AgentDxGoalSpan = {
    assignmentId: string | null;
    childThreadIdsSpawnedInSpan: string[];
    crossChildSameStateRereads: number;
    discoveryCallCount: number;
    discoveryOutputBytes: number;
    externalCursorConversationOrRunRef: string | null;
    firstMutationLatencyMs: number | null;
    gateFingerprints: string[];
    goalSpanId: string;
    incrementalTokens: AgentDxIncrementalTokens;
    koterInvocationId: string | null;
    largeOutputBlocks: number;
    largeOutputBytes: number;
    operationId: string | null;
    outputSaturationBlocks: number;
    outputSaturationBytes: number;
    parentToolCallId: string | null;
    pollWaitCount: number;
    repositoryIdentityAfter: string | null;
    repositoryIdentityBefore: string | null;
    repeatedAuthorityReads: number;
    repeatedCommandCalls: number;
    repeatedGateCalls: number;
    repeatedReadCalls: number;
    reportedUsage: AgentDxUsage;
    roleFanout: AgentDxDistributionItem[];
    rootThreadId: string;
    source: string;
    sourceThreadId: string;
    statusReadCount: number;
    taskLabelAndKaluRow: string | null;
    terminalOutcome: AgentDxTerminalOutcome;
    terminalReadCount: number;
    terminalStatusAndEvidenceReferences: string[];
    retainedBytesByEventClass: AgentDxRetainedBytes;
    truncationBlocks: number;
    turnOrGoalId: string | null;
    uniqueAuthorityReads: number;
    verifierWaves: number;
    warnings: AgentDxWarning[];
};

export type AgentDxAnalytics = {
    goalSpans: AgentDxGoalSpan[];
    schema: typeof AGENT_DX_ANALYTICS_SCHEMA;
    warnings: AgentDxWarning[];
};

export type CreateAgentDxAccumulatorOptions = {
    createdAtMs?: number | null;
    cwd?: string;
    reportedUsageValue?: number | null;
    repositoryIdentityBefore?: string | null;
    sourceThreadId?: string;
};

type AgentDxToolCall = {
    command: string | null;
    maxOutputBytes: number | null;
    name: string;
    workdir: string | null;
};

type CountMap = Map<string, number>;

export type AgentDxAccumulator = {
    assignmentId: string | null;
    calls: Map<string, AgentDxToolCall>;
    childStreamBlocks: number;
    commandCounts: CountMap;
    commandFingerprints: Set<string>;
    createdAtMs: number | null;
    cwd: string;
    discoveryCallCount: number;
    discoveryOutputBytes: number;
    discoveryEnded: boolean;
    externalCursorConversationOrRunRef: string | null;
    firstMutationAtMs: number | null;
    firstRecordAtMs: number | null;
    gateCounts: CountMap;
    gateFingerprints: Set<string>;
    incrementalTokens: AgentDxIncrementalTokens;
    koterInvocationId: string | null;
    largeOutputBlocks: number;
    largeOutputBytes: number;
    operationId: string | null;
    outputSaturationBlocks: number;
    outputSaturationBytes: number;
    parentToolCallId: string | null;
    pollWaitCount: number;
    postimageEvidenceReferences: Set<string>;
    readCounts: CountMap;
    readObservations: AgentDxReadObservation[];
    reasoningEventBytes: number;
    reportedUsage: AgentDxUsage;
    repositoryIdentityAfter: string | null;
    repositoryIdentityBefore: string | null;
    roleFanout: string[];
    sourceThreadId: string;
    statusReadCount: number;
    taskLabelAndKaluRow: string | null;
    terminalOutcome: AgentDxTerminalOutcome;
    terminalReadCount: number;
    terminalStatusAndEvidenceReferences: Set<string>;
    toolCallBytes: number;
    toolOutputBytes: number;
    truncationBlocks: number;
    turnOrGoalIds: string[];
    retainedBytesByEventClass: AgentDxRetainedBytes;
    verifierWaves: number;
    warnings: AgentDxWarning[];
};

export type AgentDxThreadDescriptor = {
    agentRole?: string | null;
    childThreadIds: string[];
    createdAtMs?: number | null;
    cwd: string;
    firstUserMessage?: string;
    gitSha?: string | null;
    parentThreadId?: string | null;
    source: string;
    summary: AgentDxThreadSummary;
    threadId: string;
    title?: string;
    tokensUsed?: number;
};

const LARGE_OUTPUT_BYTES = 10_000;
const SATURATION_FLOOR_BYTES = 39_000;
const SATURATION_RATIO = 0.95;
const encoder = new TextEncoder();

const createEmptyRetainedBytes = (): AgentDxRetainedBytes => ({
    artifact: 0,
    assistant: 0,
    childStream: 0,
    metadata: 0,
    other: 0,
    reasoning: 0,
    toolInput: 0,
    toolOutput: 0,
    user: 0,
});

const createEmptyIncrementalTokens = (): AgentDxIncrementalTokens => ({
    cachedInput: null,
    input: null,
    output: null,
    reasoning: null,
});

const normalizeKey = (key: string) => key.replaceAll(/[_-]/gu, '').toLowerCase();

const normalizeText = (value: string) => value.trim().replaceAll(/\s+/gu, ' ');

const outputText = (value: JsonValue | undefined) => {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined) {
        return '';
    }
    return JSON.stringify(value);
};

const objectText = (value: JsonValue | undefined): Record<string, JsonValue> | null => {
    if (typeof value !== 'string') {
        return asObject(value ?? null);
    }

    try {
        return asObject(JSON.parse(value) as JsonValue);
    } catch {
        return null;
    }
};

const findString = (value: JsonValue | undefined, keys: ReadonlySet<string>, depth = 0): string | null => {
    if (depth > 5 || value === null || value === undefined) {
        return null;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = findString(entry, keys, depth + 1);
            if (found) {
                return found;
            }
        }
        return null;
    }
    if (typeof value !== 'object') {
        return null;
    }

    for (const [key, entry] of Object.entries(value)) {
        if (keys.has(normalizeKey(key)) && typeof entry === 'string' && entry.trim()) {
            return entry.trim();
        }
        const found = findString(entry, keys, depth + 1);
        if (found) {
            return found;
        }
    }
    return null;
};

const findNumber = (value: JsonValue | undefined, keys: ReadonlySet<string>, depth = 0): number | null => {
    if (depth > 5 || value === null || value === undefined) {
        return null;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = findNumber(entry, keys, depth + 1);
            if (found !== null) {
                return found;
            }
        }
        return null;
    }
    if (typeof value !== 'object') {
        return null;
    }

    for (const [key, entry] of Object.entries(value)) {
        if (keys.has(normalizeKey(key)) && typeof entry === 'number' && Number.isFinite(entry)) {
            return entry;
        }
        const found = findNumber(entry, keys, depth + 1);
        if (found !== null) {
            return found;
        }
    }
    return null;
};

const hasKey = (value: JsonValue | undefined, keys: ReadonlySet<string>, depth = 0): boolean => {
    if (depth > 5 || value === null || value === undefined) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.some((entry) => hasKey(entry, keys, depth + 1));
    }
    if (typeof value !== 'object') {
        return false;
    }
    return Object.entries(value).some(([key, entry]) => keys.has(normalizeKey(key)) || hasKey(entry, keys, depth + 1));
};

const asPositiveNumber = (value: number | null) => (value !== null && value > 0 ? value : null);

const parseTimestampMs = (record: Record<string, JsonValue>) => {
    const timestamp = asString(record.timestamp);
    if (!timestamp) {
        return null;
    }
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
};

const recordBytes = (record: Record<string, JsonValue>) => encoder.encode(JSON.stringify(record)).byteLength;

const explicitLineage = {
    assignmentId: new Set(['assignmentid', 'assignment']),
    externalCursorConversationOrRunRef: new Set([
        'cursorconversationid',
        'cursorconversationref',
        'cursorrunid',
        'cursorrunref',
        'externalcursorconversationorrunref',
    ]),
    koterInvocationId: new Set(['koterid', 'koterinvocationid', 'koteroperationid']),
    operationId: new Set(['operationid', 'operation']),
    parentToolCallId: new Set(['parentcallid', 'parenttoolcallid']),
};

const repositoryBeforeKeys = new Set([
    'basecommit',
    'basegitsha',
    'commithash',
    'commitsha',
    'gitsha',
    'repositoryidentitybefore',
]);
const repositoryAfterKeys = new Set([
    'aftercommit',
    'aftergitsha',
    'gitshaafter',
    'postimage',
    'repositoryidentityafter',
]);
const taskLabelKeysNormalized = new Set(['goal', 'kalurow', 'kalurorow', 'objective', 'row', 'task', 'taskname']);

const extractTaskLabel = (value: JsonValue | undefined) => findString(value, taskLabelKeysNormalized) ?? null;

const extractLineage = (value: JsonValue | undefined, accumulator: AgentDxAccumulator) => {
    accumulator.assignmentId ??= findString(value, explicitLineage.assignmentId);
    accumulator.operationId ??= findString(value, explicitLineage.operationId);
    accumulator.parentToolCallId ??= findString(value, explicitLineage.parentToolCallId);
    accumulator.koterInvocationId ??= findString(value, explicitLineage.koterInvocationId);
    accumulator.externalCursorConversationOrRunRef ??= findString(
        value,
        explicitLineage.externalCursorConversationOrRunRef,
    );
};

const isReferenceKey = (key: string) => {
    const normalized = normalizeKey(key);
    return normalized.includes('artifact') || normalized.includes('evidence') || normalized.includes('reference');
};

const collectReferences = (entry: JsonValue | undefined, references: Set<string>, depth: number): void => {
    if (depth > 5 || entry === null || entry === undefined) {
        return;
    }
    if (Array.isArray(entry)) {
        for (const child of entry) {
            collectReferences(child, references, depth + 1);
        }
        return;
    }
    if (typeof entry !== 'object') {
        return;
    }
    for (const [key, child] of Object.entries(entry)) {
        if (isReferenceKey(key) && typeof child === 'string' && child.trim()) {
            references.add(child.trim());
        }
        collectReferences(child, references, depth + 1);
    }
};

const extractReferences = (value: JsonValue | undefined) => {
    const references = new Set<string>();
    collectReferences(value, references, 0);
    return references;
};

const isReadCommand = (command: string) =>
    /(?:^|[;&|]\s*)(?:rtk\s+)?(?:cat|grep|head|read|rg|sed|tail)\b/iu.test(command);

const isGateCommand = (command: string) =>
    /(?:^|\s)(?:check(?::[\w-]+)?|coverage|lint|test(?::[\w-]+)?|typecheck)(?:\s|$)/iu.test(command);

const isMutationCommand = (command: string) =>
    /(?:apply_patch|bun\.write|git\s+(?:add|commit|mv|rm|restore)|(?:cp|mkdir|mv|rm|touch)\b|(?:perl|sed)\s+-i\b|writeFile)/iu.test(
        command,
    );

const isMutationTool = (name: string) => /^(?:apply_patch|edit_file|write_file)$/iu.test(name);

const isWaitTool = (name: string) => /^(?:wait|wait_agent|wait_threads|write_stdin)$/iu.test(name);

const isStatusReadTool = (name: string) =>
    /(?:^|_)(?:get_)?(?:handoff_)?status(?:$|_)|^(?:list_agents|read_thread)$/iu.test(name);

const isTerminalReadTool = (name: string) => /(?:terminal|read_tool_output|read_output)/iu.test(name);

const isVerifier = (value: string) => /verif/iu.test(value);

const classifyMessageEvent = (
    payloadType: string | null,
    payload: Record<string, JsonValue> | null,
): AgentDxEventClass | null => {
    if (payloadType === 'user_message' || (payloadType === 'message' && payload?.role === 'user')) {
        return 'user';
    }
    if (payloadType === 'agent_message' || (payloadType === 'message' && payload?.role === 'assistant')) {
        return 'assistant';
    }
    return null;
};

const classifyEvent = (
    record: Record<string, JsonValue>,
    payload: Record<string, JsonValue> | null,
): AgentDxEventClass => {
    const recordType = asString(record.type);
    const payloadType = asString(payload?.type ?? null);
    const messageClass = classifyMessageEvent(payloadType, payload);
    if (messageClass) {
        return messageClass;
    }
    if (
        recordType === 'artifact' ||
        hasKey(record, new Set(['artifact', 'artifacturl', 'evidenceref', 'traceartifact']))
    ) {
        return 'artifact';
    }
    if (payloadType === 'reasoning') {
        return 'reasoning';
    }
    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
        return 'toolInput';
    }
    if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
        return /(?:child[_-]stream|thinking[_-]delta|reasoning[_-]delta|tool[_-](?:call|result|output))/iu.test(
            JSON.stringify(record),
        )
            ? 'childStream'
            : 'toolOutput';
    }
    if (payloadType === 'web_search_call') {
        return 'toolInput';
    }
    if (payloadType === 'web_search_end') {
        return 'toolOutput';
    }
    return recordType === 'session_meta' || recordType === 'turn_context' || payloadType === 'token_count'
        ? 'metadata'
        : 'other';
};

const parseCommand = (payload: Record<string, JsonValue>) => {
    const name = asString(payload.name) ?? 'unknown';
    const args = objectText(payload.arguments ?? payload.input);
    const command =
        asString(args?.cmd ?? null) ??
        asString(args?.command ?? null) ??
        asString(payload.command) ??
        (name === 'exec_command' ? asString(payload.input) : null);
    const workdir = asString(args?.workdir ?? null) ?? asString(args?.cwd ?? null) ?? asString(payload.workdir);
    const configuredBytes = asPositiveNumber(
        findNumber(args, new Set(['maxbytes', 'maxoutputbytes', 'maxoutputchars'])) ??
            findNumber(payload, new Set(['maxbytes', 'maxoutputbytes', 'maxoutputchars'])),
    );
    const configuredTokens = asPositiveNumber(
        findNumber(args, new Set(['maxoutputtokens'])) ?? findNumber(payload, new Set(['maxoutputtokens'])),
    );
    const maxBytes = configuredBytes ?? (configuredTokens === null ? null : configuredTokens * 4);
    return { args, command, maxBytes, name, workdir };
};

const mergeLineageFromPayload = (payload: Record<string, JsonValue>, accumulator: AgentDxAccumulator) => {
    extractLineage(payload, accumulator);
    accumulator.taskLabelAndKaluRow ??= extractTaskLabel(payload);
    accumulator.repositoryIdentityBefore ??= findString(payload, repositoryBeforeKeys);
    accumulator.repositoryIdentityAfter ??= findString(payload, repositoryAfterKeys);
};

const captureTokenUsage = (payload: Record<string, JsonValue>, accumulator: AgentDxAccumulator) => {
    const info = objectText(payload.info);
    const totalUsage = info?.total_token_usage ?? payload.total_token_usage ?? payload.usage;
    const lastUsageValue = info?.last_token_usage ?? payload.last_token_usage;
    const lastUsage = objectText(lastUsageValue) ?? lastUsageValue;
    const totalTokens =
        findNumber(totalUsage, new Set(['totaltokens', 'total'])) ?? findNumber(payload, new Set(['totaltokens']));
    if (totalTokens !== null) {
        accumulator.reportedUsage = { semantics: 'cumulative', value: totalTokens };
    }

    const semantics = findString(payload, new Set(['usagesemantics', 'semantic']));
    if (
        semantics === 'incremental' ||
        semantics === 'cumulative' ||
        semantics === 'estimated' ||
        semantics === 'unknown'
    ) {
        accumulator.reportedUsage = { semantics, value: accumulator.reportedUsage.value };
    }

    if (lastUsageValue !== undefined) {
        accumulator.incrementalTokens = {
            cachedInput: findNumber(
                lastUsage,
                new Set(['cachedinputtokens', 'cacheinputtokens', 'cachereadinputtokens']),
            ),
            input: findNumber(lastUsage, new Set(['inputtokens'])),
            output: findNumber(lastUsage, new Set(['outputtokens'])),
            reasoning: findNumber(lastUsage, new Set(['reasoningtokens'])),
        };
    }
};

const captureRepositoryAfter = (call: AgentDxToolCall, output: string, accumulator: AgentDxAccumulator) => {
    if (!call.command || !/(?:git\s+rev-parse\s+.*HEAD|git\s+commit)/iu.test(call.command)) {
        return;
    }
    const hashes = output.match(/\b[0-9a-f]{7,64}\b/giu);
    const hash = hashes?.at(-1);
    if (hash) {
        accumulator.repositoryIdentityAfter = hash;
    }
};

const updateTerminalOutcome = (value: string | null, accumulator: AgentDxAccumulator) => {
    if (!value) {
        return;
    }
    const normalized = value.toLowerCase();
    if (/(?:fail|error)/u.test(normalized)) {
        accumulator.terminalOutcome = 'failed';
    } else if (/block/u.test(normalized)) {
        accumulator.terminalOutcome = 'blocked';
    } else if (/(?:complete|proved|success)/u.test(normalized) && accumulator.terminalOutcome === 'unknown') {
        accumulator.terminalOutcome = 'complete';
    }
};

const captureTerminalStatus = (value: JsonValue | undefined, accumulator: AgentDxAccumulator) => {
    const object = objectText(value);
    if (!object) {
        return;
    }
    updateTerminalOutcome(
        findString(object, new Set(['disposition', 'outcome', 'status', 'terminaloutcome'])),
        accumulator,
    );
    for (const reference of extractReferences(object)) {
        accumulator.terminalStatusAndEvidenceReferences.add(reference);
    }
};

const outputIsTerminalAuditFinding = (output: string) =>
    /(?:final[_-]answer|audit finding|terminal finding)/iu.test(output);

const captureToolOutput = (payload: Record<string, JsonValue>, accumulator: AgentDxAccumulator) => {
    const callId = asString(payload.call_id);
    const call = callId ? accumulator.calls.get(callId) : undefined;
    const output = outputText(payload.output);
    const bytes = encoder.encode(output).byteLength;
    accumulator.toolOutputBytes += bytes;
    if (!accumulator.discoveryEnded) {
        accumulator.discoveryOutputBytes += bytes;
        if (outputIsTerminalAuditFinding(output)) {
            accumulator.discoveryEnded = true;
        }
    }
    if (bytes >= LARGE_OUTPUT_BYTES) {
        accumulator.largeOutputBlocks += 1;
        accumulator.largeOutputBytes += bytes;
    }
    const saturated =
        /(?:truncated output|output truncated|preview truncated)/iu.test(output) ||
        (call?.maxOutputBytes !== null &&
            call?.maxOutputBytes !== undefined &&
            bytes >= call.maxOutputBytes * SATURATION_RATIO) ||
        bytes >= SATURATION_FLOOR_BYTES;
    if (saturated) {
        accumulator.outputSaturationBlocks += 1;
        accumulator.outputSaturationBytes += bytes;
    }
    if (/(?:truncated output|output truncated|preview truncated)/iu.test(output)) {
        accumulator.truncationBlocks += 1;
    }
    if (/(?:child[_-]stream|thinking[_-]delta|reasoning[_-]delta|tool[_-](?:call|result|output))/iu.test(output)) {
        accumulator.childStreamBlocks += 1;
    }
    captureRepositoryAfter(
        call ?? { command: null, maxOutputBytes: null, name: '', workdir: null },
        output,
        accumulator,
    );
    const outputObject = objectText(payload.output);
    captureTerminalStatus(outputObject, accumulator);
    mergeLineageFromPayload(outputObject ?? {}, accumulator);
    const references = extractReferences(payload.output);
    for (const reference of references) {
        accumulator.postimageEvidenceReferences.add(reference);
    }
    if (call?.name && isWaitTool(call.name) && /timed[_ -]?out|timeout/iu.test(output)) {
        updateTerminalOutcome('blocked', accumulator);
    }
};

const captureCommandMetrics = (
    parsed: ReturnType<typeof parseCommand>,
    record: Record<string, JsonValue>,
    accumulator: AgentDxAccumulator,
) => {
    const normalizedCommand = parsed.command
        ? normalizeText(parsed.command)
        : isMutationTool(parsed.name)
          ? parsed.name
          : null;
    if (!normalizedCommand) {
        if (!accumulator.discoveryEnded) {
            accumulator.discoveryCallCount += 1;
        }
        return;
    }
    accumulator.commandFingerprints.add(normalizedCommand);
    const state = accumulator.repositoryIdentityAfter ?? accumulator.repositoryIdentityBefore ?? accumulator.cwd;
    const fingerprint = `${state}\0${parsed.workdir ?? accumulator.cwd}\0${normalizedCommand}`;
    increment(accumulator.commandCounts, fingerprint);
    if (isReadCommand(normalizedCommand)) {
        increment(accumulator.readCounts, fingerprint);
        accumulator.readObservations.push({ fingerprint: normalizedCommand, state });
    }
    if (isGateCommand(normalizedCommand)) {
        accumulator.gateFingerprints.add(fingerprint);
        increment(accumulator.gateCounts, fingerprint);
    }
    if (isMutationCommand(normalizedCommand)) {
        if (accumulator.firstMutationAtMs === null) {
            accumulator.firstMutationAtMs = parseTimestampMs(record) ?? accumulator.createdAtMs;
        }
        accumulator.discoveryEnded = true;
    } else if (!accumulator.discoveryEnded) {
        accumulator.discoveryCallCount += 1;
    }
};

const captureToolCounters = (name: string, accumulator: AgentDxAccumulator) => {
    if (isWaitTool(name)) {
        accumulator.pollWaitCount += 1;
    }
    if (isStatusReadTool(name)) {
        accumulator.statusReadCount += 1;
    }
    if (isTerminalReadTool(name)) {
        accumulator.terminalReadCount += 1;
    }
};

const captureSpawnRole = (parsed: ReturnType<typeof parseCommand>, accumulator: AgentDxAccumulator) => {
    if (parsed.name !== 'spawn_agent' && !/(?:child|subagent)/iu.test(parsed.name)) {
        return;
    }
    const role =
        asString(parsed.args?.agent_role ?? null) ??
        asString(parsed.args?.agent_type ?? null) ??
        asString(parsed.args?.role ?? null) ??
        extractTaskLabel(parsed.args);
    if (!role) {
        return;
    }
    accumulator.roleFanout.push(role);
    if (isVerifier(role)) {
        accumulator.verifierWaves += 1;
    }
};

const captureToolCall = (
    payload: Record<string, JsonValue>,
    record: Record<string, JsonValue>,
    accumulator: AgentDxAccumulator,
) => {
    const parsed = parseCommand(payload);
    const callId = asString(payload.call_id);
    if (callId) {
        accumulator.calls.set(callId, {
            command: parsed.command,
            maxOutputBytes: parsed.maxBytes,
            name: parsed.name,
            workdir: parsed.workdir,
        });
    }
    accumulator.toolCallBytes += recordBytes(record);
    mergeLineageFromPayload(payload, accumulator);
    mergeLineageFromPayload(parsed.args ?? {}, accumulator);
    captureCommandMetrics(parsed, record, accumulator);
    captureToolCounters(parsed.name, accumulator);
    captureSpawnRole(parsed, accumulator);
};

const captureMessage = (payload: Record<string, JsonValue>, accumulator: AgentDxAccumulator) => {
    const phase = asString(payload.phase);
    const role = asString(payload.role) ?? (payload.type === 'agent_message' ? 'assistant' : null);
    const text =
        asString(payload.message) ??
        (Array.isArray(payload.content)
            ? payload.content.map((entry) => asString(asObject(entry)?.text ?? null) ?? '').join(' ')
            : '');
    if (phase === 'final_answer' || payload.type === 'task_complete') {
        accumulator.discoveryEnded = true;
    }
    if (role === 'assistant' && phase === 'final_answer') {
        if (/^\s*(?:blocked|failed|complete|proved|success)\b/iu.test(text)) {
            updateTerminalOutcome(text, accumulator);
        }
        if (accumulator.terminalOutcome === 'unknown') {
            accumulator.terminalOutcome = 'complete';
        }
    }
};

const increment = (counts: CountMap, key: string) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
};

const repeatedCount = (counts: CountMap) =>
    [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);

const captureRecordMetadata = (
    recordType: string | null,
    payload: Record<string, JsonValue> | null,
    accumulator: AgentDxAccumulator,
) => {
    if (recordType !== 'session_meta' && recordType !== 'turn_context') {
        return;
    }
    mergeLineageFromPayload(payload ?? {}, accumulator);
    if (recordType === 'session_meta') {
        accumulator.repositoryIdentityBefore ??= findString(payload, repositoryBeforeKeys);
        return;
    }
    captureTurnOrGoalId(payload, accumulator);
};

const captureTurnOrGoalId = (payload: Record<string, JsonValue> | null, accumulator: AgentDxAccumulator) => {
    const turnId = findString(payload, new Set(['turnid', 'goalid']));
    if (turnId && !accumulator.turnOrGoalIds.includes(turnId)) {
        accumulator.turnOrGoalIds.push(turnId);
    }
};

const captureTaskComplete = (payload: Record<string, JsonValue>, accumulator: AgentDxAccumulator) => {
    updateTerminalOutcome(findString(payload, new Set(['status', 'outcome', 'disposition'])), accumulator);
    if (accumulator.terminalOutcome === 'unknown') {
        accumulator.terminalOutcome = 'complete';
    }
    for (const reference of extractReferences(payload)) {
        accumulator.terminalStatusAndEvidenceReferences.add(reference);
    }
};

const capturePayload = (
    payloadType: string | null,
    payload: Record<string, JsonValue>,
    record: Record<string, JsonValue>,
    accumulator: AgentDxAccumulator,
) => {
    switch (payloadType) {
        case 'token_count':
            captureTokenUsage(payload, accumulator);
            return;
        case 'function_call':
        case 'custom_tool_call':
            captureToolCall(payload, record, accumulator);
            return;
        case 'function_call_output':
        case 'custom_tool_call_output':
            captureToolOutput(payload, accumulator);
            return;
        case 'message':
        case 'user_message':
        case 'agent_message':
            captureMessage(payload, accumulator);
            return;
        case 'task_complete':
            captureMessage(payload, accumulator);
            captureTaskComplete(payload, accumulator);
            return;
        default:
            return;
    }
};

const captureRecordDetails = (record: Record<string, JsonValue>, accumulator: AgentDxAccumulator) => {
    const payload = asObject(record.payload);
    const payloadType = asString(payload?.type ?? null);
    const recordType = asString(record.type);
    const timestampMs = parseTimestampMs(record);
    accumulator.firstRecordAtMs ??= timestampMs ?? accumulator.createdAtMs;
    captureRecordMetadata(recordType, payload, accumulator);
    if (payloadType === 'task_started' || payloadType === 'task_complete') {
        captureTurnOrGoalId(payload, accumulator);
    }
    if (payload) {
        capturePayload(payloadType, payload, record, accumulator);
    }
    accumulator.taskLabelAndKaluRow ??= extractTaskLabel(payload);
    extractLineage(record, accumulator);
    const eventClass = classifyEvent(record, payload);
    accumulator.retainedBytesByEventClass[eventClass] += recordBytes(record);
    if (eventClass === 'reasoning') {
        accumulator.reasoningEventBytes += recordBytes(record);
    }
};

export const createAgentDxAccumulator = (options: CreateAgentDxAccumulatorOptions = {}): AgentDxAccumulator => ({
    assignmentId: null,
    calls: new Map(),
    childStreamBlocks: 0,
    commandCounts: new Map(),
    commandFingerprints: new Set(),
    createdAtMs: options.createdAtMs ?? null,
    cwd: options.cwd ?? '',
    discoveryCallCount: 0,
    discoveryEnded: false,
    discoveryOutputBytes: 0,
    externalCursorConversationOrRunRef: null,
    firstMutationAtMs: null,
    firstRecordAtMs: null,
    gateCounts: new Map(),
    gateFingerprints: new Set(),
    incrementalTokens: createEmptyIncrementalTokens(),
    koterInvocationId: null,
    largeOutputBlocks: 0,
    largeOutputBytes: 0,
    operationId: null,
    outputSaturationBlocks: 0,
    outputSaturationBytes: 0,
    parentToolCallId: null,
    pollWaitCount: 0,
    postimageEvidenceReferences: new Set(),
    readCounts: new Map(),
    readObservations: [],
    reasoningEventBytes: 0,
    reportedUsage: {
        semantics: 'unknown',
        value: options.reportedUsageValue ?? null,
    },
    repositoryIdentityAfter: null,
    repositoryIdentityBefore: options.repositoryIdentityBefore ?? null,
    retainedBytesByEventClass: createEmptyRetainedBytes(),
    roleFanout: [],
    sourceThreadId: options.sourceThreadId ?? '',
    statusReadCount: 0,
    taskLabelAndKaluRow: null,
    terminalOutcome: 'unknown',
    terminalReadCount: 0,
    terminalStatusAndEvidenceReferences: new Set(),
    toolCallBytes: 0,
    toolOutputBytes: 0,
    truncationBlocks: 0,
    turnOrGoalIds: [],
    verifierWaves: 0,
    warnings: [],
});

export const captureAgentDxRecord = (record: Record<string, JsonValue>, accumulator: AgentDxAccumulator): void => {
    captureRecordDetails(record, accumulator);
};

const buildWarnings = (accumulator: AgentDxAccumulator): AgentDxWarning[] => {
    const warnings: AgentDxWarning[] = [];
    if (accumulator.outputSaturationBlocks > 0) {
        warnings.push({
            code: 'output-saturation',
            count: accumulator.outputSaturationBlocks,
            message: 'One or more retained outputs reached or approached a provider or tool output cap.',
        });
    }
    const sameStateReruns = repeatedCount(accumulator.commandCounts);
    if (sameStateReruns > 0) {
        warnings.push({
            code: 'same-state-rerun',
            count: sameStateReruns,
            message: 'A command, read, or gate fingerprint was repeated at the same observed repository state.',
        });
    }
    return warnings;
};

export const finishAgentDxAnalysis = (accumulator: AgentDxAccumulator): AgentDxThreadSummary => ({
    assignmentId: accumulator.assignmentId,
    childStreamBlocks: accumulator.childStreamBlocks,
    commandFingerprints: [...accumulator.commandFingerprints].sort(),
    discoveryCallCount: accumulator.discoveryCallCount,
    discoveryOutputBytes: accumulator.discoveryOutputBytes,
    externalCursorConversationOrRunRef: accumulator.externalCursorConversationOrRunRef,
    firstMutationLatencyMs:
        accumulator.firstMutationAtMs === null || accumulator.firstRecordAtMs === null
            ? null
            : Math.max(0, accumulator.firstMutationAtMs - accumulator.firstRecordAtMs),
    gateFingerprints: [...accumulator.gateFingerprints].sort(),
    incrementalTokens: accumulator.incrementalTokens,
    koterInvocationId: accumulator.koterInvocationId,
    largeOutputBlocks: accumulator.largeOutputBlocks,
    largeOutputBytes: accumulator.largeOutputBytes,
    operationId: accumulator.operationId,
    outputSaturationBlocks: accumulator.outputSaturationBlocks,
    outputSaturationBytes: accumulator.outputSaturationBytes,
    parentToolCallId: accumulator.parentToolCallId,
    pollWaitCount: accumulator.pollWaitCount,
    postimageEvidenceReferences: [...accumulator.postimageEvidenceReferences].sort(),
    readObservations: accumulator.readObservations
        .map((observation) => ({ ...observation }))
        .sort((left, right) =>
            `${left.state}\0${left.fingerprint}`.localeCompare(`${right.state}\0${right.fingerprint}`),
        ),
    reasoningEventBytes: accumulator.reasoningEventBytes,
    repeatedCommandCalls: repeatedCount(accumulator.commandCounts),
    repeatedGateCalls: repeatedCount(accumulator.gateCounts),
    repeatedReadCalls: repeatedCount(accumulator.readCounts),
    reportedUsage: accumulator.reportedUsage,
    repositoryIdentityAfter: accumulator.repositoryIdentityAfter,
    repositoryIdentityBefore: accumulator.repositoryIdentityBefore,
    retainedBytesByEventClass: { ...accumulator.retainedBytesByEventClass },
    roleFanout: [...accumulator.roleFanout].sort(),
    statusReadCount: accumulator.statusReadCount,
    taskLabelAndKaluRow: accumulator.taskLabelAndKaluRow,
    terminalOutcome: accumulator.terminalOutcome,
    terminalReadCount: accumulator.terminalReadCount,
    terminalStatusAndEvidenceReferences: [...accumulator.terminalStatusAndEvidenceReferences].sort(),
    toolCallBytes: accumulator.toolCallBytes,
    toolOutputBytes: accumulator.toolOutputBytes,
    truncationBlocks: accumulator.truncationBlocks,
    turnOrGoalIds: [...accumulator.turnOrGoalIds].sort(),
    verifierWaves: accumulator.verifierWaves,
    warnings: buildWarnings(accumulator),
});

export const parseAgentDxFile = async (
    sessionFile: string,
    options: CreateAgentDxAccumulatorOptions = {},
): Promise<AgentDxThreadSummary> => {
    const accumulator = createAgentDxAccumulator(options);
    for await (const record of readJsonlObjects(sessionFile)) {
        captureAgentDxRecord(record, accumulator);
    }
    return finishAgentDxAnalysis(accumulator);
};

const addNumber = (left: number | null, right: number | null) =>
    left === null && right === null ? null : (left ?? 0) + (right ?? 0);

const sumRetainedBytes = (summaries: AgentDxThreadSummary[]): AgentDxRetainedBytes => {
    const retained = createEmptyRetainedBytes();
    for (const summary of summaries) {
        for (const eventClass of AGENT_DX_EVENT_CLASSES) {
            retained[eventClass] += summary.retainedBytesByEventClass[eventClass];
        }
    }
    return retained;
};

const distribution = (labels: string[]): AgentDxDistributionItem[] => {
    const counts = new Map<string, number>();
    for (const label of labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([label, count]) => ({ count, label }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
};

const aggregateUsage = (summaries: AgentDxThreadSummary[]): AgentDxUsage => {
    const values = summaries.map((summary) => summary.reportedUsage).filter((usage) => usage.value !== null);
    if (values.length === 0) {
        return { semantics: 'unknown', value: null };
    }
    const semantics = new Set(values.map((usage) => usage.semantics));
    return {
        semantics: semantics.size === 1 ? values[0]!.semantics : 'unknown',
        value: values.reduce((total, usage) => total + (usage.value ?? 0), 0),
    };
};

const aggregateTokens = (summaries: AgentDxThreadSummary[]): AgentDxIncrementalTokens => ({
    cachedInput: summaries.reduce<number | null>(
        (total, summary) => addNumber(total, summary.incrementalTokens.cachedInput),
        null,
    ),
    input: summaries.reduce<number | null>((total, summary) => addNumber(total, summary.incrementalTokens.input), null),
    output: summaries.reduce<number | null>(
        (total, summary) => addNumber(total, summary.incrementalTokens.output),
        null,
    ),
    reasoning: summaries.reduce<number | null>(
        (total, summary) => addNumber(total, summary.incrementalTokens.reasoning),
        null,
    ),
});

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

const terminalOutcome = (summaries: AgentDxThreadSummary[]): AgentDxTerminalOutcome => {
    if (summaries.some((summary) => summary.terminalOutcome === 'failed')) {
        return 'failed';
    }
    if (summaries.some((summary) => summary.terminalOutcome === 'blocked')) {
        return 'blocked';
    }
    if (summaries.some((summary) => summary.terminalOutcome === 'complete')) {
        return 'complete';
    }
    return 'unknown';
};

const warningMap = (warnings: AgentDxWarning[]) => {
    const byCode = new Map<AgentDxWarningCode, AgentDxWarning>();
    for (const warning of warnings) {
        const existing = byCode.get(warning.code);
        byCode.set(warning.code, {
            code: warning.code,
            count: (existing?.count ?? 0) + warning.count,
            message: existing?.message ?? warning.message,
        });
    }
    return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
};

const descendantsFor = (
    root: AgentDxThreadDescriptor,
    byId: Map<string, AgentDxThreadDescriptor>,
    childrenById: Map<string, string[]>,
) => {
    const members: AgentDxThreadDescriptor[] = [];
    const visit = (threadId: string) => {
        const descriptor = byId.get(threadId);
        if (!descriptor || members.some((member) => member.threadId === threadId)) {
            return;
        }
        members.push(descriptor);
        for (const childId of childrenById.get(threadId) ?? []) {
            visit(childId);
        }
    };
    visit(root.threadId);
    return members;
};

const collectReadOwners = (members: AgentDxThreadDescriptor[]) => {
    const readOwners = new Map<string, Set<string>>();
    for (const member of members) {
        for (const observation of member.summary.readObservations) {
            const key = `${observation.state}\0${observation.fingerprint}`;
            const owners = readOwners.get(key) ?? new Set<string>();
            owners.add(member.threadId);
            readOwners.set(key, owners);
        }
    }
    return readOwners;
};

const countCrossChildRereads = (readOwners: Map<string, Set<string>>) =>
    [...readOwners.values()].reduce((total, owners) => total + Math.max(0, owners.size - 1), 0);

const sumSummaryMetric = (summaries: AgentDxThreadSummary[], selector: (summary: AgentDxThreadSummary) => number) =>
    summaries.reduce((total, summary) => total + selector(summary), 0);

const firstSummaryString = (
    summaries: AgentDxThreadSummary[],
    selector: (summary: AgentDxThreadSummary) => string | null,
) => summaries.map(selector).find((value): value is string => Boolean(value)) ?? null;

const firstSummaryLatency = (summaries: AgentDxThreadSummary[]) =>
    summaries
        .map((summary) => summary.firstMutationLatencyMs)
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right)[0] ?? null;

const lastSummaryString = (
    summaries: AgentDxThreadSummary[],
    selector: (summary: AgentDxThreadSummary) => string | null,
) =>
    [...summaries]
        .reverse()
        .map(selector)
        .find((value): value is string => Boolean(value)) ?? null;

const buildSpanWarnings = (summaries: AgentDxThreadSummary[], crossChildSameStateRereads: number) => {
    const warnings = summaries.flatMap((summary) => summary.warnings);
    if (crossChildSameStateRereads > 0) {
        warnings.push({
            code: 'cross-child-same-state-reread',
            count: crossChildSameStateRereads,
            message: 'Several child threads reread the same path or range at the same observed repository state.',
        });
    }
    return warningMap(warnings);
};

const childRoleLabels = (members: AgentDxThreadDescriptor[], directChildIds: string[]) =>
    members
        .filter((member) => directChildIds.includes(member.threadId))
        .flatMap((child) => (child.agentRole ? [child.agentRole] : child.summary.roleFanout));

const buildGoalSpan = (
    root: AgentDxThreadDescriptor,
    members: AgentDxThreadDescriptor[],
    directChildIds: string[],
): AgentDxGoalSpan => {
    const summaries = members.map((member) => member.summary);
    const before = root.summary.repositoryIdentityBefore ?? root.gitSha ?? null;
    const turnOrGoalId = root.summary.turnOrGoalIds.length === 1 ? root.summary.turnOrGoalIds[0]! : null;
    const readOwners = collectReadOwners(members);
    const crossChildSameStateRereads = countCrossChildRereads(readOwners);
    const directChildren = members.filter((member) => directChildIds.includes(member.threadId));
    const roleLabels = childRoleLabels(members, directChildIds);
    const taskLabel = root.summary.taskLabelAndKaluRow ?? root.title ?? root.firstUserMessage ?? null;
    const uniqueReadCount = readOwners.size;
    const readCount = members.reduce((total, member) => total + member.summary.readObservations.length, 0);
    const warnings = buildSpanWarnings(summaries, crossChildSameStateRereads);
    const source = root.source;
    const goalSpanId = [source, root.threadId, turnOrGoalId ?? 'thread', before ?? root.cwd].join('\0');
    return {
        assignmentId: summaries.map((summary) => summary.assignmentId).find(Boolean) ?? null,
        childThreadIdsSpawnedInSpan: members
            .filter((member) => member.threadId !== root.threadId)
            .map((member) => member.threadId)
            .sort(),
        crossChildSameStateRereads,
        discoveryCallCount: sumSummaryMetric(summaries, (summary) => summary.discoveryCallCount),
        discoveryOutputBytes: sumSummaryMetric(summaries, (summary) => summary.discoveryOutputBytes),
        externalCursorConversationOrRunRef: firstSummaryString(
            summaries,
            (summary) => summary.externalCursorConversationOrRunRef,
        ),
        firstMutationLatencyMs: firstSummaryLatency(summaries),
        gateFingerprints: uniqueSorted(summaries.flatMap((summary) => summary.gateFingerprints)),
        goalSpanId,
        incrementalTokens: aggregateTokens(summaries),
        koterInvocationId: firstSummaryString(summaries, (summary) => summary.koterInvocationId),
        largeOutputBlocks: sumSummaryMetric(summaries, (summary) => summary.largeOutputBlocks),
        largeOutputBytes: sumSummaryMetric(summaries, (summary) => summary.largeOutputBytes),
        operationId: firstSummaryString(summaries, (summary) => summary.operationId),
        outputSaturationBlocks: sumSummaryMetric(summaries, (summary) => summary.outputSaturationBlocks),
        outputSaturationBytes: sumSummaryMetric(summaries, (summary) => summary.outputSaturationBytes),
        parentToolCallId: firstSummaryString(summaries, (summary) => summary.parentToolCallId),
        pollWaitCount: sumSummaryMetric(summaries, (summary) => summary.pollWaitCount),
        repeatedAuthorityReads: Math.max(0, readCount - uniqueReadCount),
        repeatedCommandCalls: sumSummaryMetric(summaries, (summary) => summary.repeatedCommandCalls),
        repeatedGateCalls: sumSummaryMetric(summaries, (summary) => summary.repeatedGateCalls),
        repeatedReadCalls: sumSummaryMetric(summaries, (summary) => summary.repeatedReadCalls),
        reportedUsage: aggregateUsage(summaries),
        repositoryIdentityAfter: lastSummaryString(summaries, (summary) => summary.repositoryIdentityAfter),
        repositoryIdentityBefore: before,
        retainedBytesByEventClass: sumRetainedBytes(summaries),
        roleFanout: distribution(roleLabels),
        rootThreadId: root.threadId,
        source,
        sourceThreadId: root.threadId,
        statusReadCount: sumSummaryMetric(summaries, (summary) => summary.statusReadCount),
        taskLabelAndKaluRow: taskLabel,
        terminalOutcome: terminalOutcome(summaries),
        terminalReadCount: sumSummaryMetric(summaries, (summary) => summary.terminalReadCount),
        terminalStatusAndEvidenceReferences: uniqueSorted(
            summaries.flatMap((summary) => [
                ...summary.postimageEvidenceReferences,
                ...summary.terminalStatusAndEvidenceReferences,
            ]),
        ),
        truncationBlocks: sumSummaryMetric(summaries, (summary) => summary.truncationBlocks),
        turnOrGoalId,
        uniqueAuthorityReads: uniqueReadCount,
        verifierWaves: Math.max(
            root.summary.verifierWaves,
            directChildren.some((child) => isVerifier(child.agentRole ?? '')) ? 1 : 0,
        ),
        warnings,
    };
};

export const buildAgentDxAnalytics = (descriptors: AgentDxThreadDescriptor[]): AgentDxAnalytics => {
    const byId = new Map(descriptors.map((descriptor) => [descriptor.threadId, descriptor]));
    const parentById = new Map<string, string>();
    const childrenById = new Map<string, string[]>();
    for (const descriptor of descriptors) {
        const children = new Set(childrenById.get(descriptor.threadId) ?? []);
        for (const childId of descriptor.childThreadIds) {
            if (byId.has(childId)) {
                children.add(childId);
                parentById.set(childId, descriptor.threadId);
            }
        }
        childrenById.set(descriptor.threadId, [...children].sort());
        if (descriptor.parentThreadId && byId.has(descriptor.parentThreadId)) {
            parentById.set(descriptor.threadId, descriptor.parentThreadId);
            const parentChildren = new Set(childrenById.get(descriptor.parentThreadId) ?? []);
            parentChildren.add(descriptor.threadId);
            childrenById.set(descriptor.parentThreadId, [...parentChildren].sort());
        }
    }
    const roots = descriptors.filter((descriptor) => !parentById.has(descriptor.threadId));
    const goalSpans = roots
        .map((root) =>
            buildGoalSpan(root, descendantsFor(root, byId, childrenById), childrenById.get(root.threadId) ?? []),
        )
        .sort((left, right) => left.goalSpanId.localeCompare(right.goalSpanId));
    return {
        goalSpans,
        schema: AGENT_DX_ANALYTICS_SCHEMA,
        warnings: warningMap(goalSpans.flatMap((span) => span.warnings)),
    };
};

export const AGENT_DX_CSV_COLUMNS = [
    'goal_span_id',
    'source',
    'source_thread_id',
    'root_thread_id',
    'turn_or_goal_id',
    'repository_identity_before',
    'repository_identity_after',
    'task_label_and_kalu_row',
    'child_thread_ids_spawned_in_span',
    'reported_usage_value',
    'reported_usage_semantics',
    'incremental_tokens',
    'retained_bytes_by_event_class',
    'large_output_blocks',
    'large_output_bytes',
    'output_saturation_blocks',
    'output_saturation_bytes',
    'truncation_blocks',
    'unique_authority_reads',
    'repeated_authority_reads',
    'cross_child_same_state_rereads',
    'repeated_command_calls',
    'repeated_gate_calls',
    'repeated_read_calls',
    'poll_wait_count',
    'status_read_count',
    'terminal_read_count',
    'role_fanout',
    'verifier_waves',
    'first_mutation_latency_ms',
    'discovery_call_count',
    'discovery_output_bytes',
    'gate_fingerprints',
    'terminal_outcome',
    'terminal_status_and_evidence_references',
    'assignment_id',
    'operation_id',
    'parent_tool_call_id',
    'koter_invocation_id',
    'external_cursor_conversation_or_run_ref',
    'warnings',
] as const;

const csvText = (value: unknown) => {
    const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
    return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const spanCsvValues = (span: AgentDxGoalSpan): unknown[] => [
    span.goalSpanId,
    span.source,
    span.sourceThreadId,
    span.rootThreadId,
    span.turnOrGoalId,
    span.repositoryIdentityBefore,
    span.repositoryIdentityAfter,
    span.taskLabelAndKaluRow,
    span.childThreadIdsSpawnedInSpan,
    span.reportedUsage.value,
    span.reportedUsage.semantics,
    span.incrementalTokens,
    span.retainedBytesByEventClass,
    span.largeOutputBlocks,
    span.largeOutputBytes,
    span.outputSaturationBlocks,
    span.outputSaturationBytes,
    span.truncationBlocks,
    span.uniqueAuthorityReads,
    span.repeatedAuthorityReads,
    span.crossChildSameStateRereads,
    span.repeatedCommandCalls,
    span.repeatedGateCalls,
    span.repeatedReadCalls,
    span.pollWaitCount,
    span.statusReadCount,
    span.terminalReadCount,
    span.roleFanout,
    span.verifierWaves,
    span.firstMutationLatencyMs,
    span.discoveryCallCount,
    span.discoveryOutputBytes,
    span.gateFingerprints,
    span.terminalOutcome,
    span.terminalStatusAndEvidenceReferences,
    span.assignmentId,
    span.operationId,
    span.parentToolCallId,
    span.koterInvocationId,
    span.externalCursorConversationOrRunRef,
    span.warnings,
];

export const renderAgentDxAnalyticsExport = (analytics: AgentDxAnalytics, format: 'csv' | 'json') => {
    if (format === 'json') {
        return `${JSON.stringify(analytics, null, 2)}\n`;
    }
    const rows = [AGENT_DX_CSV_COLUMNS.join(',')];
    for (const span of analytics.goalSpans) {
        rows.push(spanCsvValues(span).map(csvText).join(','));
    }
    return `${rows.join('\n')}\n`;
};
