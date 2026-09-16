# Documentation index

Start with the root [README](../README.md) for installation and the UI overview.
These references describe the checked-in implementation; internal modules and UI
server functions are not automatically supported public package entrypoints.

## Consumers

- [Bun client reference](client-reference.md): methods, downloads, errors, and modes.
- [HTTP API reference](api-reference.md): request fields, limits, pagination, and statuses.
- [Payload conversion](payload-reference.md): portable input conversion and error codes.
- [Focused evidence lenses](focused-evidence.md): bounded selection and omission accounting.
- [Web imports](web-imports.md): retention, identity, limits, and fidelity.
- [UI lifecycle](ui-lifecycle.md): export preferences, deferred loading, and live notifications.
- [Codex UI batch manifest](codex-batch-manifest.md): partial archive outcomes.
- [Analytics measurements](analytics-measurements.md): units, scope, and CSV safety.

## Operators

- [Configuration](configuration.md): source-path precedence and lifecycle controls.
- [Privacy and access](privacy-and-access.md): loopback, export sharing, and Keychain grant scope.
- [Deletion safety and capabilities](deletion-safety.md): source matrix and common recovery entry.
- [Codex recovery](codex-deletion-recovery.md), [Cursor recovery](cursor-crash-recovery.md),
  and [Grok Bot deletion](grok-bot-deletion.md): durable source-specific procedures.
- [Codex Cloud](codex-cloud.md): authentication, network reads, and partial inventories.
- [Concurrency](concurrency.md): cancellation, ownership, and scheduling details.

## Contributors

- [AGENTS.md](../AGENTS.md): repository working conventions.
- [Contributor checklist](contributing.md): integrations, fixtures, and release/doc checks.
- [Data and runtime conventions](data-conventions.md): shared DTO and source invariants.
- [Payload design/validation plan](payload-sdk-plan.md): design background and supported shapes.

Read source-specific constraints before generalizing an option from another
integration. An archive download, an empty all-source page, and a successful
background cleanup request do not by themselves establish source completeness.
