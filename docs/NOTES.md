# Spike notes (M2)

Date: 2026-10-17. opencode: `opencode v2.0.26`
(`review/oc/node_modules/.bin/opencode --version` prints `opencode v2.0.26`).

Spike files (all under git-ignored `review/spike/`):

- `plugins/a/server.ts` — plugin `spike-a`: adds tool `spike_echo`
  (`input` JSON Schema `{type object, properties {text}, required [text]}`,
  `execute` returns `{content: "echo:"+input.text}`); `execute.before` hook
  appends `"+A"` to `input.text` when `i.tool` is `spike_echo`/`ns_spike_echo`.
  `SPIKE_NS=1` additionally declares `editor.namespace({name:"ns",
  description:"test"})` and adds the tool with `options:{namespace:"ns"}`.
  Transform is idempotent via `editor.get(...)` guards.
- `plugins/b/server.ts` — plugin `spike-b`: logs every `execute.before`
  `{tool, input}` as a JSON line to `$SPIKE_LOG`; no-ops when unset.
- `stub-llm.ts` — minimal OpenAI-compatible stub (`POST /v1/chat/completions`,
  `GET /v1/models`), SSE + non-streaming JSON, scripted steps, records bodies.
- `run.ts` — starts stub, writes sandbox config + project dir, spawns
  `opencode run --standalone --auto --format json --print-logs --log-level info`
  with async spawn + `stdio: ["ignore","pipe","pipe"]`, isolated `HOME`/`XDG_*`
  dirs, `OPENCODE_DISABLE_AUTOUPDATE=1`, `OPENCODE_DISABLE_MODELS_FETCH=1`,
  `TERM=dumb`. Parses stdout JSON lines; prints tool_use events, texts,
  `$SPIKE_LOG` lines and catalog paths.

## Step 4 — order [a, b] (hook mutation visible downstream)

Command: `bun run.ts --order a,b --name run-a-b` (evidence: `review/spike/runs/run-a-b/`)

- `tool_use` event for `execute`: `status=completed`,
  `input={"code":"return await tools.spike_echo({text:\"hi\"})"}`,
  `output="echo:hi+A"`. Inner calls:
  `[{"tool":"spike_echo","status":"completed","input":{"text":"hi+A"}}]`.
- `b` logged:
  `{"tool":"execute","input":{"code":"return await tools.spike_echo({text:\"hi\"})"}}`
  `{"tool":"spike_echo","input":{"text":"hi+A"}}`
- `texts: ["done"]`, `errorEvents: 0`, exit 0, no `ERROR`/`FATAL` in stderr.

## Step 5 — order [b, a] (hook order follows plugins array)

Command: `bun run.ts --order b,a --name run-b-a` (evidence: `review/spike/runs/run-b-a/`)

- Final output still `output="echo:hi+A"` (a mutates after b saw the input).
- `b` logged: `{"tool":"spike_echo","input":{"text":"hi"}}` (unmutated).
- Confirms IMPLEMENTATION_PROMPT §2.3: hooks run in config `plugins` order;
  a later plugin sees an earlier plugin's mutations.

## Step 6 — namespaced tool name forms

Source (before running): `review/opencode/packages/core/src/tool.ts`
`effectiveName = namespace.replaceAll(".","_") + "_" + normalizedName`;
`editor.namespace()` only registers the namespace declaration for catalog
display — the tool's name comes from `options.namespace` on `add`
(the builtin opencode plugin sets both). First `--ns` attempt with only
`namespace()` kept the catalog at `tools.spike_echo`; adding
`options:{namespace:"ns"}` namespaced it.

Command: `bun run.ts --order a,b --ns --name run-ns-call
--code 'return await tools.ns.spike_echo({text:"hi"})'`
(evidence: `review/spike/runs/run-ns-call/`; catalog captured in
`review/spike/runs/run-ns-discover/stub-requests.jsonl`)

