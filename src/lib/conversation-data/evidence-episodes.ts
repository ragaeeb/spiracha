import { createHash } from 'node:crypto';
import { matchEvidenceEvent } from './evidence-lens';
import type { ConversationEvidenceEvent, EvidenceLens, EvidenceOmissionStats } from './types';

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
) => {
    const candidates = unmatchedCalls.filter((candidate) => {
        const call = paired[candidate]!;
        const name = event.tool?.name;
        const nameMatches = !name || name === 'unknown' || !call.tool?.name || name === call.tool.name;
        return event.order - call.order <= maxOrderGap && nameMatches;
    });
    return candidates.length === 1 ? candidates[0] : undefined;
};

const pairOutputEvent = (
    paired: ConversationEvidenceEvent[],
    callsById: Map<string, number>,
    unmatchedCalls: number[],
    event: ConversationEvidenceEvent,
    eventIndex: number,
    maxOrderGap: number,
) => {
    const exactIndex = event.tool?.callId ? callsById.get(event.tool.callId) : undefined;
    const fallbackIndex = !event.tool?.callId
        ? findFallbackCallIndex(paired, unmatchedCalls, event, maxOrderGap)
        : undefined;
    const callIndex = exactIndex ?? fallbackIndex;
    const confidence: ConversationEvidenceEvent['pairingConfidence'] =
        exactIndex !== undefined ? 'exact' : fallbackIndex === undefined ? 'unpaired' : 'ordered_fallback';
    event.pairingConfidence = confidence;
    if (callIndex === undefined) {
        return;
    }
    event.pairedCallIndex = callIndex;
    paired[callIndex]!.pairingConfidence = confidence;
    paired[callIndex]!.pairedOutputIndex = eventIndex;
    const unmatchedIndex = unmatchedCalls.indexOf(callIndex);
    if (unmatchedIndex >= 0) {
        unmatchedCalls.splice(unmatchedIndex, 1);
    }
    const callId = paired[callIndex]!.tool?.callId;
    if (callId) {
        callsById.delete(callId);
    }
};

/**
 * Pairs copied events with explicit call IDs when retained, otherwise a bounded
 * ordered fallback constrained by the order gap. Exact-ID and unmatched-call state
 * are capped; older calls can be evicted. Confidence records exact, ordered_fallback,
 * or unpaired and must never upgrade a heuristic match to an exact relationship.
 * Input events are shallow-copied; pairing is evidence reconstruction, not proof of
 * a source application's full causal graph.
 */
const registerCall = (
    event: ConversationEvidenceEvent,
    index: number,
    callsById: Map<string, number>,
    unmatchedCalls: number[],
) => {
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
};

const pairToolEvents = (events: ConversationEvidenceEvent[], maxOrderGap: number) => {
    const paired = events.map((event) => ({ ...event }));
    const callsById = new Map<string, number>();
    const unmatchedCalls: number[] = [];
    for (const [index, event] of paired.entries()) {
        if (event.role === 'user' && event.phase !== 'tool_output') {
            unmatchedCalls.length = 0;
        }
        if (event.phase === 'tool_call') {
            registerCall(event, index, callsById, unmatchedCalls);
            continue;
        }
        if (event.phase !== 'tool_output') {
            continue;
        }
        pairOutputEvent(paired, callsById, unmatchedCalls, event, index, maxOrderGap);
    }
    return paired;
};

const pairedOutputIndex = (events: ConversationEvidenceEvent[], callIndex: number) =>
    events[callIndex]!.pairedOutputIndex ?? -1;

const outcomeOf = (events: ConversationEvidenceEvent[]): EvidenceEpisodeOutcome => {
    const lastToolEvent = events.findLast((event) => event.phase === 'tool_output' || event.phase === 'tool_call');
    if (!lastToolEvent) {
        return 'unknown';
    }
    if (lastToolEvent.phase === 'tool_call') {
        return 'unknown';
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

const isContext = (event: ConversationEvidenceEvent, includeReasoning: boolean) =>
    (event.phase === 'commentary' || (includeReasoning && event.phase === 'reasoning')) &&
    !isMechanicalProgress(event.text);

const contextBoundary = (event: ConversationEvidenceEvent) => {
    if (event.role === 'user' && event.phase !== 'tool_output') {
        return -1;
    }
    return event.phase === 'final_answer' ? 1 : 0;
};

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
        const boundary = contextBoundary(events[index]!);
        if (boundary !== 0) {
            if (direction === boundary) {
                selected.add(index);
            }
            break;
        }
        if (isContext(events[index]!, lens.context.includeReasoningSummaries)) {
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
        if (candidate.role === 'user' || candidate.phase === 'final_answer') {
            break;
        }
        if (candidate.order - anchor.order > lens.context.maxOrderGap) {
            break;
        }
        if (candidate.phase !== 'tool_call' || !lens.anchors.some((item) => matchEvidenceEvent(candidate, item))) {
            continue;
        }
        selected.add(index);
        const outputIndex = pairedOutputIndex(events, index);
        if (outputIndex >= 0) {
            selected.add(outputIndex);
        }
    }
};

const contextIndexes = (events: ConversationEvidenceEvent[], anchorIndex: number, lens: EvidenceLens) => {
    const selected = new Set<number>([anchorIndex]);
    const callIndex = events[anchorIndex]!.pairedCallIndex;
    if (callIndex !== undefined) {
        selected.add(callIndex);
    }
    addNearbyContext(selected, events, anchorIndex, lens.context.commentaryBefore, -1, lens);
    addNearbyContext(selected, events, anchorIndex, lens.context.commentaryAfter, 1, lens);
    const outputIndex = pairedOutputIndex(events, anchorIndex);
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
        if (candidate.role === 'user' || candidate.phase === 'final_answer') {
            break;
        }
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
        const outputIndex = pairedOutputIndex(events, index);
        if (outputIndex >= 0) {
            selected.add(outputIndex);
        }
    }
};

