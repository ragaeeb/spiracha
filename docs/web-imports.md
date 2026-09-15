# Web import behavior

The `/web` workflow parses supplied JSON into normalized conversation events.
It does not add `web` to the stable source registry, persist imports to disk, or
implement deletion of an original source export. Keep the original file yourself.
The Parsed JSON view is normalized data, not a byte-for-byte copy of that file.

The server wrapper accepts 1–20 files, each at most 25 MiB of UTF-8 content,
totaling at most 100 MiB; names are non-empty and limited to 255 characters.
Those are UI request validations. `parseWebChatFiles` is a parsing helper without
this wrapper's complete limit checks, while `spiracha/payload` has its own 25 MiB
conversion limit and different error model.

## Identity and retention

`parseWebChatFiles` does not retain results. `importWebChatFiles` also inserts
results into a module-level server store. All tabs using that server share it;
it is not a browser-private session store. Restarting the server discards it.

IDs hash provider plus source conversation ID when available, otherwise provider
plus normalized event/file-name/title identity. Reimporting the same ID replaces
the retained entry and moves it to the newest insertion position. Reads do not
make an entry newest. Duplicate IDs within one parse result are also replaced.

The 128 MiB budget tracks input file UTF-8 bytes apportioned over the file's
conversations, rounded upward per conversation. It is not measured normalized
object heap size. Oldest retained entries are evicted until accounting is within
budget; a returned import result is not a promise it remains in the store. Retain
an original file for reimport instead of treating the detail URL as a backup.

## Fidelity and troubleshooting

Parsing uses provider-specific shapes and normalization rules; a successful
import is not a proof that every branch, attachment, binary body, or source field
was preserved. Model/content metadata is preferred over filename hints. Message
counts reflect normalized message events, not every tool or reasoning event.

When history looks incomplete, first confirm the source export actually contains
the desired conversation bodies. Compare normalized events and artifacts with
the original file; do not compare only the visible message count. Re-export a
self-contained conversation rather than supplying a source database index.

Invalid JSON and unsupported shapes are reported per file while accepted files
remain usable. For a reproducible issue, preserve the provider/shape, timestamps,
and relationship fields in a minimal synthetic fixture, but replace private
text, identifiers, paths, tokens, and artifact bodies. Describe the expected
messages and the exact supplied format. Do not attach a complete private export.

Implementation: `src/lib/web-chat.ts` and `src/ui/lib/web-chat-server.ts`.
