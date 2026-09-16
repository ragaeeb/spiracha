# Codex UI batch archive manifest

This is the Codex UI multi-thread export contract, not the stable
`POST /api/v1/conversations/export` Markdown ZIP contract.

UI batches deduplicate requested thread IDs and can retain exportable threads
while skipping per-entry failures. Every successful batch archive includes
`spiracha-manifest.json` with `schemaVersion: 1` and:

| Field | Meaning |
| --- | --- |
| `generatedAt` | ISO timestamp when the manifest was built. |
| `requestedThreadIds` | Deduplicated requested IDs in input order. |
| `exportedCount` | Number of entries with `status: "exported"`. |
| `skippedCount` | Number of non-exported entries. |
| `entries` | One result per requested thread. |

An exported entry contains `threadId`, `status: "exported"`, and `fileName`.
A skipped entry contains `threadId`, `status` (`missing`, `unreadable`, or
`unstable`), plus diagnostic `code` and `message`. Treat filenames as manifest
values rather than guessing them from a title; sanitization/collision handling
can change the generated name. Diagnostic messages are not stable machine codes.

Inspect skipped entries even when the ZIP download succeeds. A missing/unreadable
source is not the same as one changing during snapshot export. The snapshot
workflow has two attempts with a 40 ms retry backoff for its retryable case; it
does not indefinitely wait for an active source to stabilize.

No exportable threads is an error, not a successful empty archive. Archive-wide
failures such as unusable output storage or a compression/write error can abort
the entire batch rather than become skipped thread records. Filesystem staging
and ZIP compression are not a transaction across all source stores and do not
guarantee fixed-memory streaming. Temporary download links remain subject to
export retention.

The stable API instead returns an error when a requested conversation is missing
and does not promise this source-specific manifest. Do not write one consumer that
assumes every Spiracha ZIP has identical membership/error semantics.

Implementation: `src/lib/codex-browser-export.ts`; regression examples:
`src/lib/codex-browser-export.test.ts`.
