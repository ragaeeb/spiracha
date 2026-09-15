# Configuration and lifecycle reference

Precedence below is left to right: the first non-empty configured value wins.
Defaults describe this source snapshot, not a guarantee that a source app is
installed. A path override points at that app's storage; it does not import or
copy the data. Use absolute paths to avoid working-directory surprises.

## Source paths

| Source | Resolution and derived paths |
| --- | --- |
| Claude Code | `SPIRACHA_CLAUDE_CODE_PROJECTS_DIR` directly; otherwise append `projects` to `SPIRACHA_CLAUDE_CODE_DATA_DIR` > `SPIRACHA_CLAUDE_CODE_DIR` > `SPIRACHA_CLAUDE_HOME` > `~/.claude`. |
| Cline | `SPIRACHA_CLINE_DATA_DIR` > `~/.cline/data`. |
| Command Code | `SPIRACHA_COMMAND_CODE_PROJECTS_DIR`; otherwise `projects` under `SPIRACHA_COMMAND_CODE_DIR` > `~/.commandcode`. |
| Grok | `SPIRACHA_GROK_SESSIONS_DIR`; otherwise `sessions` under `SPIRACHA_GROK_HOME` > `SPIRACHA_GROK_DIR` > `~/.grok`. |
| Grok Bot | `SPIRACHA_GROK_BOT_PERSISTENCE_DIR` > `~/Library/Application Support/Grok Bot/sand-client-persistence`. |
| Kiro | `SPIRACHA_KIRO_WORKSPACE_SESSIONS_DIR`; otherwise `workspace-sessions` under `SPIRACHA_KIRO_DATA_DIR` > `SPIRACHA_KIRO_AGENT_DIR` > `SPIRACHA_KIRO_DIR` > `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent`. |
| Qoder | `SPIRACHA_QODER_USER_DIR` > `SPIRACHA_QODER_DATA_DIR` > `SPIRACHA_QODER_DIR` > `~/Library/Application Support/Qoder/User`. Direct overrides: `SPIRACHA_QODER_GLOBAL_STATE_DB`, `SPIRACHA_QODER_WORKSPACE_STORAGE_DIR`, `SPIRACHA_QODER_CLI_PROJECTS_DIR`. Default CLI projects are in sibling `SharedClientCache/cli/projects`. |
| Cursor | `SPIRACHA_CURSOR_USER_DIR`; otherwise macOS Application Support, Windows `APPDATA` (or home AppData/Roaming), or Linux `XDG_DATA_HOME` (or `~/.local/share`), followed by `Cursor/User`. `SPIRACHA_CURSOR_PROJECTS_DIR` separately controls agent project files. |
| Antigravity | `SPIRACHA_ANTIGRAVITY_DIRS` > `SPIRACHA_ANTIGRAVITY_DIR`; configured lists use the host's `path.delimiter` (`:` on POSIX, `;` on Windows). Defaults: `~/.gemini/antigravity-ide`, `antigravity-cli`, and `antigravity`. |
| FX | `SPIRACHA_FX_DATA_DIR` > `FX_DATA_DIR` > `~/.fx`. |
| MiniMax Code | `SPIRACHA_MINIMAX_CODE_DATA_DIR` > `SPIRACHA_MINIMAX_DATA_DIR` > `MINIMAX_DATA_DIR` > `~/.minimax`. Sessions override: `SPIRACHA_MINIMAX_CODE_SESSIONS_DIR`, otherwise `v2/sessions`. Runtime DB override: `SPIRACHA_MINIMAX_CODE_RUNTIME_DB_PATH`, otherwise `sqlite/runtime-state.sqlite` under the parent of the resolved sessions directory. |
| OpenCode | `SPIRACHA_OPENCODE_DATA_DIR` > `SPIRACHA_OPENCODE_DIR`; otherwise `opencode` under `XDG_DATA_HOME` > `~/.local/share`. `SPIRACHA_OPENCODE_DB` overrides the default `opencode.db`. |
| Codex | `SPIRACHA_CODEX_DB` overrides database discovery. The shared default is `~/.codex/state_5.sqlite`, with the resolver's additional `.codex/sqlite/state_5.sqlite` probe. Do not assume `CODEX_HOME` redirects this database resolver. |

Kiro, Qoder, and Grok Bot defaults above are macOS-shaped paths in the resolver,
not automatic discovery of those applications on every operating system.

Qoder's ACP socket uses `SPIRACHA_QODER_SOCKET_PATH` > `SPIRACHA_QODER_SOCKET`,
otherwise sibling `SharedClientCache/qoder.sock` relative to the resolved User
directory. OpenCode desktop state uses `SPIRACHA_OPENCODE_DESKTOP_STATE_DIR`;
without it, only macOS has the built-in `ai.opencode.desktop` default.

Codex authentication uses `SPIRACHA_CODEX_AUTH`, otherwise `auth.json` under
`CODEX_HOME` > `~/.codex`. `CODEX_BIN` chooses the refresh CLI (default `codex`).
These are authentication controls, not database-location aliases.

## Runtime controls

The packaged listener binds `127.0.0.1`. `PORT` defaults to `3000` and must be an
integer from 1 through 65535. Do not infer a `HOST` or remote-deployment option.
The development command separately pins its host and port in `package.json`.

The README lists lifecycle defaults: cache age 1 day / 256 MiB, temporary export
age 1 day / 1 GiB, and large-export threshold 128 MiB. Those counts use strict
non-negative safe-integer parsing; blank values use defaults. Zero is a real
zero budget, not an unlimited-retention sentinel. Cache bypass accepts `0` or `1`.

Successful UI cache reads refresh file mtime, so cache age is an **idle-age**
policy. Export retention uses file age. Pruning is opportunistically requested
during normal operations, not by a background daemon; limits are not an immediate
global disk quota. Active cache operations can defer removal. Bypass skips cache
reads and writes but does not erase previously retained files.

Temporary download URLs can expire after pruning or restart/cleanup. Copy a
downloaded export to your own durable storage; do not bookmark it as a backup.
Private directory checks do not encrypt cached content or export files.

| Control | Implementation behavior |
| --- | --- |
| `SPIRACHA_TRANSCRIPT_LOAD_CONCURRENCY` | Positive integer parsing, default 3, capped at 16 per integration. |
| Total transcript concurrency (derived, no separate environment override) | `min(32, max(16, perIntegration * 2))`. |
| `SPIRACHA_OPENCODE_DB_CONCURRENCY` | Positive integer parsing, default 2. |
| `SPIRACHA_ANALYTICS_TRANSCRIPT_CONCURRENCY` | Positive integer parsing, default 8. |
| `SPIRACHA_TRANSCRIPT_LOAD_LOGS` / `SPIRACHA_OPENCODE_DB_LOGS` | Only the exact string `1` enables timing logs. |

Unlike lifecycle counts, concurrency parsers fall back for invalid/non-positive
values and use integer parsing rather than uniform strict numeric validation.
Limiter instances capture configuration when constructed (global at module load,
source-specific lazily); restart after tuning. Increasing concurrency can raise
memory and descriptor pressure. Logs can contain identifiers, paths, and errors;
inspect them before sharing.

Resolver authority remains the matching source `*-types.ts`/`*-paths.ts` modules,
`runtime-config.ts`, `transcript-load-limiter.ts`, and `production-ui-server.ts`.
