# Review: opencode-plugin-ci v1 (PR #4, merged at `af6675c`)

Reviewed on 2026-10-18 from a fresh clone of `main`. The review was read-only: nothing was committed and the tree stayed clean (`git status --short` showed nothing). The baseline is `docs/SPEC.md` and `docs/IMPLEMENTATION_PROMPT.md` (the brief).

**Verdict: NEEDS-WORK.** The components are well built and well tested. The orchestration layer, which nothing tests, has four blockers. I reproduced each blocker with a throwaway fixture.

## 0. What I re-ran

| Claim | Result |
|---|---|
| `bun run check` with 213 unit tests passing | Confirmed: 213 pass, 0 fail (typecheck and biome clean) |
| `bun run test:e2e` with 24 passing | Confirmed: 24 pass, 0 fail, 32.8s, using `@opencode/cli@2.0.26` |
| Schemas are in sync | Confirmed: `bun scripts/gen-schema.ts` left `schema/` unchanged |
| GitHub CI | Green: `check` and `e2e` passed on the PR head and on the merge commit |
| `verdict.ts` is a verbatim copy | Confirmed. With the 5-line header removed, it diffs empty against IUMBTEMS `packages/core/src/evals/gate.ts` (c6455bf). The same holds for `exit.ts`. The test copy differs only in its 2 import lines |
| No `${{ inputs.* }}` inside `run:` blocks | Confirmed. Inputs reach the script only through `env:`, and `bun install --frozen-lockfile` runs in `github.action_path` |

## 1. The 9 known gaps

| # | Gap | Verdict | Evidence |
|---|---|---|---|
| 1 | Tier 1 ignores `expect.providers` and `expect.models` | **Understated** | The schema accepts both (`src/config/schema.ts:41-42`), and README.md:82-83 advertises them "for provider plugins (tier 1)". A provider plugin's expectation therefore passes silently. The fields should be rejected until they are implemented |
| 2 | No `workspace.tar` and no per-scenario `result.json` | Accurate | Evidence dirs contain only events, probe, stub-requests and stderr |
| 3 | No flag for `webfetch` or `websearch` use in scripted runs | Accurate | Nothing in `src/report/markdown.ts` inspects tool names |
| 4 | The SPEC 5.3 API names were illustrative | Accurate | The exports in `src/index.ts` match the README. Gap list misses that the `bun:test` escape hatch it points to is broken (blocker B3 below) |
| 5 | `ctx.storage` is not snapshotted | Accurate | Minor |
| 6 | No dogfood workflow | Accurate | This is my brief's fault: M13 never asked for it, although SPEC 10.8 does |
| 7 | The Action has no `config` input and never outputs `skipped` | Accurate | My brief's `action.yml` template had the same omissions (`action.yml:20-23`, `:55`) |
| 8 | The redaction regex is wider than the SPEC's | Accurate and benign | The brief asked for the wider regex. SPEC 3.3 should be updated to match |
| 9 | Custom `gate.window` and `gate.threshold` have no effect | **Understated, and the reason is half wrong** | The fields are still accepted (`schema.ts:60-61`) and documented (README:92-93), so a custom value is silently ignored. Only the sticky-red helper inside the verbatim file hard-codes 5 and 0.9 (`verdict.ts:135`). The main `stable` list is built in the non-verbatim wrapper (`src/gate/gate.ts:309`). Best fix: remove both fields from the schema, README and SPEC, so a custom value fails validation instead of doing nothing |

## 2. New gaps

### Blockers

**B1. Entries are resolved before install and build run, so compiled plugins can never run in CI.** `src/run.ts:171` resolves the entry before running the build at `:178-185`. In a fresh checkout, `dist/` does not exist yet, so a plugin whose `main` or `exports` points at `dist/server.js` exits 2 with "No server entry" before its build ever runs. Reproduced: a plugin with `"main": "./dist/server.js"` and `build: mkdir -p dist && cp src/server.js dist/server.js` exits 2, and `dist/` is never created. This is the most common real plugin layout, and the README's own example (`entry: dist/server.js`). **This one is my fault:** step 2 of the brief's M10 `run.ts` order put resolution before the build. SPEC 6.1 has the order right.

**B2. Tier 1 ignores `plugin.entry`.** `src/tiers/load.ts:62` calls `resolveEntries(pluginPath)` without the explicit entry, and `RunLoadOptions` has no field to pass it in. Reproduced: with `plugin.entry: src/plugin.ts` and an empty `package.json`, `validate` exits 0 but `run --tier load` exits 2. When `package.json` points at a different file, tier 1 silently tests that file while tiers 2 and 3 test the configured one.

