import path from 'node:path';

const SOURCE_PATHS = {
    CODEX_BIN: 'missing-codex-cli',
    CODEX_HOME: '.codex',
    SPIRACHA_ANTIGRAVITY_DIRS: 'antigravity',
    SPIRACHA_CLAUDE_CODE_PROJECTS_DIR: 'claude-projects',
    SPIRACHA_CLINE_DATA_DIR: 'cline',
    SPIRACHA_CODEX_AUTH: 'missing-auth.json',
    SPIRACHA_CODEX_DB: 'state.sqlite',
    SPIRACHA_COMMAND_CODE_PROJECTS_DIR: 'command-code-projects',
    SPIRACHA_CURSOR_PROJECTS_DIR: 'cursor-projects',
    SPIRACHA_CURSOR_USER_DIR: 'cursor-user',
    SPIRACHA_FX_DATA_DIR: 'fx',
    SPIRACHA_GROK_BOT_PERSISTENCE_DIR: 'grok-bot',
    SPIRACHA_GROK_SESSIONS_DIR: 'grok-sessions',
    SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR: 'kiro-sessions',
    SPIRACHA_MINIMAX_CODE_RUNTIME_DB_PATH: 'minimax/runtime.sqlite',
    SPIRACHA_MINIMAX_CODE_SESSIONS_DIR: 'minimax/sessions',
    SPIRACHA_OPENCODE_DB: 'opencode.sqlite',
    SPIRACHA_OPENCODE_DESKTOP_STATE_DIR: 'opencode-desktop',
    SPIRACHA_QODER_CLI_PROJECTS_DIR: 'qoder-projects',
    SPIRACHA_QODER_GLOBAL_STATE_DB: 'qoder.sqlite',
    SPIRACHA_QODER_SOCKET_PATH: 'missing-qoder.sock',
    SPIRACHA_QODER_WORKSPACE_STORAGE_DIR: 'qoder-workspaces',
    SPIRACHA_UI_CACHE_DIR: 'ui-cache',
    SPIRACHA_UI_EXPORT_DIR: 'ui-exports',
} as const;

export const buildIsolatedRuntimeEnv = (environment: NodeJS.ProcessEnv, root: string): NodeJS.ProcessEnv => {
    if (!path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) {
        throw new Error('An isolated test runtime requires an absolute, non-root fixture directory.');
    }
    const isolated: NodeJS.ProcessEnv = {
        APPDATA: path.join(root, 'appdata'),
        BUN_INSTALL_CACHE_DIR: path.join(root, 'bun-cache'),
        HOME: root,
        LOCALAPPDATA: path.join(root, 'localappdata'),
        TEMP: root,
        TMP: root,
        TMPDIR: root,
        USERPROFILE: root,
        XDG_CACHE_HOME: path.join(root, 'cache'),
        XDG_CONFIG_HOME: path.join(root, 'config'),
        XDG_DATA_HOME: path.join(root, 'data'),
    };
    for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT']) {
        if (environment[key] !== undefined) isolated[key] = environment[key];
    }
    for (const [key, relative] of Object.entries(SOURCE_PATHS)) {
        isolated[key] = path.join(root, relative);
    }
    return isolated;
};
