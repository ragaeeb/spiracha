import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
    type AntigravityArtifact,
    type AntigravityConversation,
    type AntigravityTranscriptSource,
    type AntigravityWorkspaceGroup,
    getAntigravityBrainDir,
    getAntigravityConversationDir,
    getAntigravitySummaryIndexPath,
    resolveAntigravityRoots,
} from './antigravity-exporter-types';
import { decryptAntigravitySafeStoragePayload } from './antigravity-keychain';

type ProtoField = {
    bytes?: Uint8Array;
    fieldNumber: number;
    value?: number;
    wireType: number;
};

type SummaryEntry = {
    conversationId: string;
    createdAtMs: number | null;
    indexedItemCount: number | null;
    lastUpdatedAtMs: number | null;
    summaryPath: string;
    title: string;
    workspaceFolder: string | null;
    workspaceKey: string;
    workspaceLabel: string;
    workspaceUri: string | null;
};

type ConversationFile = {
    bytes: number;
    mtimeMs: number;
    path: string;
    root: string;
};

type TranscriptFile = {
    bytes: number;
    entryCount: number;
    mtimeMs: number;
    path: string;
    root: string;
    source: Exclude<AntigravityTranscriptSource, 'safe-storage'>;
};

type WorkspaceInfo = Pick<SummaryEntry, 'workspaceFolder' | 'workspaceKey' | 'workspaceLabel' | 'workspaceUri'>;

const UNKNOWN_WORKSPACE: WorkspaceInfo = {
    workspaceFolder: null,
    workspaceKey: 'unknown',
    workspaceLabel: 'Unknown project',
    workspaceUri: null,
};

const decoder = new TextDecoder();

const pathExists = async (target: string): Promise<boolean> => {
    try {
        await stat(target);
        return true;
    } catch {
        return false;
    }
};

const readVarint = (buffer: Uint8Array, start: number, end: number): { next: number; value: number } => {
    let value = 0;
    let multiplier = 1;

    for (let index = start; index < end; index += 1) {
        const byte = buffer[index]!;
        value += (byte & 0x7f) * multiplier;
        if ((byte & 0x80) === 0) {
            return { next: index + 1, value };
        }
        multiplier *= 0x80;
    }

    throw new Error('Unterminated protobuf varint');
};

const parseProtoFields = (buffer: Uint8Array, start = 0, end = buffer.length): ProtoField[] => {
    const fields: ProtoField[] = [];
    let index = start;

    while (index < end) {
        const key = readVarint(buffer, index, end);
        index = key.next;
        const fieldNumber = key.value >> 3;
        const wireType = key.value & 7;
        if (fieldNumber <= 0) {
            throw new Error(`Invalid protobuf field number: ${fieldNumber}`);
        }

        if (wireType === 0) {
            const fieldValue = readVarint(buffer, index, end);
            index = fieldValue.next;
            fields.push({ fieldNumber, value: fieldValue.value, wireType });
            continue;
        }

        if (wireType === 1) {
            index += 8;
            fields.push({ fieldNumber, wireType });
            continue;
        }

        if (wireType === 2) {
            const length = readVarint(buffer, index, end);
            index = length.next;
            const next = index + length.value;
            if (next > end) {
                throw new Error('Invalid protobuf length-delimited field');
            }
            fields.push({ bytes: buffer.slice(index, next), fieldNumber, wireType });
            index = next;
            continue;
        }

        if (wireType === 5) {
            index += 4;
            fields.push({ fieldNumber, wireType });
            continue;
        }

        throw new Error(`Unsupported protobuf wire type: ${wireType}`);
    }

    return fields;
};

const firstField = (fields: ProtoField[], fieldNumber: number): ProtoField | null =>
    fields.find((field) => field.fieldNumber === fieldNumber) ?? null;

