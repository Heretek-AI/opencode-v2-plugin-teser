# fixture-tool-direct

Proves `options: { codemode: false }` makes a plugin tool a direct tool: it
appears in the model request's `tools` array instead of only in the Code Mode
catalog.

- `src/server.ts` adds `echo_tool` with `codemode: false` (idempotent
  transform, as in `tool-basic`).
- `pass.yaml` asserts the call completes with `echo:hi` and that the first
  primary stub request offers `echo_tool` directly.
