import { createHash } from 'node:crypto';
import { matchEvidenceEvent } from './evidence-lens';
import type { ConversationEvidenceEvent, EvidenceLens } from './types';

export type EvidenceEpisodeOutcome = 'abandoned' | 'failed' | 'succeeded' | 'unknown';
export type EvidenceEpisode = {
    anchor: ConversationEvidenceEvent;
    events: ConversationEvidenceEvent[];
    outcome: EvidenceEpisodeOutcome;
};

const MAX_EPISODES = 256;
const MAX_UNMATCHED_CALLS = 512;
const MAX_EXACT_CALL_IDS = 1024;

const toolIdentity = (event: ConversationEvidenceEvent) =>
    event.tool ? `${event.tool.namespace ?? ''}\0${event.tool.name}\0${event.tool.command ?? ''}` : '';

const inputFingerprint = (event: ConversationEvidenceEvent) => {
    const input = event.tool?.command ?? event.tool?.inputText ?? '';
    return createHash('sha256').update(input).digest('hex');
};

const findFallbackCallIndex = (
    paired: ConversationEvidenceEvent[],
    unmatchedCalls: number[],
    event: ConversationEvidenceEvent,
    maxOrderGap: number,
) =>
    unmatchedCalls.findLast((candidate) => {
        const call = paired[candidate]!;
        const nameMatches = !event.tool?.name || !call.tool?.name || event.tool.name === call.tool.name;
        return event.order - call.order <= maxOrderGap && nameMatches;
    });

const pairOutputEvent = (
    paired: ConversationEvidenceEvent[],
    callsById: Map<string, number>,
    unmatchedCalls: number[],
    event: ConversationEvidenceEvent,
    maxOrderGap: number,
) => {
    const exactIndex = event.tool?.callId ? callsById.get(event.tool.callId) : undefined;
    const fallbackIndex =
        exactIndex === undefined ? findFallbackCallIndex(paired, unmatchedCalls, event, maxOrderGap) : undefined;
    const callIndex = exactIndex ?? fallbackIndex;
    const confidence: ConversationEvidenceEvent['pairingConfidence'] =
        exactIndex !== undefined ? 'exact' : fallbackIndex === undefined ? 'unpaired' : 'ordered_fallback';
    event.pairingConfidence = confidence;
    if (callIndex === undefined) {
        return;
    }
    paired[callIndex]!.pairingConfidence = confidence;
    unmatchedCalls.splice(unmatchedCalls.indexOf(callIndex), 1);
    const callId = paired[callIndex]!.tool?.callId;
    if (callId) {
        callsById.delete(callId);
    }
};

const pairToolEvents = (events: ConversationEvidenceEvent[], maxOrderGap: number) => {
    const paired = events.map((event) => ({ ...event }));
    const callsById = new Map<string, number>();
    const unmatchedCalls: number[] = [];
    for (const [index, event] of paired.entries()) {
        if (event.phase === 'tool_call') {
            if (event.tool?.callId) {
                callsById.set(event.tool.callId, index);
                if (callsById.size > MAX_EXACT_CALL_IDS) {
                    callsById.delete(callsById.keys().next().value as string);
                }
            }
            unmatchedCalls.push(index);
            if (unmatchedCalls.length > MAX_UNMATCHED_CALLS) {
                unmatchedCalls.shift();
            }
            continue;
        }
        if (event.phase !== 'tool_output') {
            continue;
        }
        pairOutputEvent(paired, callsById, unmatchedCalls, event, maxOrderGap);
    }
    return paired;
};

const pairedOutputIndex = (events: ConversationEvidenceEvent[], callIndex: number, maxOrderGap: number) => {
    const call = events[callIndex]!;
    return events.findIndex(
        (event, index) =>
            index > callIndex &&
            event.phase === 'tool_output' &&
            event.order - call.order <= maxOrderGap &&
            ((call.tool?.callId && event.tool?.callId === call.tool.callId) ||
                (!call.tool?.callId && event.pairingConfidence === 'ordered_fallback')),
    );
};

const outcomeOf = (events: ConversationEvidenceEvent[]): EvidenceEpisodeOutcome => {
    const lastToolEvent = events.findLast((event) => event.phase === 'tool_output' || event.phase === 'tool_call');
    if (!lastToolEvent) {
        return 'unknown';
    }
    if (lastToolEvent.phase === 'tool_call') {
        return 'abandoned';
    }
    if (lastToolEvent.tool?.status === 'succeeded' || lastToolEvent.tool?.exitCode === 0) {
        return 'succeeded';
    }
    if (lastToolEvent.tool?.status === 'failed' || (lastToolEvent.tool?.exitCode ?? 0) !== 0) {
        return 'failed';
    }
    return 'unknown';
};

const isMechanicalProgress = (text: string) =>
    /^(?:waiting|waited|progress|loading|still working|retrying|running)\b/iu.test(text.trim());

