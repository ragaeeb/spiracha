import { asObject, asString, type JsonValue, readJsonlObjects } from './shared';

export type ThreadOptimizationSummary = {
    broadReadCalls: number;
    commandCalls: number;
    externalAgentStreamBlocks: number;
    externalAgentStreamBytes: number;
    fullContextSpawns: number;
    genericSubagentSpawns: number;
    parentVisibleReasoningEvents: number;
    parentVisibleSubagentToolEvents: number;
    personaTaskLabels: string[];
    repeatedCheckCalls: number;
    repeatedCommandCalls: number;
    repeatedReadCalls: number;
    timedOutWaits: number;
    toolOutputBytes: number;
    truncationBlocks: number;
    truncatedOutputBytes: number;
};

type ToolCall = {
    arguments: Record<string, JsonValue> | null;
    name: string;
};

export type CodexOptimizationAccumulator = {
    calls: Map<string, ToolCall>;
    checkCounts: Map<string, number>;
    commandCounts: Map<string, number>;
    readCounts: Map<string, number>;
    summary: ThreadOptimizationSummary;
};

const createEmptySummary = (): ThreadOptimizationSummary => ({
    broadReadCalls: 0,
    commandCalls: 0,
    externalAgentStreamBlocks: 0,
    externalAgentStreamBytes: 0,
    fullContextSpawns: 0,
    genericSubagentSpawns: 0,
    parentVisibleReasoningEvents: 0,
    parentVisibleSubagentToolEvents: 0,
    personaTaskLabels: [],
    repeatedCheckCalls: 0,
    repeatedCommandCalls: 0,
    repeatedReadCalls: 0,
    timedOutWaits: 0,
    toolOutputBytes: 0,
    truncatedOutputBytes: 0,
    truncationBlocks: 0,
});

const parseObjectText = (value: JsonValue | undefined): Record<string, JsonValue> | null => {
    if (typeof value !== 'string') {
        return asObject(value ?? null);
    }

    try {
        return asObject(JSON.parse(value) as JsonValue);
    } catch {
        return null;
    }
};

const outputText = (value: JsonValue | undefined) => {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined) {
        return '';
    }
    return JSON.stringify(value);
};

const countMatches = (value: string, pattern: RegExp) => [...value.matchAll(pattern)].length;

const normalizeCommand = (command: string) => command.trim().replaceAll(/\s+/gu, ' ');

const countReadOperations = (command: string) =>
    countMatches(command, /(?:^|&&|\|\||;)\s*(?:rtk\s+)?(?:cat|grep|read|rg|sed)\b/giu);

const isCheckCommand = (command: string) =>
    /(?:^|\s)(?:check(?::[\w-]+)?|lint|test(?::[\w-]+)?|typecheck)(?:\s|$)/iu.test(command);

const increment = (counts: Map<string, number>, value: string) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
};

const repeatedCount = (counts: Map<string, number>) =>
    [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);

