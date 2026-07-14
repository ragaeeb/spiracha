import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export type OpenCodeFixturePart = {
    data: Record<string, unknown>;
    id: string;
    timeCreated?: number;
    timeUpdated?: number;
};

export type OpenCodeFixtureMessage = {
    id: string;
    parts: OpenCodeFixturePart[];
    role: 'assistant' | 'user';
    timeCreated?: number;
    timeUpdated?: number;
};

export type OpenCodeFixtureSession = {
    agent?: string | null;
    cost?: number;
    directory?: string;
    id: string;
    messages: OpenCodeFixtureMessage[];
    model?: Record<string, unknown> | string | null;
    parentId?: string | null;
    path?: string | null;
    permission?: string | null;
    projectId: string;
    slug?: string;
    summaryAdditions?: number | null;
    summaryDeletions?: number | null;
    summaryFiles?: number | null;
    timeArchived?: number | null;
    timeCreated?: number;
    timeUpdated?: number;
    title: string;
    tokensCacheRead?: number;
    tokensCacheWrite?: number;
    tokensInput?: number;
    tokensOutput?: number;
    tokensReasoning?: number;
};

export type OpenCodeFixtureProject = {
    id: string;
    name?: string | null;
    timeCreated?: number;
    timeUpdated?: number;
    worktree: string;
};

export type OpenCodeFixtureSpec = {
    projects: OpenCodeFixtureProject[];
    sessions: OpenCodeFixtureSession[];
};

const createOpenCodeTables = (db: Database) => {
    db.exec(`
        CREATE TABLE project (
            id TEXT PRIMARY KEY,
            worktree TEXT NOT NULL,
            vcs TEXT,
            name TEXT,
            icon_url TEXT,
            icon_color TEXT,
            time_created INTEGER NOT NULL,
            time_updated INTEGER NOT NULL,
            time_initialized INTEGER,
            sandboxes TEXT NOT NULL,
            commands TEXT,
            icon_url_override TEXT
        );

        CREATE TABLE session (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            parent_id TEXT,
            slug TEXT NOT NULL,
            directory TEXT NOT NULL,
            title TEXT NOT NULL,
            version TEXT NOT NULL,
            share_url TEXT,
            summary_additions INTEGER,
            summary_deletions INTEGER,
            summary_files INTEGER,
            summary_diffs TEXT,
            revert TEXT,
            permission TEXT,
            time_created INTEGER NOT NULL,
            time_updated INTEGER NOT NULL,
            time_compacting INTEGER,
            time_archived INTEGER,
            workspace_id TEXT,
            path TEXT,
            agent TEXT,
            model TEXT,
            cost REAL DEFAULT 0 NOT NULL,
            tokens_input INTEGER DEFAULT 0,
            tokens_output INTEGER DEFAULT 0,
            tokens_reasoning INTEGER DEFAULT 0,
            tokens_cache_read INTEGER DEFAULT 0,
            tokens_cache_write INTEGER DEFAULT 0,
            metadata TEXT
        );

        CREATE TABLE message (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            time_created INTEGER NOT NULL,
            time_updated INTEGER NOT NULL,
            data TEXT NOT NULL
        );

        CREATE TABLE part (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            time_created INTEGER NOT NULL,
            time_updated INTEGER NOT NULL,
            data TEXT NOT NULL
        );
    `);
};

const insertProject = (db: Database, project: OpenCodeFixtureProject) => {
    db.run(
        `INSERT INTO project (
            id, worktree, vcs, name, icon_url, icon_color, time_created, time_updated,
            time_initialized, sandboxes, commands, icon_url_override
        ) VALUES (?, ?, NULL, ?, NULL, NULL, ?, ?, NULL, ?, NULL, NULL)`,
        [
            project.id,
            project.worktree,
            project.name ?? null,
            project.timeCreated ?? 1_700_000_000_000,
            project.timeUpdated ?? 1_700_000_000_000,
            JSON.stringify([]),
        ],
    );
};

const stringifyModel = (model: OpenCodeFixtureSession['model']): string | null => {
    if (model === undefined || model === null) {
        return null;
    }

    return typeof model === 'string' ? model : JSON.stringify(model);
};

const insertSession = (
    db: Database,
    {
        agent = null,
        cost = 0,
        directory = '/Users/test/workspace/demo',
        id,
        model = null,
        parentId = null,
        path: sessionPath = null,
        permission = null,
        projectId,
        slug = id,
        summaryAdditions = null,
        summaryDeletions = null,
        summaryFiles = null,
        timeArchived = null,
        timeCreated = 1_700_000_000_000,
        timeUpdated = 1_700_000_100_000,
        title,
        tokensCacheRead = 0,
        tokensCacheWrite = 0,
        tokensInput = 0,
        tokensOutput = 0,
        tokensReasoning = 0,
    }: OpenCodeFixtureSession,
) => {
    db.run(
        `INSERT INTO session (
            id, project_id, parent_id, slug, directory, title, version, share_url,
            summary_additions, summary_deletions, summary_files, summary_diffs, revert,
            permission, time_created, time_updated, time_compacting, time_archived,
            workspace_id, path, agent, model, cost, tokens_input, tokens_output,
            tokens_reasoning, tokens_cache_read, tokens_cache_write, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
            id,
            projectId,
            parentId,
            slug,
            directory,
            title,
            'fixture',
            summaryAdditions,
            summaryDeletions,
            summaryFiles,
            permission,
            timeCreated,
            timeUpdated,
            timeArchived,
            sessionPath,
            agent,
            stringifyModel(model),
            cost,
            tokensInput,
            tokensOutput,
            tokensReasoning,
            tokensCacheRead,
            tokensCacheWrite,
        ],
    );
};

const insertMessage = (db: Database, sessionId: string, message: OpenCodeFixtureMessage) => {
    db.run('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)', [
        message.id,
        sessionId,
        message.timeCreated ?? 1_700_000_000_000,
        message.timeUpdated ?? 1_700_000_000_000,
        JSON.stringify({ role: message.role }),
    ]);

    for (const part of message.parts) {
        db.run(
            'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
            [
                part.id,
                message.id,
                sessionId,
                part.timeCreated ?? message.timeCreated ?? 1_700_000_000_000,
                part.timeUpdated ?? part.timeCreated ?? message.timeUpdated ?? 1_700_000_000_000,
                JSON.stringify(part.data),
            ],
        );
    }
};

export const createOpenCodeFixture = async (dbPath: string, spec: OpenCodeFixtureSpec): Promise<void> => {
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    try {
        createOpenCodeTables(db);
        for (const project of spec.projects) {
            insertProject(db, project);
        }
        for (const session of spec.sessions) {
            insertSession(db, session);
            for (const message of session.messages) {
                insertMessage(db, session.id, message);
            }
        }
    } finally {
        db.close();
    }
};