const addNearbyContext = (
    selected: Set<number>,
    events: ConversationEvidenceEvent[],
    anchorIndex: number,
    count: number,
    direction: -1 | 1,
    lens: EvidenceLens,
) => {
    let remaining = count;
    for (
        let index = anchorIndex + direction;
        index >= 0 && index < events.length && remaining > 0;
        index += direction
    ) {
        if (Math.abs(events[index]!.order - events[anchorIndex]!.order) > lens.context.maxOrderGap) {
            break;
        }
        const phase = events[index]!.phase;
        const selectedPhase =
            phase === 'commentary' || (lens.context.includeReasoningSummaries && phase === 'reasoning');
        if (selectedPhase && !isMechanicalProgress(events[index]!.text)) {
            selected.add(index);
            remaining -= 1;
        }
    }
};

const addConfiguredFollowUps = (
    selected: Set<number>,
    events: ConversationEvidenceEvent[],
    anchorIndex: number,
    lens: EvidenceLens,
) => {
    if (!lens.context.followWorkarounds) {
        return;
    }
    const anchor = events[anchorIndex]!;
    for (let index = anchorIndex + 1; index < events.length; index += 1) {
        const candidate = events[index]!;
        if (candidate.order - anchor.order > lens.context.maxOrderGap) {
            break;
        }
        if (candidate.phase !== 'tool_call' || !lens.anchors.some((item) => matchEvidenceEvent(candidate, item))) {
            continue;
        }
        selected.add(index);
        const outputIndex = pairedOutputIndex(events, index, lens.context.maxOrderGap);
        if (outputIndex >= 0) {
            selected.add(outputIndex);
        }
    }
};

const contextIndexes = (events: ConversationEvidenceEvent[], anchorIndex: number, lens: EvidenceLens) => {
    const selected = new Set<number>([anchorIndex]);
    addNearbyContext(selected, events, anchorIndex, lens.context.commentaryBefore, -1, lens);
    addNearbyContext(selected, events, anchorIndex, lens.context.commentaryAfter, 1, lens);
    const outputIndex = pairedOutputIndex(events, anchorIndex, lens.context.maxOrderGap);
    if (outputIndex >= 0) {
        selected.add(outputIndex);
    }
    return selected;
};

const addRetries = (
    selected: Set<number>,
    events: ConversationEvidenceEvent[],
    anchorIndex: number,
    lens: EvidenceLens,
) => {
    if (!lens.context.followRetries || events[anchorIndex]!.phase !== 'tool_call') {
        return;
    }
    const anchor = events[anchorIndex]!;
    const identity = toolIdentity(anchor);
    const fingerprint = inputFingerprint(anchor);
    for (let index = anchorIndex + 1; index < events.length; index += 1) {
        const candidate = events[index]!;
        if (candidate.order - anchor.order > lens.context.maxOrderGap) {
            break;
        }
        if (candidate.phase !== 'tool_call') {
            continue;
        }
        if (toolIdentity(candidate) !== identity || inputFingerprint(candidate) !== fingerprint) {
            continue;
        }
        selected.add(index);
        const outputIndex = pairedOutputIndex(events, index, lens.context.maxOrderGap);
        if (outputIndex >= 0) {
            selected.add(outputIndex);
        }
    }
};

const mergeEpisodeCandidates = (
    candidates: Array<{ anchorIndex: number; indexes: Set<number> }>,
    events: ConversationEvidenceEvent[],
) => {
    const merged: Array<{ anchorIndex: number; indexes: Set<number> }> = [];
    for (const candidate of candidates) {
        const overlapping = merged.find((episode) =>
            [...candidate.indexes].some((index) => episode.indexes.has(index)),
        );
        if (!overlapping) {
            merged.push(candidate);
            continue;
        }
        for (const index of candidate.indexes) {
            overlapping.indexes.add(index);
        }
        const candidateIsTool = events[candidate.anchorIndex]!.phase === 'tool_call';
        const currentIsTool = events[overlapping.anchorIndex]!.phase === 'tool_call';
        if (candidateIsTool && !currentIsTool) {
            overlapping.anchorIndex = candidate.anchorIndex;
        }
    }
    return merged;
};

export const buildEvidenceEpisodes = (
    inputEvents: ConversationEvidenceEvent[],
    lens: EvidenceLens,
): EvidenceEpisode[] => {
    const events = pairToolEvents(inputEvents, lens.context.maxOrderGap);
    const candidates: Array<{ anchorIndex: number; indexes: Set<number> }> = [];
    for (const [index, event] of events.entries()) {
        if (event.phase === 'tool_output' || isMechanicalProgress(event.text)) {
            continue;
        }
        if (!lens.anchors.some((anchor) => matchEvidenceEvent(event, anchor))) {
            continue;
        }
        const indexes = contextIndexes(events, index, lens);
        addRetries(indexes, events, index, lens);
        addConfiguredFollowUps(indexes, events, index, lens);
        candidates.push({ anchorIndex: index, indexes });
        if (candidates.length >= MAX_EPISODES) {
            break;
        }
    }
    return mergeEpisodeCandidates(candidates, events)
        .map(({ anchorIndex, indexes }) => {
            const episodeEvents = [...indexes].sort((left, right) => left - right).map((index) => events[index]!);
            return { anchor: events[anchorIndex]!, events: episodeEvents, outcome: outcomeOf(episodeEvents) };
        })
        .slice(0, MAX_EPISODES);
};