const normalizeTaskLabel = (taskName: string) =>
    taskName
        .replace(/^\/root\//u, '')
        .replaceAll(/[_-]+/gu, ' ')
        .replaceAll(/\s+/gu, ' ')
        .trim();

const personaTheme = (taskName: string) => {
    const label = normalizeTaskLabel(taskName);
    if (/adjudicat/iu.test(label)) {
        return 'finding adjudication';
    }
    if (/receipt|evidence|closeout/iu.test(label)) {
        return 'evidence and closeout';
    }
    if (/verif|\btest/iu.test(label)) {
        return 'verification and testing';
    }
    if (/audit|review|inspect/iu.test(label)) {
        return 'audit and review';
    }
    if (/architect|design|\bplan/iu.test(label)) {
        return 'planning and architecture';
    }
    if (/build|finish|\bfix|implement/iu.test(label)) {
        return 'bounded implementation';
    }
    return label;
};

const captureSpawn = (call: ToolCall, summary: ThreadOptimizationSummary) => {
    const forkTurns = asString(call.arguments?.fork_turns ?? null);
    if (forkTurns === 'all') {
        summary.fullContextSpawns += 1;
    }

    const agentType = asString(call.arguments?.agent_type ?? null);
    const isGeneric = !agentType || agentType === 'default' || agentType === 'explorer' || agentType === 'worker';
    if (!isGeneric) {
        return;
    }

    summary.genericSubagentSpawns += 1;
    const taskName = asString(call.arguments?.task_name ?? null);
    if (taskName) {
        const label = personaTheme(taskName);
        if (label) {
            summary.personaTaskLabels.push(label);
        }
    }
};

const captureCommand = (
    call: ToolCall,
    summary: ThreadOptimizationSummary,
    commandCounts: Map<string, number>,
    readCounts: Map<string, number>,
    checkCounts: Map<string, number>,
) => {
    const command = asString(call.arguments?.cmd ?? null);
    if (!command) {
        return;
    }

    summary.commandCalls += 1;
    const normalized = normalizeCommand(command);
    increment(commandCounts, normalized);
    const readOperations = countReadOperations(normalized);
    if (readOperations > 0) {
        increment(readCounts, normalized);
        if (readOperations > 1) {
            summary.broadReadCalls += 1;
        }
    }
    if (isCheckCommand(normalized)) {
        increment(checkCounts, normalized);
    }
};

const captureOutput = (
    call: ToolCall | undefined,
    value: JsonValue | undefined,
    summary: ThreadOptimizationSummary,
) => {
    const output = outputText(value);
    const bytes = new TextEncoder().encode(output).byteLength;
    summary.toolOutputBytes += bytes;

    if (/truncated output|output truncated|preview truncated/iu.test(output)) {
        summary.truncationBlocks += 1;
        summary.truncatedOutputBytes += bytes;
    }

    const reasoningEvents = countMatches(output, /"type"\s*:\s*"(?:thinking[_-]delta|reasoning[_-]delta)"/giu);
    const toolEvents = countMatches(output, /"type"\s*:\s*"(?:tool[_-](?:call|result|output))"/giu);
    if (reasoningEvents > 0 || toolEvents > 0) {
        summary.externalAgentStreamBlocks += 1;
        summary.externalAgentStreamBytes += bytes;
        summary.parentVisibleReasoningEvents += reasoningEvents;
        summary.parentVisibleSubagentToolEvents += toolEvents;
    }

    if (
        (call?.name === 'wait' || call?.name === 'wait_agent') &&
        /"timed_out"\s*:\s*true|wait timed out/iu.test(output)
    ) {
        summary.timedOutWaits += 1;
    }
};

export const createCodexOptimizationAccumulator = (): CodexOptimizationAccumulator => ({
    calls: new Map(),
    checkCounts: new Map(),
    commandCounts: new Map(),
    readCounts: new Map(),
    summary: createEmptySummary(),
});

const captureToolCallPayload = (payload: Record<string, JsonValue>, accumulator: CodexOptimizationAccumulator) => {
    const call: ToolCall = {
        arguments: parseObjectText(payload.arguments ?? payload.input),
        name: asString(payload.name) ?? 'unknown',
    };
    const callId = asString(payload.call_id);
    if (callId) {
        accumulator.calls.set(callId, call);
    }
    if (call.name === 'spawn_agent') {
        captureSpawn(call, accumulator.summary);
    }
    if (call.name === 'exec_command') {
        captureCommand(
            call,
            accumulator.summary,
            accumulator.commandCounts,
            accumulator.readCounts,
            accumulator.checkCounts,
        );
    }
};

const captureToolOutputPayload = (payload: Record<string, JsonValue>, accumulator: CodexOptimizationAccumulator) => {
    const callId = asString(payload.call_id);
    captureOutput(callId ? accumulator.calls.get(callId) : undefined, payload.output, accumulator.summary);
};

export const captureCodexOptimizationRecord = (
    parsed: Record<string, JsonValue>,
    accumulator: CodexOptimizationAccumulator,
) => {
    if (parsed.type !== 'response_item') {
        return;
    }

    const payload = asObject(parsed.payload);
    const payloadType = asString(payload?.type ?? null);
    if (!payload || !payloadType) {
        return;
    }

    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
        captureToolCallPayload(payload, accumulator);
        return;
    }

    if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
        captureToolOutputPayload(payload, accumulator);
    }
};

export const finishCodexOptimizationAnalysis = (accumulator: CodexOptimizationAccumulator) => {
    accumulator.summary.repeatedCommandCalls = repeatedCount(accumulator.commandCounts);
    accumulator.summary.repeatedReadCalls = repeatedCount(accumulator.readCounts);
    accumulator.summary.repeatedCheckCalls = repeatedCount(accumulator.checkCounts);
    return accumulator.summary;
};

export const parseCodexOptimizationFile = async (sessionFile: string): Promise<ThreadOptimizationSummary> => {
    const accumulator = createCodexOptimizationAccumulator();
    for await (const parsed of readJsonlObjects(sessionFile)) {
        captureCodexOptimizationRecord(parsed, accumulator);
    }
    return finishCodexOptimizationAnalysis(accumulator);
};
