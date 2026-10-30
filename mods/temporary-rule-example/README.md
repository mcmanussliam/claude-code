# Temporary rules example

A small plugin that uses the `temporary-rule-poc` provider's `$.rules` API.
Its rules belong to this plugin: removing or clearing them leaves rules owned
by other plugins intact.

Load both plugins from the repository root with a Claude Code CLI that
supports function hooks:

```sh
claude --plugin-dir mods/temporary-rule-poc \
       --plugin-dir mods/temporary-rule-example
```

Try these commands in the conversation:

```text
/rule-add {"name":"style","content":"Prefer explicit return types."}
/rule-add {"name":"tests","content":"Include regression coverage.","paths":["src/**/*.ts"]}
/rule-list
/rule-remove style
/rule-clear
```

Rules without `paths` join the conversation's instructions. Scoped rules
activate when a matching file is read, edited, written or mentioned.

`hooks/register.ts` shows command registration and calls to `$.rules.add`,
`list`, `remove` and `clear`. The provider owns parsing, matching and delivery.
To load on-disk `.claude/rules` as well, also pass
`--plugin-dir mods/default-rule-resolution`.

The example is included in `mods/tsconfig.rules.json`. Run `npm run typecheck`
from `mods/temporary-rule-poc` to check it against the provider's contract.
