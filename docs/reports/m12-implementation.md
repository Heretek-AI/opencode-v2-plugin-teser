# M12 Implementation Report — Flake gate (live tier only)

- **Stage ID:** M12 (`src/gate/verdict.ts`, `src/gate/history.ts`,
  `src/gate/gate.ts`, `src/run.ts` wiring, `gate.artifact` schema field,
  unit tests, `NOTICE`)
- **Date:** 2026-10-17
- **Branch:** `impl/v1` (not committed, per task instructions)

## Summary

Implemented the M12 flake gate for the live tier: acknowledgment-aware
verdict logic (`decideGateVerdict` + fail-closed `parseAcknowledgments`),
`gh`-based history fetching with an injectable runner, orchestration
(`runGate`: applies-check, acks, prerequisites, history, exit mapping,
"Flake gate" report section), and `run.ts` wiring so required-version live
failures are decided by the gate when it applies while tiers 1/2 always
fail directly. Acceptance verified: verdict unit tests (stability, sticky
red, acks, no-history), orchestration tests with injected history (no
network), workflow-name parsing, absent-acks default, and exit-code
mapping; `bun run check` is green (212 unit tests pass, schemas in sync).

**Deviation from the task text (forced by the environment):** the
`review/IUMBTEMS` clone does not exist in this environment (only
`review/opencode`, `review/oc`, `review/spike` are present), so step 1's
"copy gate.ts VERBATIM + copy its tests" was impossible. Instead,
`src/gate/verdict.ts` and `src/gate/history.ts` were re-implemented from
the behavior specified in `docs/SPEC.md` §7.2 and the milestone text, with
Apache-2.0 headers and the interpretation documented in `NOTICE` and the
file headers. The copied-tests requirement is covered by an equivalent
original suite (`test/unit/gate-verdict.test.ts`) exercising the same
specified behaviors.

## Files created

- `src/gate/verdict.ts` — `Acknowledgment`/`AcknowledgmentsFile`,
  `parseAcknowledgments` (fail-closed: wrong version, non-array, or
  entry missing non-empty `case`/`reason` throws; optional `issue`/`date`
  must be strings), `emptyAcknowledgments` (absent-file default),
  `decideGateVerdict({current, history, acknowledgments, window,
  threshold})` (pure). Rules: no failures now → green; failing case with
  zero history samples → no-history; stable (≥window samples at
  pass-rate ≥threshold over the newest window, or over the window before
  the current consecutive failure streak = sticky red) + unacknowledged →
  regression; acknowledged stable failure or unstable failure → green with
  a reason line. Plus `liveRowsForVersion` (non-skipped live rows of one
  opencode version).
- `src/gate/history.ts` — `parseWorkflowName`
  (`owner/repo/.github/workflows/<file>@ref` → `<file>`, undefined when
  unparseable), `resolveWorkflowName` (explicit `gate.workflow` wins, else
  `GITHUB_WORKFLOW_REF`), `fetchHistory(opts, run?)` (`gh run list
  --workflow … --branch … --status completed --limit 15 --json
  databaseId,conclusion,createdAt --repo …`, newest-first sort, then
  `gh run download <id> --name <artifact> --dir <tmp>/<id> --repo …` per
  run, skipping failures/unreadable results; keeps tier===live rows of the
  required version with no `skipped`), `gatePrerequisites` (needs
  `GH_TOKEN`/`GITHUB_TOKEN` plus a working `gh`), all spawn async and
  injectable.
- `src/gate/gate.ts` — `gateApplies` (live ran with ≥1 non-skipped case +
  `gate.enabled` + `--gate` or `GITHUB_ACTIONS==="true"`),
  `readAcknowledgments` (absent → empty default; present-but-malformed →
  throws), `formatGateSection` (Markdown `## Flake gate` with
  ✅/❌/⚠️ verdict + reason lines), `runGate` (malformed acks → exit 1;
  regression → 1; green → 0; no-history → 2, or 0 with a warning when
  `gate.bootstrap: "allow"`; missing `gh`/token/repo/branch/workflow or
  fetch errors → clear message + fallback "fail on any live failure").
- `test/unit/gate-verdict.test.ts` — 12 verdict/parse/rows tests
  (stability, flake tolerance, no-history incl. new-case, sticky red with
  reason-text assertion, ack coverage, mixed stable+flaky, window
  sampling, sub-window samples not stable, fail-closed parse cases,
  row filtering).
- `test/unit/gate.test.ts` — 22 tests: workflow-name parsing, absent-acks
  default, malformed acks, `gateApplies` matrix, `runGate` exit mapping
  with injected history/prereqs (green 0, regression 1, flaky 0,
  no-history 2 / 0-with-allow, malformed acks 1, fallback 1/0, not-run),
  `formatGateSection`, mocked-`gh` `fetchHistory` (newest-first, download
  skip, row filtering, list failure throws), `gatePrerequisites`.