const fieldString = (fields: ProtoField[], fieldNumber: number): string | null => {
    const field = firstField(fields, fieldNumber);
    if (!field?.bytes) {
        return null;
    }

    return decoder.decode(field.bytes);
};

const fieldNumberValue = (fields: ProtoField[], fieldNumber: number): number | null => {
    return firstField(fields, fieldNumber)?.value ?? null;
};

const nestedFields = (field: ProtoField | null): ProtoField[] => {
    if (!field?.bytes) {
        return [];
    }

    return parseProtoFields(field.bytes);
};

const parseTimestampMs = (field: ProtoField | null): number | null => {
    const fields = nestedFields(field);
    const seconds = fieldNumberValue(fields, 1);
    if (seconds === null) {
        return null;
    }

    const nanos = fieldNumberValue(fields, 2) ?? 0;
    return seconds * 1000 + Math.floor(nanos / 1_000_000);
};

const cleanTitle = (value: string | null, fallback: string): string => {
    const title = value?.replace(/\s+/g, ' ').trim();
    if (!title) {
        return fallback;
    }

    return title.length > 180 ? `${title.slice(0, 177)}...` : title;
};

const decodeFileUri = (value: string): string => {
    if (!value.startsWith('file://')) {
        return value;
    }

    try {
        return decodeURIComponent(new URL(value).pathname);
    } catch {
        return decodeURIComponent(value.slice('file://'.length));
    }
};

const normalizeWorkspaceFolder = (value: string): string => {
    const decoded = decodeFileUri(value.trim());
    return decoded.replace(/\/+$/u, '') || decoded;
};

const workspaceFromFolder = (folderValue: string | null): WorkspaceInfo | null => {
    if (!folderValue) {
        return null;
    }

    const folder = normalizeWorkspaceFolder(folderValue);
    if (!folder) {
        return null;
    }

    return {
        workspaceFolder: folder,
        workspaceKey: `folder:${folder}`,
        workspaceLabel: path.basename(folder) || folder,
        workspaceUri: null,
    };
};

const workspaceFromUri = (uri: string | null): WorkspaceInfo | null => {
    if (!uri) {
        return null;
    }

    const workspace = workspaceFromFolder(uri);
    if (!workspace) {
        return null;
    }

    return {
        ...workspace,
        workspaceUri: uri,
    };
};

const parseWorkspaceInfo = (field: ProtoField | null): WorkspaceInfo | null => {
    const fields = nestedFields(field);
    const uri = fieldString(fields, 1) ?? fieldString(fields, 2);
    return workspaceFromUri(uri);
};

const parseContextWorkspaceInfo = (field: ProtoField | null): WorkspaceInfo | null => {
    const fields = nestedFields(field);
    const directUri = fieldString(fields, 7);
    if (directUri) {
        return workspaceFromUri(directUri);
    }

    const nestedWorkspace = firstField(fields, 1);
    return parseWorkspaceInfo(nestedWorkspace);
};

const parseSummaryEntry = (entryField: ProtoField, summaryPath: string): SummaryEntry | null => {
    try {
        const entryFields = nestedFields(entryField);
        const conversationId = fieldString(entryFields, 1);
        const summaryBytes = firstField(entryFields, 2);
        if (!conversationId || !summaryBytes) {
            return null;
        }

        const summaryFields = nestedFields(summaryBytes);
        const workspace =
            parseWorkspaceInfo(firstField(summaryFields, 9)) ??
            parseContextWorkspaceInfo(firstField(summaryFields, 17)) ??
            UNKNOWN_WORKSPACE;

        return {
            ...workspace,
            conversationId,
            createdAtMs: parseTimestampMs(firstField(summaryFields, 7)),
            indexedItemCount: fieldNumberValue(summaryFields, 2),
            lastUpdatedAtMs: parseTimestampMs(firstField(summaryFields, 3)),
            summaryPath,
            title: cleanTitle(fieldString(summaryFields, 1), conversationId),
        };
    } catch {
        return null;
    }
};

