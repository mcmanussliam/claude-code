# Default rule resolution

This mod implements rule-directory discovery and resolution through the
`temporary-rule-poc` provider’s `$.rules` API. It is no longer a pass-through
boundary and does not use the npm package’s loader.

## Source layout

- `hooks/register.ts` connects engine events to discovery.
- `hooks/discover.ts` reconciles parsed files through `$.rules.add/remove`.
- `hooks/sources.ts` selects personal and project rule directories.
- `hooks/files.ts` scans markdown files and deduplicates symlink targets.
- `hooks/content.ts` removes HTML comments outside fenced code.
- `hooks/paths.ts` handles path normalization and ancestor traversal.

## Resolution

1. Read personal rules under `~/.claude/rules`, or the configured
   `CLAUDE_CONFIG_DIR/rules` directory.
2. Walk project ancestor directories from filesystem root to the working
   directory and inspect each `.claude/rules` directory.
3. Recursively read `.md` files in deterministic filename order. Follow
   in-root symlinks, deduplicate canonical targets and stop link loops.
4. Parse YAML frontmatter through `$.rules.parse`. No `paths` means the rule
   joins startup instructions. A `paths` list or comma-separated string makes
   it conditional on matching Read/Edit/Write access or a file mention.
5. Match project globs relative to the directory containing `.claude`;
   personal rules use the session’s primary directory.
6. On file access, discover nested `.claude/rules` directories along the
   target’s ancestor chain. Nested rules are not all loaded at startup.
7. Apply `claudeMdExcludes` against both logical and canonical source paths.
8. Reconcile additions, edits and deletions through `$.rules.add/remove`.
   Unchanged rules retain their delivery ledger and do not invalidate context.

Block HTML comments are removed outside fenced code. Unknown frontmatter
fields are ignored. Invalid YAML makes the body unconditional. Runtime
rule state, agent-loop deduplication, compaction, forks and clearing are handled
by the provider rather than duplicated here.

The `sources` option selects `user-and-project` (default), `user-only` or
`project-only`. The plugin declares its dependency on `temporary-rule-poc`.
Both mod event orders are covered by the standalone integration tests.

## Coexistence with Claude’s native loader

The resolver retains physical source paths. The provider does not append an
unconditional file already in `instructionFiles`, preserves existing native
instruction order and managed content, and deduplicates matching scoped rule
frames already in tool context or emitted at the attachment boundary.

The public repository still does not contain the private engine loader. This
is an implementation of its documented rule-directory behavior, not a claim
that every internal edge case has been extracted or matched. To replace the
native loader entirely, the engine must stop its own default-rule producer
when seating this mod; this fork cannot change that private call site.

Known gaps requiring native integration work:

- External symlinks are skipped rather than granting native import consent;
  native-approved files already supplied by the engine remain intact.
- `@` imports, native Bash read classification, extra-directory flags,
  private setting-source filtering and host-specific policy are not
  reimplemented. Existing native instructions and attachments are preserved.
- Frame deduplication recognizes exact file-backed rule frames, not every
  possible multi-file/private attachment rendering.
- Pattern matching is implemented and tested for the supported syntax, but
  full native glob-dialect and managed-plan parity remain unverified.

## Verification

From the provider directory, `npm test` executes the real resolver and noun
against filesystem fixtures. Tests cover recursive discovery, user/project
ordering, frontmatter activation, nested bases, exclusions, symlinks, changes,
compaction, clearing and coexistence with supplied native rules.

`tests/register.test.ts` provides native-host adapter tests using a recording
noun fixture; the standalone paired-mod tests exercise real delivery.

```sh
claude plugin validate mods/default-rule-resolution
claude plugin test mods/default-rule-resolution
```

These native commands could not run here because Claude Code 2.1.312 aborts
in Bun before startup. TypeScript checks and standalone checks are recorded
in `../temporary-rule-poc/VALIDATION.md`.
