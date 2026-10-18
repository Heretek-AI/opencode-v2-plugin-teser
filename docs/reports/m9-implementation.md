# M9 Implementation Report — Matchers, expect evaluation, tier 2

- **Stage ID:** M9 (assert: `src/assert/` + `src/util/redact.ts`, `src/tiers/scripted.ts` + unit/e2e tests)
- **Date:** 2026-10-17
- **Branch:** `impl/v1` (not committed, per task instructions)

## Summary

Implemented the M9 assertion layer and scripted tier: a `check()` matcher
evaluator with specific, truncated failure messages; `evaluate()` turning a
`ScenarioExpect` plus recorded evidence (probe log, run events, stub
requests, project dir) into failure strings; and `runScenario()` running one
scenario per sandbox (stub + merged plugin options + workspace), writing the
four evidence files, and returning a `CaseResult`. All 7 fixture cases in the
table-driven `test/e2e/tier2.test.ts` behave as specified (6 pass, 1 fails
with the expected message).

## Files created

- `src/util/redact.ts` — `TRUNCATE_MAX` (300), `truncate(text, max)`,
  `excerpt(value, max)`. Needed for the M9 "truncate got to 300 chars"
  message requirement; shared by matchers now, judge evidence later.
- `src/assert/matchers.ts` — `check(value, matcher, label): string[]`
  (all keys AND-ed) plus exported `deepEqual`. Details:
  - `equals`: recursive structural equality (key-order independent).
  - `contains`/`notContains`: strings as-is, anything else via
    `JSON.stringify` (spec §M9).
  - `matches`/`notMatches`: JS regex with leading `(?i)` stripped and
    applied as the `i` flag; invalid patterns fail closed.
  - `includes`: value must be an array; every expected item must be
    present (`===` for primitives, `deepEqual` for objects).
  - `exists`: `true` requires non-null/undefined, `false` the opposite.
  - `count` (`eq`/`gte`/`lte`): accepts a number or an array (length).
  - Messages name the label and quote both sides, e.g.
    `tools[0].echo_tool.output: expected to contain "echo:bye", got "echo:hi".`
- `src/assert/expect.ts` — `Evidence { run, probe, stubRequests,
  projectDir, mode }`, `evaluate(expect, ev): string[]`, exported
  `getOutputText(result)`. Details:
  - `tools` from `probe.toolCalls("post")`: `count` (default `gte: 1`),
    then at least one call must match `status`+`input`+`output` together
    (else "none matched ..." plus the first call's detail). Output text =
    `result.content` (string or `{text}` array joined) else
    `result.output` stringified else whole-result JSON.
  - `noTools`: no post-probe call with the name AND no `tool_use` event
    (including Code Mode `innerCalls`) with the name.
  - `hooks`: probe-kind mapping (`tool.execute.before`→`tool.before`,
    etc.), optional `tool` filter, at least one record must match all of
    `input`/`env`/`system` together. Tool hooks match `input` against
    the call input; other hooks against record fields; `env` against the
    record env; `system` (session.context only) against parts joined
    with `"\n"`.
  - `request`: nth 1-based `primary` stub request; `system` = system-role
    message text only; `tools` = direct names plus catalog last-segments
    and `_`-joined forms (via `catalogPaths`/`pathSegments`).
  - `files`: resolved under `projectDir`, `..` escapes rejected;
    fail-closed on missing/unreadable files; content checks reuse
    `check()`.
  - `exitCode` (default 0), `noErrors` (default true), `text`
    (`textOf(events)`), `stderr` (raw).
- `src/tiers/scripted.ts` — `runScenario(opts): Promise<CaseResult>`
  (stub with scenario `script`/`judgeReply` → shim in evidence dir →
  sandbox `[pre, shim, post]` with shallow-merged options + workspace →
  run → evidence files `events.jsonl`/`probe.jsonl`/`stub-requests.jsonl`
  /`stderr.log` → evaluate before dispose → `stub.exhausted` failure
  `"script exhausted: ..."`, plus a `timedOut` failure), `concurrencyLimit()`
  (`min(4, availableParallelism())`), and a tiny order-preserving
  `pool(items, limit, fn)` for M10. `CaseResult` imported from
  `./load.ts` per plan (moved to `report/results.ts` in M10).

## Tests

- `test/unit/matchers.test.ts` — 13 tests: deep equality, every matcher
  key, `(?i)`, invalid-regex fail-closed, includes-missing item message,
  exists, count on numbers/arrays, 300-char truncation, AND semantics.
- `test/unit/expect.test.ts` — 15 tests with fake evidence (no opencode):
  exitCode/noErrors, tools pass/fail/count/together-matching, noTools
  (probe + event level), shell hooks + missing-record + context system
  join, request system/catalog-tools + missing nth, files
  exists/contains/escape-rejection, text/stderr.
- `test/e2e/tier2.test.ts` — table-driven over the real fixture
  scenarios (parsed from their YAML): `tool-basic` pass/fail,
  `tool-direct`, `hook-mutate`, `shell-env`, `system-inject`,
  `event-file` passes. 7/7 green in ~10 s; the fail case asserts
  `pass === false` and the message contains
  `expected to contain "echo:bye"`.

## Results

- `bun run typecheck` — clean.
- `bun run lint` (`biome check .`) — clean for all new files; full run
  reports only the 18 pre-existing infos (verified identical on the
  stashed baseline).
- `bun test ./test/unit` — 152 pass / 0 fail (28 new).
- `bun test ./test/e2e/tier2.test.ts --timeout 600000` — 7 pass / 0 fail.
- `bun run check` — exit 0.

## Self-audit notes

- `matchHookRecord` first used an inline `{ [k: string]: unknown }`
  structural type with `Parameters<typeof check>[1]` casts; simplified to
  `Record<string, Matcher>` after importing `Matcher` — no casts remain.
- An optional-chain lint fix briefly dropped a `!` in the `matches`
  branch; caught on re-read and restored (`!regex?.test(...)`), unit
  tests confirm both polarities.
- E2E ran in ~10 s total (stub runs are fast); verified the fail case
  genuinely fails (`pass === false` asserted, not just message match).
- Not committed, per task constraints.