export const readAntigravitySummaryIndex = async (summaryPath: string): Promise<SummaryEntry[]> => {
    if (!(await pathExists(summaryPath))) {
        return [];
    }

    try {
        const buffer = new Uint8Array(await Bun.file(summaryPath).arrayBuffer());
        return parseProtoFields(buffer)
            .filter((field) => field.fieldNumber === 1)
            .map((field) => parseSummaryEntry(field, summaryPath))
            .filter((entry): entry is SummaryEntry => entry !== null);
    } catch {
        return [];
    }
};

const preferConversationFile = (
    current: ConversationFile | undefined,
    candidate: ConversationFile,
): ConversationFile => {
    if (!current) {
        return candidate;
    }

    if (candidate.mtimeMs !== current.mtimeMs) {
        return candidate.mtimeMs > current.mtimeMs ? candidate : current;
    }

    return candidate.bytes > current.bytes ? candidate : current;
};

const readConversationFiles = async (roots: string[]): Promise<Map<string, ConversationFile>> => {
    const files = new Map<string, ConversationFile>();
    for (const root of roots) {
        const conversationDir = getAntigravityConversationDir(root);
        let entries: Array<{ isFile: () => boolean; name: string }> = [];
        try {
            entries = await readdir(conversationDir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.pb')) {
                continue;
            }

            const conversationId = entry.name.slice(0, -'.pb'.length);
            const filePath = path.join(conversationDir, entry.name);
            const info = await stat(filePath);
            const candidate = {
                bytes: info.size,
                mtimeMs: info.mtimeMs,
                path: filePath,
                root,
            };
            files.set(conversationId, preferConversationFile(files.get(conversationId), candidate));
        }
    }

    return files;
};

const readArtifactMetadata = async (
    markdownPath: string,
): Promise<{ artifactType: string | null; summary: string | null; updatedAtMs: number | null }> => {
    try {
        const data = (await Bun.file(`${markdownPath}.metadata.json`).json()) as {
            artifactType?: unknown;
            summary?: unknown;
            updatedAt?: unknown;
        };
        const updatedAt = typeof data.updatedAt === 'string' ? Date.parse(data.updatedAt) : Number.NaN;
        return {
            artifactType: typeof data.artifactType === 'string' ? data.artifactType : null,
            summary: typeof data.summary === 'string' ? data.summary : null,
            updatedAtMs: Number.isFinite(updatedAt) ? updatedAt : null,
        };
    } catch {
        return { artifactType: null, summary: null, updatedAtMs: null };
    }
};

const readArtifactsForRoot = async (root: string): Promise<Map<string, AntigravityArtifact[]>> => {
    const brainDir = getAntigravityBrainDir(root);
    let entries: Array<{ isDirectory: () => boolean; name: string }> = [];
    try {
        entries = await readdir(brainDir, { withFileTypes: true });
    } catch {
        return new Map();
    }

    const artifactsByConversation = new Map<string, AntigravityArtifact[]>();
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const artifactDir = path.join(brainDir, entry.name);
        const files = await readdir(artifactDir, { withFileTypes: true }).catch(() => []);
        for (const file of files) {
            if (!file.isFile() || !file.name.endsWith('.md')) {
                continue;
            }

            const artifactPath = path.join(artifactDir, file.name);
            const [info, metadata] = await Promise.all([stat(artifactPath), readArtifactMetadata(artifactPath)]);
            const list = artifactsByConversation.get(entry.name) ?? [];
            list.push({
                artifactType: metadata.artifactType,
                bytes: info.size,
                name: file.name,
                path: artifactPath,
                sourceRoot: root,
                summary: metadata.summary,
                updatedAtMs: metadata.updatedAtMs ?? info.mtimeMs,
            });
            artifactsByConversation.set(entry.name, list);
        }
    }

    return artifactsByConversation;
};

