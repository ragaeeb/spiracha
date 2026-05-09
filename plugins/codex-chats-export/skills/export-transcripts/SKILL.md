---
name: export-transcripts
description: Export local Codex chats and Claude transcripts using the plugin MCP tools.
---

# Export Transcripts

Use the plugin MCP tools instead of shelling out manually when the user wants to export Codex chats or Claude Code transcripts.

## When to use

- The user provides one or more Codex deeplinks and wants specific chats exported.
- The user wants Codex chats filtered by project name or exact cwd.
- The user wants a Claude Code `.jsonl` export or export directory converted to markdown or plain text.

## Workflow

1. For Codex exports, call `export_codex_chats`.
2. Always scope Codex exports with at least one of:
   - `deeplinks`
   - `project`
   - `cwd`
3. Map user intent to tool inputs:
   - command/tool logs requested: `includeTools: true`
   - plain text requested: `outputFormat: "txt"`
   - markdown requested or unspecified: `outputFormat: "md"`
   - compact export requested: `optimized: true`
   - flat export requested: `flat: true`
4. For Claude exports, call `export_claude_transcript` with:
   - `inputPath`
   - optional `outputPath`
   - `outputFormat`
   - `includeTools`
5. Report the exported paths back to the user. If Codex exports return `missingThreadIds`, include them explicitly.

## Notes

- `project` matches the basename of the chat cwd, not the full path.
- `cwd` is an exact path match and may use `~`.
- The Codex export tool refuses unscoped full-history exports by design.
