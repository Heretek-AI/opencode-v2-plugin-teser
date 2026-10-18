# M5 Implementation Report — The Probe

- **Stage ID:** M5 (probe: `probe/` + `src/probe/read.ts` + e2e)
- **Date:** 2026-10-17
- **Branch:** `impl/v1` (not committed, per task instructions)

## Summary

Implemented the M5 probe: a plain-ESM, dependency-free observation plugin
shipped as two entry directories (`probe/pre`, `probe/post`) sharing one
implementation (`probe/core.js`), plus the typed JSONL reader
(`src/probe/read.ts`). The probe records tool/shell/session hooks with
per-phase tags, snapshots payloads at record time so later-plugin mutations
cannot corrupt earlier records, redacts secret-valued env keys/headers, and
( post only ) captures the plugin/tool/command/agent/skill/MCP inventory on
the first `session.prompt` plus all `ctx.event.subscribe()` event types in a
background loop that is never awaited in `setup`.

## Files created

- `probe/core.js` — `makeProbe(phase)` reference implementation (ESM, only
  `node:fs` import). Record kinds: `setup`, `tool.before`, `tool.after`,
  `shell.before`, `session.prompt`, `session.context`, `session.model.request`,
  `inventory` (post), `event` / `event.error` (post). Metadata
  (`phase`/`seq`/`t`/`kind`) is spread LAST so payload fields can never
  overwrite the record type. All hook registrations awaited; the event loop
  runs via `void (async () => { for await … })()`.
- `probe/pre/server.js` — `export default makeProbe("pre")`.
- `probe/post/server.js` — `export default makeProbe("post")`.
- `src/probe/read.ts` — `readProbe(file): ProbeLog` (defensive JSONL parse,
  skips bad/torn lines; missing file → empty log), `ProbeLog.byKind(kind,
  phase?)`, `ProbeLog.toolCalls(phase = "post")` (pairs before/after by
  `callID`, excludes outer `execute` when its result embeds non-empty
  `toolCalls` found by a depth-limited recursive walk covering
  `result.metadata.metadata.toolCalls` and any other nesting; keeps a bare
  `execute` with no inner calls), `ProbeInventory` / `ProbeRecord` /
  `ToolCallPair` types, plus a `probePluginDirs()` convenience for M8/M10.
- `test/e2e/probe.test.ts` — M5 acceptance test with an inline temp fixture
  (adds `echo_tool`, appends `+A` in `execute.before`, sets `SPIKE_A=1` in
  `shell.create.before`); script calls `echo_tool`, then `shell`, then text.
- `test/unit/probe-read.test.ts` — unit tests for bad-line skipping,
  missing-file empty log, inventory extraction, and the outer-execute
  exclusion (nested `metadata.metadata.toolCalls` shape from real events).

## Test results

- `bun run check` — typecheck clean, biome clean on new files (remaining 18
  infos are pre-existing in older `test/unit` files), **55 unit tests pass**
  (51 pre-existing + 4 new).
- `bun test ./test/e2e` — **4 pass, 0 fail** (2 sandbox, 1 stub-codemode,
  1 probe). M5 e2e asserts, all passing:
  - pre `tool.before` for `echo_tool` has `{text:"hi"}`, post has `{text:"hi+A"}`;
  - post `shell.before` has `env.SPIKE_A === "1"`, pre records do not;
  - inventory lists `fixture-probe-a` with status `active` and `echo_tool`
    in `tools`;
  - ≥1 `event` record with `type === "session.tool.called"`;
  - paired `toolCalls("post")` contains `echo_tool` + `shell`, excludes the
    outer `execute` wrapper.

## Self-audit notes

- **Fail-closed / snapshot discipline:** probe `write()` deep-copies via
  `snapshot()` before clipping, so the pre-phase record cannot be mutated by
  the fixture or post-phase hooks. Verified by the hi vs hi+A assertion.
- **No forbidden imports:** `probe/*.js` imports only `node:fs`
  (`appendFileSync`); no `@opencode/plugin`, no TS. `tsconfig.json` already
  excludes `probe/`.
- **Hook-order dependence:** fixture placed between pre and post in the
  `plugins` array, matching SPEC §3.1; pre/post difference proves ordering.
- **Defensive parsing:** `readProbe` tolerates torn final lines and foreign
  lines; `rows()`/`safe()` normalize all inventory shapes (`[]` vs
  `{data: []}` vs `{error}`).
- **Deviations from the M5 reference:** (1) test points both probes at a
  test-owned temp file instead of `sandbox.probeFile`, because `out` must be
  known at `Sandbox` construction time — same semantics, no double sandbox;
  (2) added `probePluginDirs()` export (needed by M10, harmless now);
  (3) `useLiteralKeys` biome autofix applied to new files only.
- **Not done (out of scope for M5):** no commits (per task constraints);
  `src/index.ts` re-exports deferred to M10.