const mergeArtifactMaps = async (roots: string[]): Promise<Map<string, AntigravityArtifact[]>> => {
    const merged = new Map<string, AntigravityArtifact[]>();
    for (const root of roots) {
        const artifacts = await readArtifactsForRoot(root);
        for (const [conversationId, list] of artifacts) {
            const existing = merged.get(conversationId) ?? [];
            const byName = new Map(existing.map((artifact) => [artifact.name, artifact]));
            for (const artifact of list) {
                if (!byName.has(artifact.name)) {
                    byName.set(artifact.name, artifact);
                }
            }
            merged.set(
                conversationId,
                [...byName.values()].sort(
                    (a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0) || a.name.localeCompare(b.name),
                ),
            );
        }
    }

    return merged;
};

const countJsonlEntries = async (filePath: string): Promise<number> => {
    try {
        const text = await Bun.file(filePath).text();
        return text.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
    } catch {
        return 0;
    }
};

const preferTranscriptFile = (current: TranscriptFile | undefined, candidate: TranscriptFile): TranscriptFile => {
    if (!current) {
        return candidate;
    }

    if (candidate.mtimeMs !== current.mtimeMs) {
        return candidate.mtimeMs > current.mtimeMs ? candidate : current;
    }

    if (candidate.source !== current.source) {
        return candidate.source === 'overview' ? candidate : current;
    }

    return candidate.entryCount > current.entryCount ? candidate : current;
};

const readTranscriptFilesForRoot = async (root: string): Promise<Map<string, TranscriptFile>> => {
    const brainDir = getAntigravityBrainDir(root);
    let entries: Array<{ isDirectory: () => boolean; name: string }> = [];
    try {
        entries = await readdir(brainDir, { withFileTypes: true });
    } catch {
        return new Map();
    }

    const transcripts = new Map<string, TranscriptFile>();
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const logsDir = path.join(brainDir, entry.name, '.system_generated', 'logs');
        for (const candidate of [
            { name: 'overview.txt', source: 'overview' as const },
            { name: 'transcript.jsonl', source: 'transcript' as const },
        ]) {
            const transcriptPath = path.join(logsDir, candidate.name);
            try {
                const info = await stat(transcriptPath);
                if (!info.isFile()) {
                    continue;
                }

                transcripts.set(
                    entry.name,
                    preferTranscriptFile(transcripts.get(entry.name), {
                        bytes: info.size,
                        entryCount: await countJsonlEntries(transcriptPath),
                        mtimeMs: info.mtimeMs,
                        path: transcriptPath,
                        root,
                        source: candidate.source,
                    }),
                );
            } catch {}
        }
    }

    return transcripts;
};

const mergeTranscriptMaps = async (roots: string[]): Promise<Map<string, TranscriptFile>> => {
    const merged = new Map<string, TranscriptFile>();
    for (const root of roots) {
        const transcripts = await readTranscriptFilesForRoot(root);
        for (const [conversationId, transcript] of transcripts) {
            merged.set(conversationId, preferTranscriptFile(merged.get(conversationId), transcript));
        }
    }

    return merged;
};

const readSummaryEntries = async (roots: string[]): Promise<Map<string, SummaryEntry>> => {
    const summaries = new Map<string, SummaryEntry>();
    for (const root of roots) {
        for (const entry of await readAntigravitySummaryIndex(getAntigravitySummaryIndexPath(root))) {
            const existing = summaries.get(entry.conversationId);
            if (!existing || (entry.lastUpdatedAtMs ?? 0) > (existing.lastUpdatedAtMs ?? 0)) {
                summaries.set(entry.conversationId, entry);
            }
        }
    }

    return summaries;
};

const maxArtifactUpdatedAt = (artifacts: AntigravityArtifact[]): number | null => {
    const value = Math.max(0, ...artifacts.map((artifact) => artifact.updatedAtMs ?? 0));
    return value > 0 ? value : null;
};

