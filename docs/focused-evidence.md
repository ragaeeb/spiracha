# Focused evidence lenses

Focused evidence selects compact causal episodes from a normalized conversation. Use it when a full transcript contains large tool payloads but an investigation needs only matched invocations, nearby interpretation, failures, retries, workarounds, and outcomes. Use the unchanged full-transcript export for archival fidelity.

The feature uses one source-independent engine for Codex, Claude Code, Command Code, Cline, Grok, Grok Bot, Kiro, Qoder, Cursor, Antigravity, FX, MiniMax Code, and OpenCode. Source adapters only normalize events. Matching, call/result pairing, episode construction, projection, budgeting, Markdown rendering, and omission accounting are shared. The core does not assign domain meanings such as “review.” Imported Web chats are deliberately excluded: they are UI-only, in-memory imports rather than stable normalized conversations.

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

Shell anchors tokenize normalized command data and compare the executable and immediate subcommand, recognizing `cd … &&`, environment assignments, and `rtk` wrappers. Claude Code Bash arguments expose their command and working directory. Codex executor calls additionally expose literal `tools.exec_command({cmd: "…"})` arguments; computed expressions and unsupported JavaScript forms remain unparsed and are reported in the export. They do not search comments or tool output for command substrings. Text anchors use bounded case-sensitive literal matching; arbitrary regular expressions and executable matching code are not accepted.

## CLI and client examples

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

Packaged CLI:

```bash
spiracha evidence <ref> --lens config/spiracha-evidence-lens.json [--output focused-evidence.md]
```

The CLI delegates to the same normalized client and evidence renderer as the UI and HTTP API.

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

Claude Code and Kiro keep compacted continuations as separate files but expose each recognized lineage as one parent-owned conversation in lists. Use the parent conversation ID to read, export, delete, or generate focused evidence for the complete lineage:

```http
POST /api/v1/conversations/kiro/<parent-session-id>/evidence
Content-Type: application/json
```

```ts
const result = await client.exportConversationEvidenceMarkdown({
  source: "kiro",
  id: parentSessionId,
  lens,
});
```

The parent conversation keeps physical segments in lineage order, records their IDs as `continuationSessionIds` metadata, and uses the latest continuation metadata where appropriate. Kiro additionally removes synthetic checkpoint-summary messages. A direct child-segment ID deliberately returns only that physical segment, so clients must retain the parent ID from the list response when they need the complete conversation. Deleting a parent removes its recognized lineage; deleting a child removes only that child file. Kiro requires a strict, unambiguous continuation chain and leaves incomplete or ambiguous branches as separate sessions. Claude Code follows the source's compaction metadata and excludes abandoned branches from the parent transcript.

Antigravity keeps one conversation ID but may replace its generated transcript with a rolling suffix after compaction. Spiracha reconstructs the earlier prefix from that conversation's retained artifact snapshots, then overlays the current transcript and live trajectory records by step order. Focused evidence therefore uses the same Antigravity conversation ID before and after compaction and can match retained events from either side of the boundary. If the optional artifact history is unavailable, the readable current transcript remains available without historical reconstruction.

## UI workflow

Open any supported stable-conversation detail page and choose Export. Select **Focused evidence** instead of **Full transcript**. The shared editor supports every anchor kind, context and budget controls, JSON import/export, server-backed preview statistics, validation errors, and Markdown download. The Web import detail page currently exposes transcript, metadata, and Parsed JSON only; focused evidence does not apply to it. Lens JSON is held only in the dialog; Spiracha does not store arbitrary lens JSON in a cookie. Keep reusable named lenses in the project repository.

## Determinism, loss, and traceability

For the same normalized conversation, lens, renderer version, and generation timestamp, Markdown is deterministic. Episodes remain in source order and retain message IDs, call IDs, pairing confidence, event-order ranges, and the original Spiracha reference. Explicit call/result IDs produce `exact` confidence. Sources without stable IDs use a deterministic bounded ordered fallback marked `ordered_fallback` only when one compatible pending call exists. Ambiguous results remain unpaired; a missing result means unknown outcome. Antigravity generic results can use this fallback. No fallback is presented as exact. Output anchors also retain their paired invocation.

Projection preserves invocations, working directories, statuses, durations, diagnostics, guidance, retry deltas, outcomes, and stable identifiers where the source exposes them. It samples large arrays, sorts object keys, truncates unknown text with markers, deduplicates only identical diagnostic bodies, and omits binary, base64, encrypted, and opaque payloads. The omission ledger records inspected, retained, omitted, truncated, deduplicated, and opaque counts plus budget status and retained source ranges. Approximate token counts use a character heuristic and are not tokenizer-exact.

Text-matched non-tool messages, including final answers within a larger episode, compete for body space under **Matched evidence**. Long matching text is projected around its first literal match; a matched Markdown section is retained where it fits. Other matching spans can still be omitted. Distinct messages sharing a diagnostic prefix remain distinct. Each rendered snippet carries its message ID, available author identity and timestamp. Message-only conversations omit empty tool sections and disclose when structured tools are unavailable.

The total character budget includes Markdown and omission metadata. Selection keeps at most 256 candidate episodes (the first 128 and latest 128 when capped) and reports that limit. Overlap merging stays within the order window and does not cross a user turn. Final answers and failures receive priority; equally ranked later episodes are considered first, then retained episodes are displayed chronologically. An oversized episode does not prevent later smaller episodes from fitting. Repeated context bodies are rendered once.