**B3. The `bun-test` escape hatch can never pass.** `src/run.ts:391` runs `bun test .opencode-ci`. Bun 1.4.2 skips dot-directories when it discovers tests, so this always fails with "The following filters did not match any test files … .opencode-ci", even when every test passes. Any repo that uses the documented escape hatch is permanently red. Verified fix: pass each discovered file as an explicit `./`-relative path. `bun test ./.opencode-ci/x.test.ts` runs the file and passes or fails correctly.

**B4. Running out of budget hides a failed live attempt.** `src/tiers/live.ts:308-323` returns `pass: true, skipped: "budget exhausted"` even after attempts have already failed. Reproduced with a fake opencode binary that reports a cost of $1.50 against a $1 budget: attempt 1 failed (`expected count >= 1, got 0`), the case was reported as skipped, and the run exited 0. The gate never saw the failure, because `gateApplies` ignores skipped rows. A CI tool must never turn a recorded failure green.

### Should-fix

- **S1. The live budget resets for each opencode version.** `src/run.ts:300` creates the budget inside the version loop. SPEC 5.1 calls it a "hard stop for the whole live tier" and the brief calls it a "run-wide counter". With `["2.0.26", "latest"]`, spend can reach twice the budget, partly on a version whose failures are allowed anyway.
- **S2. A typo in `plugin.entry` silently falls through to auto-detection** (`src/plugin/entry.ts:169-177`). If `index.ts` exists, the wrong file is tested and nobody is told. This breaks the "typos never silently pass" rule. An explicit entry that does not exist after the build should be a configuration error.
- **S3. Some config fields are accepted but never read.** Besides gaps 1 and 9 above: `live.timeoutMs` (`schema.ts:53`) is never used, because live attempts use `scenario.timeoutMs`. `judgeReply` on scripted scenarios (`schema.ts:229`) is passed to the stub, but scripted mode never sends a judge request, so it has no effect. My brief was inconsistent on `judgeReply`. Reject each of these fields or wire it up.
- **S4. Negative matchers pass when the value is missing.** `src/assert/matchers.ts:110-118` and `:133-144` convert `undefined` to the string `"undefined"`. So `input: { comand: { notContains: secret } }` (note the typo) passes. In the spec's flagship "redacts secrets" example, that is a silent pass on the one assertion that matters. A missing value should fail every matcher except `exists: false`.
- **S5. Namespaced tool names are not normalized in assertions.** `src/assert/expect.ts:159-161` compares `call.tool === tool.name` exactly. The M2 notes show the hook sees `ns_spike_echo`, while the script auto-wrap and `request.tools` accept `spike_echo`. So `expect.tools: [{ name: spike_echo }]` fails with a count of 0 for a namespaced tool, and the README does not mention this. Match the way `findCatalogPath` does: exact name, last segment, or `_`-joined form.
- **S6. The gate finds no history on pull requests** (inferred from GitHub's docs, not run). `src/gate/gate.ts:204` filters history with `GITHUB_REF_NAME`. On `pull_request` events that value is `<n>/merge`, but `gh run list --branch` matches head branch names. So a live failure on a same-repo PR always exits 2. With `bootstrap: allow`, every PR live failure passes forever. The upstream gate has the same behavior, but it only runs on `main`. My brief copied it. Use base-branch history (`GITHUB_BASE_REF`) on PRs.
- **S7. Gate history cannot be wired up for matrix builds.** The `artifact-name` input (`action.yml:17-19`) is never passed to the CLI, and `gate.artifact` lives in the one config file that every matrix leg shares. Distinct names per leg therefore cannot match, and README.md:274-292 admits as much. This design came from my brief. Fix: the Action passes its artifact name to the CLI (a new `--gate-artifact` flag, or an env var), and that value overrides the config.
- **S8. The orchestration has no tests** (details in section 3).

### Nits

- `pluginLogProblems` matches only the shim path (`src/tiers/load.ts:152-155`). An `ERROR` line that names the real `src/server.ts` but not the plugin id is missed.
- Every evidence dir holds two copies of the probe log, one named `probe-live.jsonl` even in tiers 1 and 2 (`scripted.ts:50`, `load.ts:84`).
- `workspace` keys are not checked for `..` (`src/sandbox/sandbox.ts:108-112`), though `files` paths are (`expect.ts:324`).
- With `OPENCODE_PLUGIN_CI_JUDGE_VIA_STUB` set, the stub judge defaults to `{"pass":true}` (`judge.ts:193`). The default should be a fail.
- An install or build failure is reported as "Configuration error" with exit 2, and no report is written (`src/plugin/install.ts:55`).
- `run --scenario <typo>` runs nothing and exits 0 (`run.ts:202-205`).
- Results record `opencode` as the requested string (`latest`), not the resolved version the brief asked for (`run.ts:212`).
- The "using defaults" warning prints twice (`config/load.ts:101` and `run.ts:165`).
- The comment at `codemode.ts:11-17` says the brief's regex captured the `(`. It didn't. The code is still correct.
- The `tool-direct` fixture doesn't prove the tool is direct: `request.tools` includes catalog names (`expect.ts:130-144`). Adding `noTools: [execute]` would prove it.
- Gate temp dirs are never cleaned up, and each of the 15 history runs downloads the full evidence artifact (`history.ts:155-156`).

## 3. Test quality

The component suite is good:
- The gate tests are a verbatim port.
- Schema, matchers, entry resolution, events, logs and the report snapshot have real branch coverage.
- The parsers are tested against captured opencode output.
- The e2e suite runs every fixture's happy path and the tier 1 failure modes against the real binary.

The orchestrator is not covered:
- `run.ts` has no tests for its step order, exit codes, required versus allowed versions, or the skip after a failed tier 1.
- The live attempt loop has no tests. `live.test.ts` covers only the two skip paths, and the loop is where B4 sits.
- The `bun-test` case has no tests.
- No run-level test uses `plugin.entry` or a build step.
- `action.yml` is never exercised; no CI job runs `uses: ./`.

All four blockers sit in this uncovered layer, which is why "213 + 24 green" coexists with them. Negative coverage is also thin. SPEC 9 asks for passing and deliberately failing scenarios per fixture, but only `tool-basic` has a failing scenario. The other pass scenarios do mix positive and negative matchers, so they are not vacuous.

**Verdict:** adequate for components, inadequate for the orchestrator.

## 4. Security

No blockers.

- The sandbox env is an allowlist: PATH, the XDG dirs and the configured live keys only (`sandbox.ts:134-146`). I ran a canary key through a sandbox at `--log-level info` and `all`. It never appeared in stdout, stderr or the recorded model requests.
- The probe redacts env values and headers whose names look secret. Tool inputs and outputs are recorded as they are, which is what SPEC promises. A scenario that runs `env` would therefore put the key into `events.jsonl` and `probe.jsonl`, which the Action uploads. The README tells authors never to print secrets; consider redacting known live-key values from evidence before upload.
- The README warns against `pull_request_target` (README:323), and the example workflow sets `actions: read` and nothing broader.
- The judge is plugin-free and tool-less (a deny-all agent), runs only after the deterministic checks pass, and treats an invalid reply as a fail.
- Install, build, the static TUI import and `bun test` inherit the full environment, including `GH_TOKEN` and the live keys. They run the PR's own code, so this is not an escalation. Scoping `GH_TOKEN` to the gate would still be tidier.

## 5. Overall: NEEDS-WORK

Top 3 follow-ups, written as junior-agent tasks:

1. **Fix the run order and entry plumbing (B1, B2, S2).**
   - In `src/run.ts`, run `plugin.install` and `plugin.build` *before* `ensureEntriesOrThrow`.
   - Add `serverEntry: string` to `RunLoadOptions` in `src/tiers/load.ts`, delete its internal `resolveEntries` call, and pass `entries.server` from `run.ts`.
   - In `resolveEntries`, throw `ConfigError("plugin.entry <path> does not exist")` when an explicit entry is not a file.
   - In `cmdValidate`, when no entry resolves and `plugin.build` is set, print a warning ("entry may be created by the build") and exit 0.
   - Add two e2e fixtures:
     - `built-entry`: `"main": "./dist/server.js"`, a build that copies `src/server.js` into `dist/`, and `dist/` git-ignored.
     - `explicit-entry`: `plugin.entry: src/plugin.ts` and no `main`.
   - Assert that `run --tier load` exits 0 in a clean temp copy of each fixture.
2. **Fix `bun-test` discovery (B3).**
   - In `src/run.ts`, replace `["bun", "test", ".opencode-ci"]` with `["bun", "test", ...testFiles.map((f) => "./" + relative(cwd, f))]`.
   - Add e2e tests on a temp copy of `tool-basic`:
     - a passing `.opencode-ci/ok.test.ts` makes the `bun-test` case pass;
     - a failing one makes it fail, with the failing test's name in `failures`.
3. **Fix the live budget and test the attempt loop (B4, S1).**
   - In `runLiveScenario`, when the budget is exhausted and `attempts.length > 0`, return `pass: false` with "budget exhausted after N attempt(s): k passed, needed p". Return `skipped` only when no attempt ran.
   - In `run.ts`, create the budget once, above the version loop.
   - Add unit tests that drive `runLiveScenario` with a fake opencode shell script, as in this review's reproduction. The script prints a `text` event and a `step_finish` event with a chosen `cost`. Cover:
     - 2 of 3 attempts passing;
     - early stop after 2 passes;
     - early stop once passing is impossible;
     - the judge not running when the deterministic checks fail;
     - the budget running out mid-scenario, which must fail;
     - one budget shared across two versions.

After these three, I'd handle the rest as one batch: reject the ignored config fields (S3, gaps 1 and 9), fail matchers on missing values (S4), normalize namespaced names (S5), and fix gate history on PRs and in matrix builds (S6, S7).