const resolveConversationSourceRoot = (
    file: ConversationFile | undefined,
    transcript: TranscriptFile | undefined,
    artifacts: AntigravityArtifact[],
) => {
    return file?.root ?? transcript?.root ?? artifacts[0]?.sourceRoot ?? null;
};

const resolveConversationWorkspace = (
    summary: SummaryEntry | undefined,
    file: ConversationFile | undefined,
    transcript: TranscriptFile | undefined,
    artifacts: AntigravityArtifact[],
): WorkspaceInfo => {
    return (
        summary ?? workspaceFromFolder(resolveConversationSourceRoot(file, transcript, artifacts)) ?? UNKNOWN_WORKSPACE
    );
};

const resolveConversationTranscriptSource = (
    file: ConversationFile | undefined,
    transcript: TranscriptFile | undefined,
) => {
    return transcript?.source ?? (file?.path ? 'safe-storage' : null);
};

const resolveConversationLastUpdatedAt = (
    artifacts: AntigravityArtifact[],
    file: ConversationFile | undefined,
    summary: SummaryEntry | undefined,
    transcript: TranscriptFile | undefined,
) => {
    return summary?.lastUpdatedAtMs ?? transcript?.mtimeMs ?? file?.mtimeMs ?? maxArtifactUpdatedAt(artifacts);
};

const toConversation = (
    conversationId: string,
    summary: SummaryEntry | undefined,
    file: ConversationFile | undefined,
    artifacts: AntigravityArtifact[],
    transcript: TranscriptFile | undefined,
): AntigravityConversation => {
    const fallbackTitle = artifacts[0]?.summary ?? conversationId;
    const artifactBytes = artifacts.reduce((total, artifact) => total + artifact.bytes, 0);
    const workspace = resolveConversationWorkspace(summary, file, transcript, artifacts);
    const lastUpdatedAtMs = resolveConversationLastUpdatedAt(artifacts, file, summary, transcript);
    const sourceRoot = resolveConversationSourceRoot(file, transcript, artifacts);

    return {
        artifactBytes,
        artifactCount: artifacts.length,
        artifacts,
        conversationBytes: file?.bytes ?? 0,
        conversationId,
        conversationMtimeMs: file?.mtimeMs ?? null,
        conversationPath: file?.path ?? null,
        createdAtMs: summary?.createdAtMs ?? null,
        indexedItemCount: summary?.indexedItemCount ?? null,
        lastUpdatedAtMs,
        sourceRoot,
        summaryPath: summary?.summaryPath ?? null,
        title: summary?.title ?? cleanTitle(fallbackTitle, conversationId),
        transcriptBytes: transcript?.bytes ?? 0,
        transcriptEntryCount: transcript?.entryCount ?? 0,
        transcriptPath: transcript?.path ?? null,
        transcriptSource: resolveConversationTranscriptSource(file, transcript),
        workspaceFolder: workspace.workspaceFolder,
        workspaceKey: workspace.workspaceKey,
        workspaceLabel: workspace.workspaceLabel,
        workspaceUri: workspace.workspaceUri,
    };
};

export const listAntigravityConversations = async (
    roots = resolveAntigravityRoots(),
): Promise<AntigravityConversation[]> => {
    const [summaries, conversationFiles, artifacts, transcripts] = await Promise.all([
        readSummaryEntries(roots),
        readConversationFiles(roots),
        mergeArtifactMaps(roots),
        mergeTranscriptMaps(roots),
    ]);

    const ids = new Set<string>([
        ...summaries.keys(),
        ...conversationFiles.keys(),
        ...artifacts.keys(),
        ...transcripts.keys(),
    ]);
    return [...ids]
        .map((conversationId) =>
            toConversation(
                conversationId,
                summaries.get(conversationId),
                conversationFiles.get(conversationId),
                artifacts.get(conversationId) ?? [],
                transcripts.get(conversationId),
            ),
        )
        .sort((a, b) => (b.lastUpdatedAtMs ?? 0) - (a.lastUpdatedAtMs ?? 0) || a.title.localeCompare(b.title));
};