Exact catalog block from the stub-recorded system text:

```
- ns (1 tool) // test
  - tools.ns.spike_echo({
  text: string,
}): Promise<string | null> // Echo the input text back
```

(Non-namespaced form, for comparison: `- spike_echo (1 tool)` /
`tools.spike_echo({...})` — matches IMPLEMENTATION_PROMPT §2.5.)

Calling through the exact catalog path `tools.ns.spike_echo` works
(`output="echo:hi+A"`). The same tool arrives under **three different
spellings** depending on where you look:

| Where | Value |
|---|---|
| Catalog call path (what the model sends) | `tools.ns.spike_echo` (dots) |
| `execute` result `metadata.toolCalls[].tool` (stdout `tool_use` event) | `ns.spike_echo` (dots) |
| `tool.hook("execute.before")` `i.tool` (probe/`$SPIKE_LOG`) | `ns_spike_echo` (effective name: `.`→`_`, `_`-joined) |

`b` logged `{"tool":"ns_spike_echo","input":{"text":"hi+A"}}`, and a's hook
matched on `ns_spike_echo` to apply the `+A` mutation. A wrong direct call
(`tools.spike_echo`) fails with:
`Unknown tool 'spike_echo'. Did you mean tools.ns.spike_echo?`

## Discrepancies / notes vs IMPLEMENTATION_PROMPT §2

- §2.6 asked how a namespaced tool's name appears in hooks: answer is the
  **effective name** `ns_spike_echo` (underscores), while the catalog and
  `metadata.toolCalls` use dots (`tools.ns.spike_echo` / `ns.spike_echo`).
  Assertion code must normalize between these forms.
- §2.4 API shapes all confirmed as written (`editor.namespace({name,
  description})` exists; `tool.transform` callback is sync, registration
  itself awaited; hooks receive mutable `input`/`tool` in before).
- `allowScripts` note (env setup, not opencode): current npm blocks
  `@opencode/cli` postinstall by default; `npm install-scripts approve
  @opencode/cli` (run inside `review/oc` with its own `package.json`) was
  needed before `./node_modules/.bin/opencode` appeared. The repo-root
  `package.json` picked up a transient `allowScripts` edit during the first
  attempt; it was reverted (`git status` clean except this file).

# M3 notes (2026-10-17): sandbox, binary resolution, events, logs

Files: `src/opencode/binary.ts`, `src/opencode/events.ts`,
`src/opencode/logs.ts`, `src/sandbox/sandbox.ts`,
`test/unit/logs.test.ts`, `test/unit/events.test.ts`,
`test/e2e/sandbox.test.ts`. `bun run check` green (17 unit tests pass);
e2e: 2 pass in ~2.6s wall (`OPENCODE_BIN=review/oc/...`).

## E2E timing (M3 acceptance)

`test/e2e/sandbox.test.ts` (Sandbox, no plugins, inline stub script
`[{text:"ok"}]`, prompt `"Say ok."`): `code=0`, `textOf` contains `"ok"`,
zero `error` events. A single `run()` takes ~1.2s wall
(`durationMs=1165`-1218); the two-test file runs in ~2.5-2.6s total.
opencode used: `opencode v2.0.26` via `OPENCODE_BIN`.

## Section 2.6 cache question: is @ai-sdk/openai-compatible downloaded per sandbox?

Answer: **no** (with the pinned binary). Evidence from a kept sandbox
(`OPENCODE_PLUGIN_CI_KEEP=1`, two consecutive `run()` calls):

- First run wall 1173ms, second run wall 1138ms -- no warm-up benefit.
- No `download`/`install`/`fetch` lines in stderr.
- Nothing named `*openai-compatible*` (no `.tgz`, no `node_modules`)
  anywhere under the sandbox root after the runs; `home/`, `cache/` and
  `state/` are empty (0 bytes), `data/` is 376K of opencode-internal state.
  The only thing opencode creates under the isolated `XDG_CACHE_HOME` is an
  empty `opencode/bin` dir.
