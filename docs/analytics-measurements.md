# Analytics measurement and export conventions

Codex analytics are deterministic observations from retained local records,
not a billing ledger, full execution trace, or causal performance benchmark.
Missing records, selected project/thread scope, and unsupported source fields
change what can be observed. Preserve unknown/null values rather than replacing
them with confident zeroes.

Agent DX JSON includes its schema marker. The authoritative field types and
`AGENT_DX_CSV_COLUMNS` are in `src/lib/agent-dx-analytics.ts`. JSON is generally
better for programmatic use because CSV encodes nested arrays/objects as JSON
text. CSV null/undefined cells become empty; NUL becomes a visible `\0` sequence.
The renderer appends a final newline and quotes CSV delimiters, quotes, and line
breaks. A future schema/column change needs an explicit compatibility review.

## Interpreting measurements

`reportedUsage` pairs a value with explicit semantics, which may be `unknown`.
Do not add source-reported cumulative totals as though they were independent
per-turn usage. Incremental token measurements are a separate structure.
Retained bytes measure recorded material, not provider-billed tokens, compressed
file size, or source application memory use.

`firstMutationLatencyMs` is a non-negative elapsed timestamp difference from the
first observed record to the first observed mutation; missing endpoints produce
null. It is not end-to-end user-perceived latency. Repeated commands, reads, and
gates use fingerprints and observed repository state. Warnings identify patterns
worth inspecting, not automatic instructions to remove checks or tool calls.

Goal spans aggregate roots and known descendants from the supplied descriptors.
Relationships outside that input are not automatically fetched. Incomplete or
inconsistent parent/child metadata can affect grouping. Treat export scope and
source completeness as part of any comparison between runs.

## Opening CSV safely

Conversation-derived labels, references, and text are untrusted. The CSV writer
escapes CSV syntax but **does not neutralize formula-like cells**. Quoting a cell
is not a spreadsheet formula-safety guarantee. Inspect JSON first or explicitly
import untrusted columns as text in your spreadsheet application; do not blindly
open untrusted exports with automatic formula interpretation.

A formula-neutralizing export mode would change data representation and needs
separate product/compatibility approval and tests. This guide does not change
existing CSV bytes.
