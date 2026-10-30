# Validation record

Prepared 2026-10-29 against upstream commit
`58d6da1e34d6cd1c6379dcbf568bd66f5f9b6102`.

| Check | Result |
| --- | --- |
| `npm ci` and `npm run build` in this mod | Passed; pinned dependency lock and bundled runtime notices included. |
| `tsc -p mods/tsconfig.json` from the repository root | Passed for the existing mods, using unchanged upstream 2.1.277 declarations. |
| `tsc -p mods/tsconfig.rules.json` | Passed for both new mods, native-host test sources and demo consumer, using unmodified generated 2.1.303 declarations from the original package. |
| `npm test` in this mod | 41 standalone contract tests passed, including direct backing methods, real filesystem discovery and failure handling without duplicate tool execution. |
| Static manifests/imports | JSON parsed; entry modules exist within plugin roots; runtime hook imports are local; generated API snapshot matches its source byte for byte. |
| `git diff --check` | Passed. |
| Native CLI startup | Blocked: installed `@anthropic-ai/claude-code@2.1.312` aborts inside Bun v1.4.4 on Linux x64, exit 134, even for `--version`. |
| `claude plugin test` / `claude plugin validate` | Not completed; CLI cannot start. |
| Native default-discovery differential tests | Not run. The public repo does not expose the private producer. |

The standalone harness is not the Claude Code host. Passing its tests proves
the tested service, discovery, event-chain and store contracts, not complete
native loader equivalence. Both mods now implement their behavior directly;
no package loader or pass-through-only default implementation remains.
