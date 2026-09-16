# Privacy and local access boundaries

Spiracha is a same-user local tool, not an authenticated multi-user service.
Keep the production listener on loopback. Browser Origin checks accept the same
origin or a loopback spelling on the same scheme/port and reject `Origin: null`.
Requests without Origin can be accepted when their request URL is local. This
does not authenticate another local program or prevent a process running as the
same OS user from using the service. A reverse proxy or tunnel changes the trust
boundary; this snapshot does not provide a supported remote-authentication recipe.

## Before sharing an export

Inspect conversation text, paths, usernames, tool inputs/outputs, attachments,
embedded artifacts, and metadata. UI path conversion and username-redaction
preferences are renderer options, not a global secret scrubber. Do not assume
browser preferences apply to the stable client, CLI, supplied-payload converter,
raw endpoint, or every normalized JSON view.

Raw export intentionally preserves original source bytes. It cannot also promise
redaction, message filtering, or removal of credentials. A source page's Raw or
Parsed JSON tab may instead show normalized objects: check the operation, not
just the label. Supplied-payload artifacts can preserve an exact embedded report
body, including content outside the chosen message selector.

Focused evidence has bounded projection and documented text transforms, but is
still selected conversation content rather than an anonymity guarantee. Review
the result, the lens, and its omission metadata before sending it elsewhere.

## Retention and diagnostics

Private runtime directories restrict filesystem access; they do not encrypt
cache JSON or export files. Temporary exports and caches have opportunistic
retention policies. Web imports live in the server process and are not isolated
by browser user/session. Source files remain under their source application's
storage policy. Source backups and recovery journals can contain sensitive data.

Timing and malformed-record diagnostics can reveal identifiers, paths, and error
strings. Redact diagnostic excerpts before attaching them to issues. Do not
commit authentic conversations, authentication files, or Keychain secrets as
fixtures. Markdown/JSON exports are not complete recoverable source-store backups.

## Antigravity Keychain access

The unlock action explicitly reads the macOS Keychain item whose service is
`Antigravity Safe Storage` and account is `Antigravity Key`. The child process has
a ten-second timeout. Other platforms report unsupported Keychain access.

A successful unlock caches the secret **for this server process**, not for a tab,
cookie, or single request. `withAntigravityDecryptionCapability` passes a restricted
decrypt function to its action, but it uses that shared cached grant. There is no
explicit relock export in this module; restart the server to discard its cached
process state. Restarting does not remove source data or already written exports.

Distinguish locked, unsupported, and error states from an empty conversation
inventory. Readable plaintext/transcript/history material may remain available
without every encrypted body. Never print the secret to diagnose decryption.

Implementation: `src/lib/local-request-security.ts`,
`src/lib/antigravity-keychain.ts`, `src/lib/ui-cache.ts`, and
`src/ui/lib/settings.ts`.
