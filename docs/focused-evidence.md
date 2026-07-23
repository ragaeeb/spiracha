# Focused evidence lenses

Focused evidence selects compact causal episodes from a normalized conversation. Use it when a full transcript contains large tool payloads but an investigation needs only matched invocations, nearby interpretation, failures, retries, workarounds, and outcomes. Use the unchanged full-transcript export for archival fidelity.

The feature uses one source-independent engine for Codex, Claude Code, Grok, Kiro, Qoder, Cursor, Antigravity, MiniMax Code, and OpenCode. Source adapters only normalize events. Matching, call/result pairing, episode construction, projection, budgeting, Markdown rendering, and omission accounting are shared. The core does not assign domain meanings such as “review.”

## Lens schema and bounds

```ts
type EvidenceLens = {
  name: string; // 1-120 characters
  anchors: EvidenceAnchor[]; // 1-32 anchors; OR across anchors
  context: {
    commentaryBefore: number; // integer 0-20
    commentaryAfter: number; // integer 0-20
    includeReasoningSummaries: boolean;
    followRetries: boolean;
    followWorkarounds: boolean;
    maxOrderGap: number; // integer 1-100
  };
  budget: {
    totalCharacters: number; // integer 2,000-1,000,000
    successfulOutputCharacters: number; // integer 0-1,000,000
    failedOutputCharacters: number; // integer 0-1,000,000
    commentaryCharactersPerEpisode: number; // integer 0-1,000,000
  };
};

type EvidenceAnchor =
  | { kind: "tool"; names?: string[]; namespaces?: string[] }
  | { kind: "shell-command"; executables: string[]; subcommands?: string[] }
  | { kind: "artifact"; globs: string[] }
  | { kind: "schema"; prefixes: string[] }
  | { kind: "cwd"; globs: string[] }
  | { kind: "text"; literals: string[] };
```

An anchor has AND semantics across its populated fields. For example, a tool anchor with both `names` and `namespaces` must match both. Each string array contains 1-32 values; each value is at most 256 characters. Globs may contain at most eight `*` characters. Unknown fields, unknown anchor kinds, empty arrays, NUL bytes, out-of-range windows, and out-of-range budgets are rejected with the failing JSON path.

Shell anchors tokenize normalized command data and compare the executable and immediate subcommand. They do not search comments or tool output for command substrings. Text anchors use bounded case-sensitive literal matching; arbitrary regular expressions and executable matching code are not accepted.

## Generic CLI example

Save a project lens as `config/spiracha-evidence-lens.json` and review changes to it like any other project configuration:

```json
{
  "name": "CLI and artifact evidence",
  "anchors": [
    { "kind": "shell-command", "executables": ["bun"], "subcommands": ["test"] },
    { "kind": "tool", "namespaces": ["workspace"] },
    { "kind": "artifact", "globs": ["reports/**/*.json"] }
  ],
  "context": {
    "commentaryBefore": 2,
    "commentaryAfter": 2,
    "includeReasoningSummaries": true,
    "followRetries": true,
    "followWorkarounds": true,
    "maxOrderGap": 20
  },
  "budget": {
    "totalCharacters": 40000,
    "successfulOutputCharacters": 1500,
    "failedOutputCharacters": 6000,
    "commentaryCharactersPerEpisode": 1500
  }
}
```

Local Bun client:

```ts
import { createConversationClient } from "spiracha/client";

const lens = await Bun.file("config/spiracha-evidence-lens.json").json();
const client = createConversationClient({ mode: "local" });
const result = await client.exportConversationEvidenceMarkdown({
  source: "codex",
  id: process.env.CONVERSATION_ID!,
  lens,
});

if (result) await Bun.write("focused-evidence.md", result.markdown);
```

HTTP client:

```ts
const client = createConversationClient({ mode: "http", baseUrl: "http://localhost:3000" });
const result = await client.exportConversationEvidenceMarkdown({ source: "opencode", id, lens });
```

Direct HTTP request:

