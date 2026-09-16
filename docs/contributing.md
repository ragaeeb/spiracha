# Integration and documentation maintenance

Read `AGENTS.md` and the root README first. Use the repository's Bun/Bunx commands;
root tests use Bun, UI tests use Vitest's Node runtime. Use the declared dependency
versions and lockfile. `rtk` is the preferred wrapper when available, not a
replacement for Bun. Keep real conversation/authentication data out of fixtures.

## Adding or changing a stable source

1. Define source identity, workspace/global scope, location resolution, and error
   conventions. Register the adapter and static source information together.
2. Implement required `list` and `get`; implement raw/delete only when the source
   owns a safe, well-defined operation. Document missing-vs-malformed behavior,
   raw provenance, continuation lineage, and destructive side effects.
3. Normalize required DTO fields, timestamp units/nullability, deterministic order,
   roles/phases, model metadata, deep links, and nullable structured tool evidence.
   Keep browser-safe parsing independent of Bun storage/database imports.
4. Decide separately whether a self-contained payload parser is feasible. Update
   payload types/registry or explicit exclusions; native storage support alone is
   not payload support. Preserve no-match versus claimed-malformed semantics.
5. Add relevant UI inventories/detail routes/server functions only when intended.
   Preserve dynamic imports at Bun server boundaries and metadata-first loading.
   Do not edit `src/ui/routeTree.gen.ts`; regenerate through the normal build.
6. Add synthetic happy-path and missing/corrupt/ambiguous fixtures, normalized
   ordering/model/tool cases, selector/pagination tests, local/HTTP contract tests,
   and source-specific delete/recovery/raw byte checks where supported.
7. Update registry lists, configuration precedence, support/capability tables,
   public examples, and high-value declaration JSDoc. Do not introduce legacy
   exporter aliases, an MCP server, or a plugin as an incidental integration step.

Web UI imports and Codex Cloud UI are separate workflows, not automatic stable
source additions. Internal storage helpers are not supported public package APIs.

## Documentation and release checks

On a clean checkout, verify that the declared `bin/spiracha.ts`, license file,
source modules, and lockfile are present. Missing files in a supplied archive must
be resolved against the authoritative repository, not recreated from guesses.

```bash
bun install
bun run lint
bun run typecheck
bun test
bun run test:ui
bun run build
bun run coverage
bun run test:package
```

Use targeted adjacent tests during iteration, then run the relevant full gates.
Coverage is independently checked for root and UI suites. Builds can regenerate
the route tree; inspect that diff rather than hand-editing it. Do not run the
broad mutating formatter merely to make a documentation patch appear clean.

Review Markdown relative links from the file containing each link, fence syntax,
complete-versus-abbreviated DTO examples, and all referenced scripts/options.
Examples must distinguish Bun SDK imports from the portable compiled payload
entrypoint. Check failure examples as well as success examples.

Inspect the packed artifact's README links, icon, license, entrypoint, compiled
payload declarations/JavaScript, and built UI/server. Repository-relative docs
are not automatically included when `package.json.files` restricts publishing.
Never describe a local source-only check as a successful package smoke test.

A comments-only token/AST comparison can show that an audit patch preserved code;
it cannot replace the declared TypeScript version, Biome, Bun tests, browser
boundary tests, or runtime/package smoke tests.