export const groupAntigravityConversations = (
    conversations: AntigravityConversation[],
): AntigravityWorkspaceGroup[] => {
    const groups = new Map<string, AntigravityWorkspaceGroup>();
    for (const conversation of conversations) {
        const current = groups.get(conversation.workspaceKey) ?? {
            artifactCount: 0,
            conversationBytes: 0,
            conversationCount: 0,
            key: conversation.workspaceKey,
            label: conversation.workspaceLabel,
            lastActiveMs: 0,
            transcriptCount: 0,
            uri: conversation.workspaceUri,
        };
        current.artifactCount += conversation.artifactCount;
        current.conversationBytes += conversation.conversationBytes;
        current.conversationCount += 1;
        current.lastActiveMs = Math.max(current.lastActiveMs, conversation.lastUpdatedAtMs ?? 0);
        current.transcriptCount += conversation.transcriptEntryCount > 0 ? 1 : 0;
        groups.set(conversation.workspaceKey, current);
    }

    return [...groups.values()].sort((a, b) => b.lastActiveMs - a.lastActiveMs || a.label.localeCompare(b.label));
};

export const listAntigravityWorkspaceGroups = async (
    roots = resolveAntigravityRoots(),
): Promise<AntigravityWorkspaceGroup[]> => {
    return groupAntigravityConversations(await listAntigravityConversations(roots));
};

export const listAntigravityConversationsForGroup = async (
    workspaceKey: string,
    roots = resolveAntigravityRoots(),
): Promise<AntigravityConversation[]> => {
    return (await listAntigravityConversations(roots)).filter(
        (conversation) => conversation.workspaceKey === workspaceKey,
    );
};

export const renderAntigravityArtifactsMarkdown = async (
    conversation: AntigravityConversation,
): Promise<string | null> => {
    if (conversation.artifacts.length === 0) {
        return null;
    }

    const parts = [
        `# ${conversation.title}`,
        '',
        '- exported_from: `antigravity_brain_artifacts`',
        `- conversation_id: \`${conversation.conversationId}\``,
        conversation.workspaceUri ? `- workspace: \`${conversation.workspaceUri}\`` : '',
        '',
    ].filter(Boolean);

    for (const artifact of conversation.artifacts) {
        const body = await Bun.file(artifact.path).text();
        parts.push(`## ${artifact.name}`, '');
        if (artifact.summary) {
            parts.push(`_${artifact.summary}_`, '');
        }
        parts.push(body.trimEnd(), '');
    }

    return `${parts.join('\n').trimEnd()}\n`;
};

type AntigravityLogEntry = {
    content?: unknown;
    created_at?: unknown;
    source?: unknown;
    status?: unknown;
    step_index?: unknown;
    thinking?: unknown;
    tool_calls?: unknown;
    type?: unknown;
};

const parseLogEntries = (content: string): AntigravityLogEntry[] => {
    return content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line) as AntigravityLogEntry;
            } catch {
                return null;
            }
        })
        .filter((entry): entry is AntigravityLogEntry => entry !== null);
};

const getString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const stripTaggedBlock = (content: string, tag: string): string => {
    return content.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gu'), '').trim();
};

const extractTaggedBlock = (content: string, tag: string): string | null => {
    const match = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'u').exec(content);
    return match?.[1]?.trim() || null;
};

const cleanLogContent = (entry: AntigravityLogEntry): string => {
    const content = getString(entry.content);
    if (!content) {
        return '';
    }

    const userRequest = extractTaggedBlock(content, 'USER_REQUEST');
    if (userRequest) {
        return userRequest;
    }

    return ['ADDITIONAL_METADATA', 'USER_SETTINGS_CHANGE']
        .reduce((current, tag) => stripTaggedBlock(current, tag), content)
        .replace(/<\/?USER_REQUEST>/gu, '')
        .trim();
};