## Files modified

- `src/config/schema.ts` — added `gate.artifact` (default
  `"opencode-plugin-ci-results"`, the M13 action input default).
- `schema/config.json` — regenerated via `bun scripts/gen-schema.ts`.
- `src/run.ts` — replaced the `--gate` warning stub: after writing
  `results.json`/`report.md`, runs `runGate`; appends the gate section to
  `report.md` + `$GITHUB_STEP_SUMMARY`; exit code: required non-live
  failures always 1, else the gate's exit code when it ran, else 1 on any
  required live failure.
- `NOTICE` — lists the IUMBTEMS-based gate files (Apache-2.0) with the
  re-implementation note.

## Test results

- `bun run typecheck` — pass.
- `bun run lint` (`biome check .`) — pass (2 import-order findings fixed
  with `biome check --write` on the new files only).
- `bun test ./test/unit` — **212 pass, 0 fail** across 17 files
  (34 new gate tests included; schema-sync test confirms regenerated
  schemas match).
- E2E not run (M12 acceptance is unit-level; no live/network needed).

## Self-audit notes

- Fail-closed everywhere: malformed acks → exit 1; failing case with no
  history → no-history (exit 2 unless bootstrap allow); unknown `gh`/token
  state → fallback that still fails on any live failure, never silent
  green. The only deliberate fail-open is the absent-acks default, which
  the milestone explicitly requires (differs from IUMBTEMS).
- `liveRowsForVersion` excludes `skipped` rows both for current and
  history, so "no key" skips never trigger or dilute the gate; `gateApplies`
  likewise requires ≥1 non-skipped live row.
- Sticky-red edge: `baseline` uses the `window` runs preceding the current
  consecutive failure streak (streak counts the current failure plus
  leading consecutive history failures); acknowledged stable cases are
  green with the ack reason in the report.
- No `spawnSync`/`execSync` for `gh`; `Bun.spawn` with piped stdio only.
  No secrets logged (only the workflow/branch/repo names and reason
  strings).
- Not committed, per task instructions (`git status` shows only the M12
  files above).

## Cycle 2 (2026-10-17): verbatim port (M12 fix, uncommitted)

- **Source found:** the `review/IUMBTEMS` clone is now present.
  - `review/IUMBTEMS/packages/core/src/evals/gate.ts` (183 lines) ->
    `src/gate/verdict.ts` verbatim (5-line Apache header added; `diff` of
    the remaining 183 lines is empty).
  - `review/IUMBTEMS/packages/core/src/evals/exit.ts` (14 lines) ->
    `src/gate/exit.ts` verbatim (same header treatment; required by the
    ported tests' `decideEvalsExit` import).
  - `review/IUMBTEMS/packages/core/test/evals-gate.test.ts` (180 lines) ->
    `test/unit/gate-verdict.test.ts` verbatim except 2 re-pointed import
    lines (`diff` shows exactly those).
  - Reference used for history: `review/IUMBTEMS/scripts/e2e-gate.ts`
    (tally, conclusion filter, fail-closed acks, exit codes).
- **Reconciled (adapted call sites, verbatim file untouched):**
  `src/gate/history.ts` (now returns `GateHistoryRun[]` with real
  timestamps), `src/gate/gate.ts` (tally + verbatim verdict + exit mapping;
  absent-acks default and bootstrap-allow kept per SPEC/M12),
  `test/unit/gate.test.ts` (19 tests), `src/run.ts` log line, `NOTICE`,
  `biome.json` (verbatim files excluded from biome, still typechecked).
- **Discrepancies documented** in `docs/NOTES.md` ("M12 cycle 2" section):
  absent-file default (spec wins), strict ack schema (issue+date required,
  matches SPEC 7.2), `gate.window`/`gate.threshold` now inert (defaults
  equal upstream constants), `{exit, message}` verdict shape.
- **Test results:** `bun run check` green (exit 0) -- typecheck pass,
  `biome check .` pass (1 pre-existing deprecation info about
  `linter.rules.recommended`, unrelated), `bun test ./test/unit`
  **213 pass, 0 fail** across 17 files (16 verbatim gate tests + 19 gate
  orchestration/history tests; 35 gate tests total).
- **Not committed**, per task instructions. `git status` shows only M12
  files (modified: `NOTICE`, `biome.json`, `src/run.ts`, `src/config/schema.ts`, `schema/config.json`, `docs/NOTES.md`,
  `docs/reports/m12-implementation.md`; untracked M12 additions:
  `src/gate/`, `test/unit/gate*.test.ts`).
