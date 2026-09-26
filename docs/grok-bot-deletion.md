# Grok Bot gateway deletion

Spiracha deletes bots and groups through `POST /api/deleteAgent` with the exact conversation ID, following [grok-bot-cli](https://github.com/ScriptedAlchemy/grok-bot-cli/blob/main/src/core/gateway.js). It first checks that ID in `POST /api/listAgents`; names are never deletion selectors. A missing remote ID returns an empty deletion result.

Deletion needs an internet connection and the macOS app's saved gateway session. Spiracha reads `gateway-descriptor.json` beside the configured persistence directory and unlocks it using the `Grok Bot Safe Storage` Keychain entry. Open Grok Bot and sign in if the session is missing or expired. Multiple saved sessions are rejected rather than guessing an account. Credentials go only to recognized HTTPS gateway hosts, with redirects disabled.

Grok Bot can stay open. Spiracha does not rewrite the roster, remove transcript replicas, or create cleanup receipts. The app synchronizes the service deletion normally; locally browsed data can remain visible until that sync completes. Successful results contain the deleted ID and no deleted files.

A failed or interrupted delete may have reached the service. Spiracha reports an unconfirmed deletion and does not automatically retry it. Check the bot/group in Grok Bot before retrying. Existing receipts from the former offline deletion implementation are left untouched and are no longer resumed; do not edit them to force local cleanup.

Tests use encrypted fixture sessions and a mocked gateway, asserting exact bot/group IDs and unchanged local persistence. They do not delete real bots or prove live service behavior.