- The provider package resolves from inside the opencode binary itself, so
  an isolated `XDG_CACHE_HOME` per sandbox costs nothing. No shared cache
  needed for speed; per-run temp dirs stay fast (~1.2s per `run()`).

# M11 notes (2026-10-17): live tier, judge, budget

Files: `src/tiers/judge.ts`, `src/tiers/live.ts`, wired into `src/run.ts`
(sequential tier 3 with a shared run-wide budget); tests
`test/unit/judge.test.ts`, `test/unit/live.test.ts`,
`test/e2e/judge.test.ts`. `bun run check` green (178 unit tests pass);
e2e judge-via-stub: 3 pass in ~3.7s wall (`OPENCODE_BIN=review/oc/...`).

## Judge prompt shape

`buildJudgePrompt` first line is exactly `OPENCODE_PLUGIN_CI_JUDGE` (the
`JUDGE_SENTINEL` constant, so the stub classifies the request as `judge`
even though the tool-less request would otherwise look like a title
request), then `Rubric:`, then non-empty evidence sections each clipped to
8000 chars, then the exact reply-contract line. `parseVerdict` takes the
first balanced `{...}` block (string-aware scan), requires boolean `pass`
+ string `reason`; anything else is
`judge reply was not valid JSON: <first 200 chars>`. Verified by unit
tests, including `pass: "true"` (string) rejected and prose `{this}`
before the JSON winning as the first block (spec: first block wins).

## Live run result: no key available

No `OPENCODE_API_KEY` (or any other live key) is set in this environment,
so the live tier was exercised through its skip path only -- no real model
was called and nothing is faked:

- `runLiveScenario` unit tests: no-key and budget-exhausted skips return
  before any spawn (binary paths point at `/nonexistent/...` to prove it).