Each episode has an additional 8,000-character body allocation, reduced for small total budgets. Successful and failed output budgets apply per result. Directly matched prose receives the larger output allowance, with a 300-character minimum; all unmatched prose shares the commentary allowance across each episode. Empty retry sections are omitted. Projection and selection are lossy: the ledger and UI distinguish selected events, rendered bodies, matching events, and rendered matches, and flag candidate, section, and total budget limits. Compare matching and rendered-matching counts before relying on completeness. Approximate tokens describe this export only, not measured savings against a full transcript.

Selection and projection happen before rendering; Spiracha does not first build the full transcript Markdown. Multi-megabyte success and opaque payloads are bounded before rendering. These rules are deterministic heuristics, not a semantic summary or proof that all causal context survived.

## Reducing token cost

The lens editor’s **Use 12k preset** button applies the settings below while preserving the lens name and anchors. It updates the Lens JSON so it can be exported for CLI/client reuse. Existing and imported lenses change only when the button is clicked.

A large `totalCharacters` budget is a ceiling, and broad lenses can fill it even after rendering overhead is reduced. Start with a specific text literal, command, or artifact instead of a broad tool or topic anchor. For a smaller investigation, try `totalCharacters: 12000`, `successfulOutputCharacters: 500`, and `commentaryCharactersPerEpisode: 500`; retain the larger failed-output allowance so matched explanations and repairs still have room. Set both commentary counts to 1, turn off reasoning summaries, and disable workaround following when unrelated commands are not needed. These are ordinary lens settings, not a separate export mode.

A smaller budget is deliberately lossy. Check **matched / rendered matched events**, then expand the lens or budget if needed. In the eight-thread saved audit, a 12,000-character lens cut total characters by about 69%, but retained fewer matching events in seven threads. This is a character-based token estimate, not a tokenizer measurement or a guarantee of equivalent evidence. The shared context allowance and removal of empty framing provide smaller savings without lowering the matched-body allowance. Projected JSON is serialized compactly before truncation, so formatting whitespace does not displace values; whitespace inside string values is preserved. This does not change the existing JSON field selection or array sampling.

## Privacy and safety

Focused evidence applies the existing project-root conversion and username redaction transforms to retained text. Lenses match only normalized transcript metadata and never cause filesystem reads for path or glob anchors. Transcript and lens data are untrusted: anchor counts, string lengths, glob complexity, context windows, budgets, unmatched pairing state, episode counts, array samples, diagnostic sets, and rendered output are bounded. Omitted raw payloads are not embedded in HTML or hidden metadata.

Some sources do not expose every structured field. Cline, FX, Kiro, and MiniMax Code emit normalized `tool_call` and `tool_output` events from their persisted records, including call IDs when available. Cursor, Qoder, and OpenCode also contribute structured tool evidence when their source records expose it. Antigravity does not expose stable call/result IDs for every transcript record, so its normalized metadata reports that limitation instead of fabricating exact fields. Web imports are outside this engine and do not currently support focused evidence.
## Recover omitted evidence

Focused exports include a `Retrieve` line with a revision and the full normalized
message-order range. Narrow that range, or select an exact `messageId`, before
retrieving more:

```json
{"revision":"<revision from export>","messageId":"<message ID>","maxCharacters":12000}
```

Save this as `request.json`, then run:

```sh
spiracha retrieve "<original-reference>" --request request.json
```

Use inclusive `startOrder` / `endOrder` instead of `messageId` for surrounding
context or messages entirely absent from the export. A request without a selector
reads all normalized messages. `content` contains a JSON fragment; concatenate
pages before parsing it as a message array. Repeat the same request with `offset`
set to `nextOffset` until it is null, only when additional detail is needed.
The default page contains at most 12,000 UTF-16 content characters, maximum
64,000; the JSON envelope and escaping add overhead. Surrogate pairs are not
split. Empty selections, unknown fields, invalid bounds and offsets fail.

The revision hashes source, conversation ID and ordered normalized messages.
Changed or deleted sources fail: regenerate evidence rather than silently
retrieving from a different revision. There is no retained snapshot cache.
These are complete normalized message fields, including tool data and metadata;
they are not original raw bytes or a guarantee that native normalization retained
every source field. Retrieval does not open referenced artifacts.

The Bun SDK exposes
`retrieveConversationEvidence(client, { source, id }, request)` from
`spiracha/client`. It works with local and HTTP clients. The bound applies to
agent-visible output: the existing detail reader still loads the full conversation
internally, including across HTTP. There is no new HTTP route or MCP server.

## Canonical skill and local installation

The canonical skill is [SKILL.md](../.agents/skills/spiracha/SKILL.md).
From the repository root:

```sh
bun run skill:deploy --dry-run
bun run skill:deploy
bun run skill:deploy --check
```

The script distributes to Claude, Cursor, Codex, Antigravity, Kiro and OpenCode
user skill directories. Use `--agents cursor,codex` to select targets or `--home`
for an isolated installation. Codex honors `CODEX_HOME` unless `--home` is supplied.
It checks the repository CLI, copies the canonical files, and generates a local
`runtime.json` pointing to this checkout and Bun executable. This avoids relying
on a stale global Spiracha binary. Keep the checkout available and rerun deployment
after moving it. `--check` detects missing/stale skill files and runtime failures;
it does not launch harnesses or prove their skill discovery. Start a fresh chat.
No attribution hook is required. Symlink destinations are refused.

This extends Klassify's copy-only distribution pattern with runtime verification.
Klassify additionally requires native attribution hooks in some harnesses; copying
a skill alone does not configure those hooks. Cursor's current local hook was
present during this investigation, so the earlier setup failure was not reproduced.
The skill roots follow [Cursor's documentation](https://prod.cursor.com/docs/skills)
and [Antigravity's documentation](https://www.antigravity.google/docs/skills).