type EpisodeCandidate = { anchorIndex: number; indexes: Set<number> };

const overlaps = (left: EpisodeCandidate, right: EpisodeCandidate) =>
    [...left.indexes].some((index) => right.indexes.has(index));

const combineEpisodeCandidates = (
    candidate: EpisodeCandidate,
    overlapping: EpisodeCandidate[],
    events: ConversationEvidenceEvent[],
): EpisodeCandidate => {
    const indexes = new Set(candidate.indexes);
    for (const episode of overlapping) {
        for (const index of episode.indexes) {
            indexes.add(index);
        }
    }
    const anchorIndex = [candidate.anchorIndex, ...overlapping.map((episode) => episode.anchorIndex)].find(
        (index) => events[index]!.phase === 'tool_call',
    );
    return { anchorIndex: anchorIndex ?? candidate.anchorIndex, indexes };
};

const mergeEpisodeCandidates = (
    candidates: EpisodeCandidate[],
    events: ConversationEvidenceEvent[],
    maxOrderGap: number,
) => {
    const merged: EpisodeCandidate[] = [];
    for (const candidate of candidates) {
        const overlapping = merged.filter((episode) => {
            const indexes = [...episode.indexes, ...candidate.indexes];
            const first = Math.min(...indexes),
                last = Math.max(...indexes);
            return (
                overlaps(candidate, episode) &&
                events[last]!.order - events[first]!.order <= maxOrderGap &&
                !events
                    .slice(first + 1, last + 1)
                    .some((event) => event.role === 'user' && event.phase !== 'tool_output')
            );
        });
        if (overlapping.length === 0) {
            merged.push(candidate);
            continue;
        }
        const combined = combineEpisodeCandidates(candidate, overlapping, events);
        for (const episode of overlapping) {
            const index = merged.indexOf(episode);
            if (index >= 0) {
                merged.splice(index, 1);
            }
        }
        merged.push(combined);
    }
    return merged;
};

export const buildEvidenceEpisodes = (
    inputEvents: ConversationEvidenceEvent[],
    lens: EvidenceLens,
    stats?: EvidenceOmissionStats,
): EvidenceEpisode[] => {
    const events = pairToolEvents(inputEvents, lens.context.maxOrderGap);
    const candidates: Array<{ anchorIndex: number; indexes: Set<number> }> = [];
    for (const [index, event] of events.entries()) {
        if (
            event.phase === 'commentary' &&
            isMechanicalProgress(event.text) &&
            !lens.anchors.some((anchor) => anchor.kind === 'text' && matchEvidenceEvent(event, anchor))
        ) {
            continue;
        }
        if (!lens.anchors.some((anchor) => matchEvidenceEvent(event, anchor))) {
            continue;
        }
        const indexes = contextIndexes(events, index, lens);
        addRetries(indexes, events, index, lens);
        addConfiguredFollowUps(indexes, events, index, lens);
        candidates.push({ anchorIndex: index, indexes });
        if (candidates.length > MAX_EPISODES) {
            // Keep the opening evidence and latest resolution within bounded selection state.
            candidates.splice(MAX_EPISODES / 2, 1);
            if (stats) {
                stats.candidateLimitReached = true;
            }
        }
    }
    return mergeEpisodeCandidates(candidates, events, lens.context.maxOrderGap)
        .map(({ anchorIndex, indexes }) => {
            const episodeEvents = [...indexes].sort((left, right) => left - right).map((index) => events[index]!);
            return { anchor: events[anchorIndex]!, events: episodeEvents, outcome: outcomeOf(episodeEvents) };
        })
        .sort((a, b) => a.events[0]!.order - b.events[0]!.order)
        .slice(0, MAX_EPISODES);
};
