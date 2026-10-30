# Validation record

This commit provides the standalone temporary rules service and its tests.

Run `npm test` and `npm run typecheck` from this mod. The tests use a
deterministic event harness, not the native Claude Code host.

The installed Claude Code 2.1.312 executable aborts inside Bun before startup
in this environment. Native validation and execution remain unverified.