- Manual CLI check: temp copy of the `tool-basic` fixture plus a live
  scenario (`live-smoke`: "Use the echo tool on the word hi and show me
  its output", expecting `tools: [{ name: echo_tool }]`),
  `bun bin/opencode-plugin-ci.ts run --tier live` with `OPENCODE_BIN`
  pointing at `review/oc` exits 0 and records
  `skipped: "no API key (set one of: OPENCODE_API_KEY)"` in results.json.
- `resolveModel` passthrough (`provider/model` used as is) is unit-tested.
  The `opencode models` listing path was probed manually: bare
  `opencode models` (2.0.26) prints one `provider/model` per line
  (`opencode-go/...`, `opencode/...`, plus third-party providers), which is
  what `resolveModel` parses; the bare-id and default-model branches have
  not run against a live key yet.

## `opencode models` observation (for `resolveModel`)

`opencode models` works with no config and no keys, printing one id per
line, e.g. `opencode-go/gpt-5.6-luna`, `opencode/claude-sonnet-5-5`.
`resolveModel` therefore spawns `<bin> models` with the live keys in env
(keys may widen the list), matches a bare id as a `/<id>` suffix
preferring `opencode-go/` then `opencode/`, and defaults to the first
`opencode/` line (logged) when no model is configured. Malformed lines
(any whitespace-free non-`a/b` shape) are ignored; a non-zero exit throws.

# M12 cycle 2 notes (2026-10-17): verbatim IUMBTEMS port

The `review/IUMBTEMS` clone is now available, so `src/gate/verdict.ts` was
replaced with a verbatim copy of
`review/IUMBTEMS/packages/core/src/evals/gate.ts` (5-line Apache header
added; `diff` of the remaining 183 lines is empty), `src/gate/exit.ts` is a
verbatim copy of `packages/core/src/evals/exit.ts` (needed by the ported
tests' `decideEvalsExit` import), and `test/unit/gate-verdict.test.ts` is a
verbatim copy of `packages/core/test/evals-gate.test.ts` with only the two
import paths re-pointed (`diff` shows exactly those 2 lines).
`src/gate/history.ts` and `src/gate/gate.ts` were reconciled to the verbatim
API (call sites adapted, verbatim file untouched).
`review/IUMBTEMS/scripts/e2e-gate.ts` was used as the history reference
(tally, conclusion filter, fail-closed acks, exit codes).

## Adaptations (minimal, rule 5)

- Import paths in the test copy only (see above). The verdict/exit sources
  have no imports, so nothing else needed changing.
- `biome.json` excludes the three verbatim files from `biome check` (same
  `!`-pattern mechanism already used for `review/`, `schema/`); they keep
  upstream's 2-space style. `tsc` still covers them.
- `src/gate/exit.ts` is a new file because the ported tests import
  `decideEvalsExit` from it; it is listed in NOTICE.

## Known gaps / discrepancies vs SPEC and M12 (rule 5)

- Absent acknowledgments file defaults to `{version:1,acknowledgments:[]}`
  in the `gate.ts` wrapper (unchanged from cycle 1). Upstream `e2e-gate.ts`
  fails when the file is absent; SPEC/M12 explicitly requires the default,
  so the spec wins and the verbatim file is untouched.
- The verbatim `parseAcknowledgments` requires non-empty `case`, `reason`,
  `issue` and a parseable `date` on every entry. This matches SPEC 7.2,
  which lists all four fields. The cycle-1 re-implementation had allowed
  `issue`/`date` to be omitted; that leniency is gone. One `gate.test.ts`
  case was updated to full entries, plus a new case pinning the strictness.
- Stability constants are now upstream's (>= 5 samples, >= 90% pass) instead
  of `gate.window`/`gate.threshold`. The config fields keep their defaults
  (5 / 0.9), so default behavior is identical; a custom window/threshold no
  longer takes effect (documented here rather than silently worked around).
- Verdict shape is now upstream's `{exit, message}` instead of
  `{status, reasons, failing}`; the `run.ts` log line and
  `formatGateSection` were adapted. Exit mapping is unchanged (0 green,
  1 regression, 2 no-history; bootstrap-allow turns 2 into 0 with a
  warning).
- `fetchHistory` now returns `GateHistoryRun[]` (the verbatim input type,
  with real `createdAt` timestamps so date-bound acknowledgments work)
  instead of row arrays, and skips runs whose conclusion is not
  success/failure (mirroring `e2e-gate.ts`).

# M13 notes (2026-10-17): composite action, docs, repo CI

Files: `action.yml` (new), `examples/workflow.yml` (new), `README.md`
(rewrite), `.github/workflows/ci.yml` (new). `bun run check` green
(213 unit tests pass); `actionlint` 1.7.12 passes on both workflow files.

## actionlint scope

`actionlint` only lints workflows, not composite actions, so it was run as
`actionlint .github/workflows/ci.yml examples/workflow.yml` (exit 0).
Running it on `action.yml` reports spurious "jobs/on section is missing"
errors because that file is a `runs.using: composite` action, not a
workflow. `action.yml` was instead checked by hand against the M13 spec:
inputs travel through `env:` (`IN_TIERS`, `IN_VERSIONS`, `ACTION_PATH`)
and are never interpolated into a `run:` script; `bun install
--frozen-lockfile` runs in `${{ github.action_path }}` before the run step.

## gate.artifact wiring (already in place, verified not added)

`src/config/schema.ts` already defaults `gate.artifact` to
`opencode-plugin-ci-results` (M12), `src/gate/gate.ts` passes
`ctx.config.gate.artifact` as `fetchHistory({ artifact, ... })`, and
`src/gate/history.ts` downloads with `gh run download <id> --name
<artifact>`. The action's new `artifact-name` input defaults to the same
string, so no code changes were needed — only the README matrix
instructions (distinct `artifact-name` per leg + the same value in that
leg's `gate.artifact`).

## README quickstart verification (local-bin substitution)

`bunx @heretek-ai/opencode-plugin-ci` requires the package to be published,
which it is not yet, so the quickstart was followed literally in a fresh
`/tmp` copy of `test/fixtures/plugins/tool-basic` with `bun
<repo>/bin/opencode-plugin-ci.ts` in place of `bunx ...` and
`OPENCODE_BIN=<repo>/review/oc/...`: `init --force` (exit 0),
`validate` (exit 0, resolves `src/server.ts` via the fixture's
`exports["./server"]`), `run --scenario example` (exit 0, tier 1 + example
scripted pass, `report.md` written with 2 passed / 0 failed). Two things
the copy taught the README:

- `init` refuses to overwrite an existing `.opencode-ci/`, so the
  quickstart uses `init --force` (identical on a fresh plugin) with a note.
- `init` only adds starter files; the fixture's deliberate `fail.yaml`
  stays, so the quickstart runs `--scenario example` (the scaffolded
  starter) rather than the full suite. Full `run` in the unmodified fixture
  still exits 1 on `tool-basic-fail` by design.

# M14 notes (2026-10-17): final pass

`bun run check` green (exit 0: typecheck + `biome check` clean, 213 unit
tests pass). `bun run test:e2e` with
`OPENCODE_BIN=review/oc/node_modules/.bin/opencode` green (exit 0: 24
pass, 0 fail, ~26s). `bun scripts/gen-schema.ts` produces no diff
(schemas in sync; `schema-sync.test.ts` also passes). README quickstart
re-verified literally in a fresh copy of the `tool-basic` fixture
(`init --force` / `validate` / `run --scenario example`, all exit 0).
`LICENSE` (MIT), `NOTICE` (all four ported paths) and Apache headers on
`src/gate/verdict.ts`, `src/gate/exit.ts` and the ported test are present.
Milestone commits M1–M13 exist on `impl/v1`; M14 leaves the tree as-is
(coordinator commits/opens the PR). SPEC re-read top to bottom; every
statement not listed under "Known gaps" below was confirmed in code.

## Known gaps (SPEC statements the code does not fully implement)

- SPEC 6.4: tier 1 ignores `expect.providers`/`expect.models` — the probe
  records no provider/model inventory and `runLoad` never asserts on them;
  provider plugins therefore get load checks for registration only.
- SPEC 6.2: evidence dirs contain `events.jsonl`, `probe.jsonl`,
  `stub-requests.jsonl`, `stderr.log` but no `workspace.tar` (failures
  only) and no per-scenario `result.json` (only the top-level
  `results.json`).
- SPEC 6.5: the report does not flag `webfetch`/`websearch` `tool_use` in
  scripted scenarios; network use is observable only via raw evidence.
- SPEC 5.3: the snippet's API names are illustrative — actual exports are
  `new Sandbox(...)` (no `Sandbox.create`), `readProbe` (no `loadProbe`),
  `evaluate`/`check` (no `assert`); README documents the real API.
- SPEC background table: `ctx.storage` is not snapshotted into evidence;
  no assertion surface exists for it.
- SPEC 9: no dogfood scheduled workflow over `awesome-opencode`; only
  `.github/workflows/ci.yml` exists (validation-plan aspiration, outside
  M1–M13 scope).
- SPEC 8: the Action has no `config` path input (config is always resolved
  under `working-directory`) and its `result` output emits only
  `pass`/`fail`, never `skipped`.
- SPEC 3.3 (deviation, benign): the probe redacts
  `/KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE/i`, a fail-closed superset of
  the spec's `/KEY|TOKEN|SECRET|PASSWORD/i`.
- Carried from M12: custom `gate.window`/`gate.threshold` no longer take
  effect (verbatim upstream verdict hard-codes >= 5 samples, >= 90%);
  defaults (5 / 0.9) keep default behavior identical.
