# M11 Implementation Report — Live tier, judge, budget

- **Stage ID:** M11 (`src/tiers/live.ts`, `src/tiers/judge.ts`, `src/run.ts`
  wiring, unit/e2e tests, `docs/NOTES.md` live result)
- **Date:** 2026-10-17
- **Branch:** `impl/v1` (not committed, per task instructions)

## Summary

Implemented the M11 live tier: per-scenario k-of-n attempts against the real
model with a shared run-wide USD budget, model resolution via
`opencode models`, a plugin-free tool-less judge run that grades recorded
evidence against a rubric, and fail-closed skips (no key, budget exhausted)
that never fail the run. Acceptance verified: unit tests for
`buildJudgePrompt` + verdict parsing (valid, invalid, prose-wrapped, string
`pass` rejected), offline e2e judge runs through the stub via the hidden
`OPENCODE_PLUGIN_CI_JUDGE_VIA_STUB=1` hook, live-skip unit tests that return
before any spawn, and a manual CLI `--tier live` run recording "no key
available" in `docs/NOTES.md` (no key exists in this environment; nothing
faked).

## Files created

- `src/tiers/judge.ts` — `JUDGE_SYSTEM` (exact M11 string),
  `JUDGE_AGENT = "opencode-plugin-ci-judge"`,
  `buildJudgePrompt({rubric,text,toolCalls,hookSummary,files})` (first line
  is the `OPENCODE_PLUGIN_CI_JUDGE` sentinel, then the rubric, then
  non-empty evidence sections each clipped to 8000 chars, ending with the
  exact reply-contract line), `parseVerdict(text)` (first balanced `{…}`
  block via a string-aware scan, requiring boolean `pass` + string
  `reason`; anything else is
  `judge reply was not valid JSON: <first 200 chars>`), and
  `runJudge(opts)` (fresh sandbox with **no plugins**, deny-all judge
  agent, `agent: judge`, `auto: false`; returns `{verdict, costUSD, tokens,
  rawText}`; writes `judge-prompt.txt`/`judge-events.jsonl`/
  `judge-stderr.log` when `evidenceDir` is set). When
  `OPENCODE_PLUGIN_CI_JUDGE_VIA_STUB=1`, the sandbox uses the stub with
  `judgeReply` (test-only hook; production never sets it).
- `src/tiers/live.ts` — `LiveBudget {spent, limit}`,
  `collectLiveKeys(config)` (values only enter the sandbox env; only names
  surface in messages), `noKeySkipReason` /
  `budgetExhaustedReason` formatters, `resolveModel({opencodeBin, keys,
  preferred?})` (`a/b` used as is; otherwise `opencode models` spawned
  async in a throwaway dir with keys in env, bare id matched as a `/<id>`
  suffix preferring `opencode-go/` then `opencode/`, missing preference
  defaults to the first `opencode/` line and logs which; throws descriptive
  errors otherwise), and `runLiveScenario(opts)` (per-attempt fresh
  sandbox with `liveModel` + keys, same `evaluate()` as tier 2 with
  `stubRequests: []`, early stop on `pass` reached or passing impossible,
  budget check before each attempt, judge only when deterministic checks
  passed **and** a rubric exists, judge cost added to the budget, per-attempt
  `attempt-N/` evidence dirs, `CaseResult` with `tier: "live"`, `attempts`,
  summed cost/tokens/steps, last judge verdict).
- `test/unit/judge.test.ts` — prompt shape (sentinel first line, reply
  contract last, section inclusion/omission, 8000-char clip, stub
  classifies the prompt as `judge`, exact `JUDGE_SYSTEM`) and verdict
  parsing (valid, prose-wrapped, string-`pass`/missing-reason/malformed/
  absent/unbalanced rejected with the exact prefix, braces-in-strings
  scan, first-block-wins).
- `test/unit/live.test.ts` — key collection (set/unset/empty), skip-reason
  formats (names, never values; `$x` money format), model passthrough
  without spawning, and no-key / budget-exhausted skips using
  `/nonexistent/` binary paths to prove no spawn happens.
- `test/e2e/judge.test.ts` — `runJudge` against the real binary offline via
  the stub hook: passing reply → `{pass:true, reason:"ok"}`, failing reply
  → `{pass:false}`, non-JSON reply → failed judgement.

## Files modified

- `src/run.ts` — replaced the M10 live placeholder with the real tier 3:
  per version, collect keys (none → every live scenario
  `skipped: "no API key (set one of: …)"`); resolve the model once
  (failure → one failed `CaseResult` per live scenario, contained);
  otherwise run scenarios **sequentially** sharing one `LiveBudget`
  (pre-check per scenario → `skipped: "budget exhausted ($x of $y)"`).
  Tier-1-failure and TUI-only skips, the `--gate` M12 warning, and exit-code
  logic are unchanged.
- `src/index.ts` — re-exported the judge/live API (`buildJudgePrompt`,
  `parseVerdict`, `runJudge`, `JUDGE_SYSTEM`, `JUDGE_AGENT`,
  `resolveModel`, `runLiveScenario`, `collectLiveKeys`,
  `noKeySkipReason`, `budgetExhaustedReason`, plus option/result types).
- `docs/NOTES.md` — M11 section: judge prompt shape, verdict-parser edge
  cases, the "no key available" live result with the manual CLI evidence,
  and the `opencode models` output observation behind `resolveModel`.

## Test results

- `bun run check` — green: `tsc --noEmit` clean, `biome check .` clean
  (one pre-existing info: `recommended` deprecation in `biome.json`),
  **178 unit tests pass, 0 fail** (15 files).
- `bun test ./test/e2e/judge.test.ts` — **3 pass, 0 fail** (~3.7s).
- Regression: `test/e2e/tier2.test.ts` **7 pass** (~10s),
  `test/e2e/cli.test.ts` **4 pass** (~5s).
- Manual: temp copy of `tool-basic` + one live scenario,
  `run --tier live` (no key) exits 0, results.json holds
  `skipped: "no API key (set one of: OPENCODE_API_KEY)"`.
- Live with a real key: **not run — no key available** in this
  environment (recorded in `docs/NOTES.md`; nothing faked).

## Self-audit notes

- Fail-closed: no key → skip (not pass-with-evidence); budget checked
  before every attempt and every scenario; model-resolution and judge
  failures produce descriptive failed judgements/cases, never silent
  passes. Schema already forbids `expect.request` in live mode and
  `judge`/`judgeReply` cross-mode misuse.
- Secrets: key values flow only into sandbox `env`; skip messages, logs,
  and errors carry key **names** only (unit-tested: value absent from the
  reason string). Evidence files contain no secrets beyond what the
  scenario itself writes.
- Async spawn only (`spawn`, never `spawnSync`) in `listModels`; the stub
  hook keeps `runJudge` offline-capable without touching production code
  paths.
- One deliberate deviation: `resolveModel` is called **once per version**
  in `run.ts` (not per scenario) and the result is passed into
  `runLiveScenario` via `opts.model`, so a run with N live scenarios does
  one `opencode models` call instead of N; per-scenario resolution remains
  available when `model` is omitted.
- Known gap: the bare-id and default-model `resolveModel` branches and the
  live judge against a real model have not run against a live key yet
  (no key available); they are covered by unit tests and the offline stub
  path respectively.
- Not committed, per task constraints (`git status` shows only the M11
  files above).
