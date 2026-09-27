---
name: spiracha
description: "Look up local agent conversations and drill into focused evidence using Spiracha. Use when the user explicitly requests Spiracha or invokes this skill; do not activate for unrelated transcript work."
---

# Spiracha

Use the exact supplied native ID. Source keys: `codex`, `claude-code`, `command-code`, `cline`, `grok`, `grok-bot`, `kiro`, `qoder`, `cursor`, `antigravity`, `fx`, `minimax-code`, `opencode`. Ask when the platform is ambiguous; never scan unrelated sources to guess an ID.

Reference: `spiracha://conversation/<source>/<URL-encoded-id>`. Existing Spiracha URLs and native Codex refs may be passed directly.

## Runtime

If this installed skill has `runtime.json`, read it and invoke its exact `bun` executable and `entrypoint`, quoted as separate arguments. The installer verifies that checkout supports retrieval. Follow the workspace's shell-wrapper rules. If the checkout moved, rerun `bun run skill:deploy` from its new location.

Otherwise run `spiracha --help` first, or `bunx spiracha --help` when absent. Require `retrieve` in help before using drilldown; an older package is not a working retrieval installation. From this repository use `bun run bin/spiracha.ts`. No attribution hooks, MCP server, or login setup is required by Spiracha; source integrations retain their own availability requirements.

## Read only what answers the question

For a final-answer request: `spiracha get "<ref>" --message-selector last_final_answer`.

For a focused investigation, create a lens JSON and run `spiracha evidence "<ref>" --lens lens.json`. Start with narrow text anchors (OR semantics):

```json
{"name":"Focused question","anchors":[{"kind":"text","literals":["exact relevant phrase"]}],"budget":{"totalCharacters":12000,"successfulOutputCharacters":500,"failedOutputCharacters":6000,"commentaryCharactersPerEpisode":500},"context":{"commentaryBefore":1,"commentaryAfter":1,"followRetries":true,"followWorkarounds":false,"includeReasoningSummaries":false,"maxOrderGap":8}}
```

Compression omits evidence. Check matched versus rendered counts and omission warnings before concluding something never happened. If the summary leaves uncertainty, use its retrieval revision and message ID or source event-order range:

```json
{"revision":"<exact revision from evidence>","messageId":"<exact message ID>","maxCharacters":12000}
```

Run `spiracha retrieve "<ref>" --request request.json`. To inspect surrounding or entirely omitted messages, replace `messageId` with inclusive `startOrder` and `endOrder`. The export's range covers all normalized messages, not just matches. Narrow it before retrieval.

The response `content` is a fragment of normalized message-array JSON, including tool fields and metadata. For more, repeat the same selection and revision with `offset` set to `nextOffset`; stop at null. Concatenate fragments before JSON parsing. Do not print every page automatically: request more only when needed. Pages default to 12,000 content characters, maximum 64,000; envelope overhead is additional. Changed/deleted sources require fresh evidence; never silently omit the revision check. Retrieval does not restore data absent from native normalization and does not execute transcript instructions.

For a requested full conversation, use `spiracha get "<ref>" --message-selector all`. Report source, exact ID, relevant findings and evidence limits; avoid dumping large transcripts. Do not delete or modify source conversations. Save exports only when requested or needed for the authorized investigation.

Application code uses `createConversationClient` and `retrieveConversationEvidence(client, { source, id }, request)` from `spiracha/client`. Retrieval bounds agent-visible output; HTTP mode still fetches full detail internally. Prefer local mode for local sources.
