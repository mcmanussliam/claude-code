# Temporary rule PoC

This mod implements the `$.rules` noun directly. It uses the parsing,
matching, framing and delivery-ledger ideas from Liam’s `claude-plugin-rules`,
but does not import, install, wrap or vendor that package or its loader.
The six backing methods returned from `engine.create` are concrete functions;
caller-scoping hooks dispatch to the same implementation.

## API

The public contract is `types/index.d.ts`.

| Method | Effect |
| --- | --- |
| `await $.rules.add({ name, content, paths?, source? })` | Add or replace the caller’s rule in the current conversation. |
| `await $.rules.remove({ name })` | Remove the caller’s named rule and its delivery record. |
| `await $.rules.clear()` | Clear the caller’s rules and delivery records. |
| `await $.rules.list()` | List the caller’s rules with main-loop delivery status. |
| `await $.rules.parse({ text })` | Strip YAML frontmatter and normalize `paths`. |
| `await $.rules.matches({ paths, path })` | Match a relative path, with bounded brace expansion. |

`source`, when present, has `{ path, root, kind }`. It identifies the original
rule file, the base its globs are relative to, and its `user` or `project`
instruction tier. The default resolver uses this metadata to retain actual
file paths and avoid adding startup files the native host already supplied.
Inline rules need no source. The API cannot introduce a managed instruction.

Names are scoped to the calling plugin using host-provided `next.origin`.
Callers cannot choose another owner, list its rules, or clear them. The backing
noun also works directly without the caller-scoping hooks, using the provider’s
own namespace. Both paths use `hooks/service.ts`; none throws an unanswered
placeholder error.

```ts
import type { On } from 'claude-code'

export function register(on: On): void {
  on('command.run', { command: 'review-mode' }, async ($) => {
    await $.rules.add({
      name: 'review-conventions',
      content: 'Check exported functions for backwards compatibility.',
      paths: ['src/**/*.{ts,tsx}'],
    })
    return { text: 'Review conventions enabled.' }
  })
}
```

Declare a dependency on `temporary-rule-poc` in a consumer plugin’s manifest.
A command-driven example lives in [`../temporary-rule-example`](../temporary-rule-example).

## Implementation

- `hooks/service.ts` implements all six methods, serialized state mutations,
  source metadata, instruction placement and per-agent delivery records.
- `hooks/rule.ts` implements YAML frontmatter parsing, comma-separated path
  lists, bracket validation and bounded glob expansion. Unknown frontmatter
  is ignored. Invalid YAML yields an unconditional rule body.
- `hooks/register.ts` exposes the noun and handles prompt context, successful
  Read/Edit/Write access, mentions, fallback context, forks, compaction and
  `/clear`. Default discovery happens in the separate resolver mod.
- `hooks/vendor/` contains only bundled general-purpose parsing/matching
  dependencies (`yaml`, `minimatch` and brace utilities), with their notices.
  There is no runtime npm install or dependency on `claude-plugin-rules`.

Unconditional rules join instructions as user/project files. Existing native
files and managed tiers are retained. Scoped rules attach once per loop on
matching file access. Denied/failed accesses consume no rule. A whole read of
a rule file itself counts as delivery; a partial read does not.

State persists across a module reload, isolated by session id. Independent
agents have their own records; forks inherit their parent’s. Compaction resets
the affected loop. `/clear` removes the ending session’s rules. Removing or
replacing a rule resets its ledger; text already in conversation history cannot
be retracted. Instruction ordering is guidance, not enforced precedence.

Exact file-backed rule frames are deduplicated at the attachment boundary
when both native and plugin loaders emit the same frame. Native instruction
files already supplied at startup are deduplicated by source path.

## Build and checks

From this directory:

```sh
npm ci
npm run build
npm run typecheck
npm test
```

From the repository root, with a working Claude Code CLI and function hooks:

```sh
claude plugin validate mods/temporary-rule-poc
claude plugin validate mods/default-rule-resolution
claude plugin test mods/temporary-rule-poc
claude plugin test mods/default-rule-resolution
claude --plugin-dir mods/temporary-rule-poc \
       --plugin-dir mods/default-rule-resolution \
       --plugin-dir mods/temporary-rule-example
```

The Node tests execute both real modules, including the backing noun directly,
through a deterministic event harness. They do not substitute for native-host
parity tests. The generated 2.1.303 API snapshot remains unmodified under
`api/`; the existing mods keep their 2.1.277 snapshot.

The installed Claude Code 2.1.312 executable aborts inside Bun before startup
in this environment, so native module validation and native test execution
remain unverified. See `VALIDATION.md` and the default resolver’s README for
remaining compatibility limits.

The original MIT notice is retained in `LICENSE` for logic derived from
`mcmanussliam/claude-plugin-rules` commit
`668eb0ae33e633e37dd050b94315c4f1af860e52`.
