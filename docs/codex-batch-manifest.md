# Batch archive manifest

Stable API ZIP exports and source UI batch archives share
`spiracha-manifest.json` (`schemaVersion: 1`) produced by
`assembleExportBatch` / `writeExportArchive`. The Codex UI batch exporter
uses that same producer.

Every generated manifest includes:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Always `1`. |
| `kind` | Producer kind such as `batch_normalized_export` or `batch_original_raw`. |
| `source` | Conversation source or UI platform id. |
| `failurePolicy` | `atomic` or `partial`. |
| `options` | Request options recorded by the producer (selector, format, and similar). |
| `requestedCount` | Number of requested IDs / entries. |
| `successCount` | Entries with `status: "exported"`. |
| `failedCount` | Entries with `status: "failed"`. |
| `missingCount` | Entries with `status: "missing"`. |
| `entries` | One outcome per requested id, in request order. |

Each entry contains:

| Field | Meaning |
| --- | --- |
| `requestedId` | The requested conversation or thread id. |
| `status` | `exported`, `failed`, or `missing`. |
| `memberNames` | Final archive member names for that id (empty when not exported). |
| `error` | `{ code, message }` for failed/missing entries, otherwise `null`. |
| `omissionSummary` | Optional human summary of omitted content, otherwise `null`. |

Treat `memberNames` as the authoritative filenames. Sanitization, UTF-8 byte
bounds, and collision suffixes can change a title-derived name; the generated
manifest filename `spiracha-manifest.json` is reserved for the producer.

Atomic stable API ZIP export (`POST /api/v1/conversations/export`) fails the
whole request when any requested id is missing or failed; no partial archive
is returned. Partial UI batches can still include `spiracha-manifest.json`
with mixed entry statuses. Filesystem staging and ZIP compression are not a
transaction across source stores.

Implementation: `src/lib/export-archive.ts`; Codex UI:
`src/lib/codex-browser-export.ts`. Regression examples: `src/docs.test.ts`,
`src/lib/export-archive.test.ts`.
