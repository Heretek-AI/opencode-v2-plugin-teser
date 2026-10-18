# fixture-tool-basic

Proves a plugin tool added with `ctx.tool.transform` works through Code Mode
(the default): the model calls it via the built-in `execute` tool and the
probe sees the inner call under its real name.

- `src/server.ts` adds `echo_tool`, which returns `echo:<text>`. The transform
  is idempotent (checks `editor.get` first, with an `editor.list` fallback).
- `package.json` points `exports["./server"]` at `./src/server.ts`, so the
  entry resolver and shim are exercised (opencode itself ignores `exports`).
- `pass.yaml` asserts the call completes with output containing `echo:hi`.
- `fail.yaml` expects `echo:bye` and must fail.