const logEntryHeading = (entry: AntigravityLogEntry): string => {
    const source = getString(entry.source);
    const type = getString(entry.type);
    if (source?.startsWith('USER')) {
        return 'User';
    }

    if (source === 'MODEL') {
        return 'Assistant';
    }

    if (source === 'SYSTEM') {
        return 'System';
    }

    return type ? `Tool: ${type}` : 'Event';
};

const renderToolCalls = (toolCalls: unknown): string[] => {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        return [];
    }

    const parts = ['### Tool Calls', ''];
    for (const call of toolCalls) {
        if (!call || typeof call !== 'object') {
            continue;
        }

        const { args, name } = call as { args?: unknown; name?: unknown };
        parts.push(`- \`${typeof name === 'string' ? name : 'unknown'}\``);
        if (args !== undefined) {
            parts.push('', '```json', JSON.stringify(args, null, 2), '```', '');
        }
    }

    return parts;
};

const renderLogEntry = (entry: AntigravityLogEntry): string[] => {
    const heading = logEntryHeading(entry);
    const timestamp = getString(entry.created_at);
    const content = cleanLogContent(entry);
    const thinking = getString(entry.thinking);
    const parts = [`## ${heading}`, ''];

    if (timestamp) {
        parts.push(`_Timestamp: ${timestamp}_`, '');
    }

    if (thinking) {
        parts.push('### Thinking', '', thinking.trim(), '');
    }

    if (content) {
        parts.push(content, '');
    }

    parts.push(...renderToolCalls(entry.tool_calls));
    return parts;
};

const renderAntigravityTranscriptMarkdown = async (conversation: AntigravityConversation): Promise<string | null> => {
    if (!conversation.transcriptPath || !conversation.transcriptSource) {
        return null;
    }

    const entries = parseLogEntries(await Bun.file(conversation.transcriptPath).text());
    if (entries.length === 0) {
        return null;
    }

    const exportedFrom =
        conversation.transcriptSource === 'overview'
            ? 'antigravity_overview_transcript'
            : 'antigravity_jsonl_transcript';
    const parts = [
        `# ${conversation.title}`,
        '',
        `- exported_from: \`${exportedFrom}\``,
        `- conversation_id: \`${conversation.conversationId}\``,
        conversation.workspaceUri ? `- workspace: \`${conversation.workspaceUri}\`` : '',
        '',
    ].filter(Boolean);

    for (const entry of entries) {
        parts.push(...renderLogEntry(entry));
    }

    return `${parts.join('\n').trimEnd()}\n`;
};

const renderDecryptedSafeStorageMarkdown = (conversation: AntigravityConversation, content: string): string | null => {
    const trimmed = content.trim();
    if (!trimmed) {
        return null;
    }

    return [
        `# ${conversation.title}`,
        '',
        '- exported_from: `antigravity_safe_storage_payload`',
        `- conversation_id: \`${conversation.conversationId}\``,
        conversation.workspaceUri ? `- workspace: \`${conversation.workspaceUri}\`` : '',
        '',
        trimmed,
        '',
    ]
        .filter(Boolean)
        .join('\n');
};

export const renderAntigravityConversationMarkdown = async (
    conversation: AntigravityConversation,
    options: { keychainSecret?: string | null } = {},
): Promise<string | null> => {
    const transcript = await renderAntigravityTranscriptMarkdown(conversation);
    if (transcript) {
        return transcript;
    }

    if (options.keychainSecret && conversation.conversationPath) {
        const encrypted = Buffer.from(await Bun.file(conversation.conversationPath).arrayBuffer());
        const decrypted = decryptAntigravitySafeStoragePayload(encrypted, options.keychainSecret);
        if (decrypted) {
            return renderDecryptedSafeStorageMarkdown(conversation, decrypted);
        }
    }

    return null;
};