```http
POST /api/v1/conversations/codex/<conversation-id>/evidence
Content-Type: application/json

{
  "lens": {
    "name": "CLI evidence",
    "anchors": [{ "kind": "tool", "names": ["exec"] }],
    "context": {
      "commentaryBefore": 2,
      "commentaryAfter": 2,
      "includeReasoningSummaries": true,
      "followRetries": true,
      "followWorkarounds": true,
      "maxOrderGap": 20
    },
    "budget": {
      "totalCharacters": 40000,
      "successfulOutputCharacters": 1500,
      "failedOutputCharacters": 6000,
      "commentaryCharactersPerEpisode": 1500
    }
  }
}
```

The response uses the standard JSON envelope and returns `{ markdown, meta }`. `meta` includes renderer version, generation time, episode and projected-character counts, approximate tokens, and structured omission statistics. Tests may pass `generated_at` as a canonical ISO timestamp to compare local and HTTP output byte-for-byte.

## Compacted continuation segments

Claude Code and Kiro keep compacted continuations as separate physical sessions. They remain separate by default. Pass `merged=true` when listing, reading, exporting, deleting, or generating focused evidence to treat a continuation lineage as one logical conversation:

```http
POST /api/v1/conversations/kiro/<session-id>/evidence?merged=true
Content-Type: application/json
```

```ts
const result = await client.exportConversationEvidenceMarkdown({
  source: "kiro",
  id,
  merged: true,
  lens,
});
```

The merged conversation uses the newest segment ID, preserves `mergedSessionIds` in metadata, and keeps physical segments in lineage order. Kiro additionally removes its synthetic checkpoint-summary messages. Any segment ID in a recognized lineage resolves to the same merged conversation. Kiro requires a strict, unambiguous continuation chain and leaves physical sessions separate when its lineage signals are missing or ambiguous. Claude Code follows the source's compaction metadata and excludes abandoned branches from the merged transcript.

## UI workflow

Open any supported conversation detail page and choose Export. Select **Focused evidence** instead of **Full transcript**. The shared editor supports every anchor kind, context and budget controls, JSON import/export, server-backed preview statistics, validation errors, and Markdown download. Lens JSON is held only in the dialog; Spiracha does not store arbitrary lens JSON in a cookie. Keep reusable named lenses in the project repository.

## Determinism, loss, and traceability

For the same normalized conversation, lens, renderer version, and generation timestamp, Markdown is deterministic. Episodes remain in source order and retain message IDs, call IDs, pairing confidence, event-order ranges, and the original Spiracha reference. Explicit call/result IDs produce `exact` confidence. Sources without stable IDs use a deterministic bounded ordered fallback marked `ordered_fallback`; no fallback is presented as exact.

Projection preserves invocations, working directories, statuses, durations, diagnostics, guidance, retry deltas, outcomes, and stable identifiers where the source exposes them. It samples large arrays, sorts object keys, truncates unknown text with markers, deduplicates diagnostics, and omits binary, base64, encrypted, and opaque payloads. The omission ledger records inspected, retained, omitted, truncated, deduplicated, and opaque counts plus budget status and retained source ranges. Approximate token counts use a character heuristic and are not tokenizer-exact.

The total character budget includes Markdown and omission metadata. Selection and projection happen before rendering; Spiracha does not first build the full transcript Markdown. Failed output receives its own typically larger section budget. Multi-megabyte success and opaque payloads are bounded before rendering.

## Privacy and safety

Focused evidence applies the existing project-root conversion and username redaction transforms to retained text. Lenses match only normalized transcript metadata and never cause filesystem reads for path or glob anchors. Transcript and lens data are untrusted: anchor counts, string lengths, glob complexity, context windows, budgets, unmatched pairing state, episode counts, array samples, diagnostic sets, and rendered output are bounded. Omitted raw payloads are not embedded in HTML or hidden metadata.

Some sources do not expose every structured field. Kiro and MiniMax Code emit structured `tool_call` and `tool_output` events, including call IDs when their persisted records provide them. Antigravity does not expose stable call/result IDs, so its normalized metadata reports that limitation instead of fabricating exact fields.
