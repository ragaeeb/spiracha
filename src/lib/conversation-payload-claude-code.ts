import { collectClaudeCodeEvents, type SessionIdentity } from './claude-code-events';
import { claudeCodeTranscriptToMessages } from './conversation-data/claude-code-messages';
import type { ConversationPayloadSource, PayloadConversationDraft } from './conversation-payload-types';
import { cleanInlineTitle, type JsonValue } from './shared-text';

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

// A Claude Code session line: a user or assistant event bound to a session and entry ID.
export const isClaudeCodeSessionEvent = (value: unknown): boolean => {
    if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.uuid !== 'string') {
        return false;
    }
    const message = value.message;
    return (
        (value.type === 'user' || value.type === 'assistant') &&
        isRecord(message) &&
        (typeof message.content === 'string' || Array.isArray(message.content))
    );
};

// Lines without a session ID (snapshots, summaries) belong to the session before them.
const groupBySession = (records: Record<string, JsonValue>[]): Map<string, Record<string, JsonValue>[]> => {
    const groups = new Map<string, Record<string, JsonValue>[]>();
    let current: string | null = null;
    for (const record of records) {
        const sessionId: string | null =
            typeof record.sessionId === 'string' && record.sessionId ? record.sessionId : current;
        if (!sessionId) {
            continue;
        }
        current = sessionId;
        const group = groups.get(sessionId) ?? [];
        group.push(record);
        groups.set(sessionId, group);
    }
    return groups;
};

const toDraft = (sessionId: string, events: Record<string, JsonValue>[]): PayloadConversationDraft => {
    const identity: SessionIdentity = {
        cwd: null,
        firstUserText: null,
        gitBranch: null,
        isSubagent: false,
        model: null,
        sessionId,
        title: null,
        version: null,
    };
    const { entries, timeline } = collectClaudeCodeEvents(events, identity, false);
    const title = identity.title ?? identity.firstUserText;
    return {
        createdAtMs: timeline.firstMs,
        id: sessionId,
        messages: claudeCodeTranscriptToMessages({ entries }),
        metadata: {
            ...(identity.gitBranch ? { gitBranch: identity.gitBranch } : {}),
            ...(identity.version ? { version: identity.version } : {}),
        },
        model: identity.model,
        source: 'claude-code',
        title: title ? cleanInlineTitle(title) : null,
        updatedAtMs: timeline.lastMs,
        workspacePath: identity.cwd,
    };
};

/** Converts raw Claude Code session JSONL events; returns null for payloads without session events. */
export const parseClaudeCodePayload = (
    value: unknown,
    _sourceHint?: ConversationPayloadSource,
): PayloadConversationDraft[] | null => {
    const records = (Array.isArray(value) ? value : [value]).filter(isRecord);
    if (!records.some(isClaudeCodeSessionEvent)) {
        return null;
    }
    return [...groupBySession(records)].map(([sessionId, events]) => toDraft(sessionId, events));
};
