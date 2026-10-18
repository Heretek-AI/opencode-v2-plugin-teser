# Fix brief: opencode-plugin-ci v1.1

You are fixing `@heretek-ai/opencode-plugin-ci` v1 (merged in PR #4 at `af6675c`). A review found five blockers and a set of smaller problems in the layer that ties the components together: the run order, entry plumbing, the `bun-test` case, the live budget, re-runs into the same output dir, and the GitHub Action wiring. This brief tells you exactly how to fix each one and how to prove it.

Read this entire file before you change any code. Every code block in it was applied to a fresh copy of `main` at `af6675c` and tested, milestone by milestone, on 2026-10-18 with Bun 1.4.2 and `@opencode/cli@2.0.26`. Your training data does not know this project or opencode v2. Do not "improve" the code blocks from memory; copy them exactly.

The review itself is `docs/reports/review-v1.md`. `docs/SPEC.md` was already updated to describe the fixed behavior (decisions 14 to 25 in its section 11). When this brief and SPEC disagree, stop and write it in `docs/NOTES.md`.

---

## 0. How to work

1. **Work in milestones, in order.** Each milestone has **Do** and **Acceptance**. A milestone is done only when every acceptance command gives the stated result. Do not start the next milestone until then.
2. **Test first.** Most milestones start by adding a test file. Run it and confirm it fails the way the milestone says *before* you change any source file. A test that passes before the fix proves nothing; if that happens, stop and write it in `docs/NOTES.md`.
3. **Commit once per milestone**, with a message that starts with the milestone id, for example `v1.1 M3: build before resolving entries`. Stage files explicitly by path; never use `git add -A` or `git add .`. Never commit anything under `review/` or any `.opencode-ci/out/` dir.
4. **Never skip, delete or weaken a test** to get green, and never add `.skip`, `.todo` or `.only`. The only tests you may change are the ones this brief tells you to change, in the way it shows.
5. **How to apply the code blocks.** Code blocks come in three kinds. The tag after the language says which:
   - `file:<path>`: create the file at `<path>` (relative to the repo root) with exactly this content, plus a final newline.
   - `find:<path>` followed by `replace:<path>`: in `<path>`, find the text of the `find` block (it occurs exactly once) and replace it with the text of the `replace` block. Copy both exactly, including blank lines.
   - Anything without a tag is an example or a command to run.
6. **This repo indents TypeScript with tabs**, and Biome checks it. After editing files, run `bun run format`. If `bun run lint` still fails, read its message; never disable a rule.
7. **Do not invent APIs.** Everything you need is in this file or already in the repo. If you need something else, look it up in this order: the repo's own `src/`, the `@opencode/plugin` types in `node_modules/@opencode/plugin/dist/`, the opencode source at `review/opencode`, then a throwaway experiment under `review/`. Record what you learned in `docs/NOTES.md` with the evidence.
8. **If something here turns out to be wrong**, stop, write the discrepancy and its evidence in `docs/NOTES.md`, make the smallest change that matches reality, and continue.
9. **If you are stuck** for three attempts on the same error, write what you tried in `docs/NOTES.md`, commit what works, and stop with a summary.
10. **Never delete anything outside the evidence dir you are resetting.** The new `resetDir` helper refuses paths outside the output dir; never remove or weaken that check.

---

## 1. Paths and setup

- **Repository** (your working directory): `/home/john/Projects/opencode-v2-plugin-teser`
- **Scratch area** (git-ignored, never committed): `/home/john/Projects/opencode-v2-plugin-teser/review/`
  - The opencode v2 source is at `review/opencode`.
  - The pinned opencode CLI from v1 work is at `review/oc/node_modules/.bin/opencode`. If it is missing, install it:
    ```bash
    mkdir -p review/oc && cd review/oc && npm install --no-save @opencode/cli@2.0.26 && cd ../..
    ```
- **Branch:**
  ```bash
  cd /home/john/Projects/opencode-v2-plugin-teser
  git checkout main && git pull
  git checkout -b fix/v1.1
  ```
  `main` must contain this file, `docs/reports/review-v1.md` and the updated `docs/SPEC.md`. If `ls docs/IMPLEMENTATION_PROMPT_v1.1.md docs/reports/review-v1.md` fails, stop: the PR that adds them is not merged yet.
- **Environment for every command below:**
  ```bash
  export OPENCODE_BIN=/home/john/Projects/opencode-v2-plugin-teser/review/oc/node_modules/.bin/opencode
  ```
- **Toolchain checks** (expected output after `#`):
  ```bash
  bun --version                 # 1.4.2 (any 1.4.x is fine; record the exact value in NOTES.md)
  "$OPENCODE_BIN" --version     # opencode v2.0.26
  bun install --frozen-lockfile # no changes
  ```

No new dependencies are needed. Do not add any.

---

## 2. Verified facts

### 2.1 The five blockers, as reproduced on `main`

| Id | What happens on `main` | Root cause |
|---|---|---|
| B1 | A plugin whose `main` is `./dist/server.js` with a `plugin.build` that creates `dist/` exits 2 with "No server entry", and `dist/` is never created | `src/run.ts` resolves entries before it runs install and build |
| B2 | With `plugin.entry: src/plugin.ts` and an empty `package.json`, `validate` exits 0 but `run --tier load` exits 2 | `src/tiers/load.ts` resolves its own entry without `plugin.entry` |
| B3 | The `bun-test` case always fails with "The following filters did not match any test files", even when every test passes | `run.ts` runs `bun test .opencode-ci`, and bun skips dot-directories |
| B4 | A live scenario whose attempt failed is reported as `skipped: budget exhausted` and the run exits 0 | `src/tiers/live.ts` returns a skip when the budget runs out, even after attempts ran |
| B5 | Re-running into the same out dir evaluates the previous run's probe records: a plugin broken between two runs still passes | The probe appends to `probe.jsonl`, and no tier empties its evidence dir |

### 2.2 Bun skips dot-directories (B3)

Verified with Bun 1.4.2. In a directory that contains only `.opencode-ci/ok.test.ts` (a passing test):

```
$ bun test .opencode-ci; echo "exit=$?"
bun test v1.4.2 (744846f84)
The following filters did not match any test files in --cwd="…/dot":
 .opencode-ci

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")

exit=1

$ bun test ./.opencode-ci/ok.test.ts; echo "exit=$?"
bun test v1.4.2 (744846f84)

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file. [3.00ms]
exit=0
```

An explicit `./`-relative file path works. A directory filter never does.

### 2.3 Stale evidence (B5)

Verified on `main` with the real opencode binary, using a copy of the `tool-basic` fixture and `--out` pointed at the same dir twice:

| Run | Plugin | `--out` | Exit code | Correct? |
|---|---|---|---|---|
| 1 | as shipped | `stale-out` | 0 | yes |
| 2 | tool renamed to `echo_tool_renamed` | `stale-out` (reused) | **0** | **no** |
| 3 | tool renamed | `stale-out-fresh` | 1 | yes |

After run 2, `stale-out/2.0.26/tool-basic-pass/probe.jsonl` holds 2 inventory records (one per run); a fresh run holds 1. The scenario's `tools` assertion matched run 1's `echo_tool` calls.

### 2.4 Names, refs and env

- **Namespaced tool names.** opencode records a tool registered with `options: { namespace: "ns" }` under its effective name `namespace.replaceAll(".", "_") + "_" + name.replace(/[^a-zA-Z0-9_-]/g, "_")`, for example `ns_spike_echo`. That is what `tool.hook` and so the probe see. The Code Mode catalog shows `tools.ns.spike_echo(` and inner calls show `ns.spike_echo`. (v1 NOTES.md, step 6, from `review/opencode/packages/core/src/tool.ts`.)
- **GitHub refs.** On `pull_request` runs, `GITHUB_REF_NAME` is `<pr number>/merge`, and `GITHUB_BASE_REF` / `GITHUB_HEAD_REF` are set. On `push` runs, `GITHUB_BASE_REF` is empty. `gh run list --branch 4/merge` returned `[]` for this repo, while `gh run list --branch impl/v1` returned both the PR and push runs. So gate history for a PR must come from the base branch.
- **The sandbox env is an allowlist** (`PATH`, the XDG dirs and the configured live keys only; `src/sandbox/sandbox.ts`). A fake opencode binary therefore cannot receive settings through env vars. The fake in M2 gets its plan path as an argument baked into a wrapper script.
- **The probe writes JSON** (not JSONC) to `$XDG_CONFIG_HOME/opencode/opencode.jsonc`, so the fake can `JSON.parse` it.
- **Composite Action outputs on failure.** With `continue-on-error: true` on a `uses:` step, the step's `outcome` is `failure` and its `conclusion` is `success`. The `act` runner fixed "set composite outputs on failure" (nektos/act #945) to match GitHub, whose runner still sets a composite's outputs when an inner step fails. This was not run on GitHub (see 2.6).

### 2.5 Exact messages the new code produces

Tests and fixtures below assert these strings. Use them verbatim.

| Where | Message |
|---|---|
| Missing `plugin.entry` | ``plugin.entry "src/typo.ts" does not exist (resolved to /abs/src/typo.ts). Fix the path, or check that plugin.build creates it.`` |
| Failing build | `build step failed (exit 3): exit code 3.` (a `StepError`, exit 1) |
| Unknown `--scenario` | `unknown --scenario id(s): smok (known: smoke).` (a `ConfigError`, exit 2) |
| Bad `--opencode` | `Invalid --opencode "../..": expected x.y.z or "latest".` (exit 2 with usage) |
| Reserved id | `scenario "load": id "load" is reserved (the tool uses it for its own case and evidence dir)` |
| Workspace path | `scenario "ws": workspace path "../escape.txt" must be relative and stay inside the project dir` |
| Missing value | `input.comand: no value was recorded (check the field name).` |
| Namespaced hint | `tools[0].spike_echo: namespaced tools are recorded as <namespace>_<name>; did you mean ns_spike_echo?` |
| Budget, before any attempt | `budget exhausted ($1.20 of $1.00)` (a skip) |
| Budget, after attempts | `live scenario live-smoke: 0 of 1 attempt(s) passed, needed 2 of 3 (budget exhausted ($1.50 of $1.00)).` (a failure) |
| resetDir outside root | `refusing to reset <dir>: it is not inside <root>` |

Messages from the real binary for the new failing fixture scenarios (captured with opencode 2.0.26):

```
hook-mutate fail:   hooks[0].tool.execute.before@post.input.command: expected "echo secret", got "echo [x]".
shell-env fail:     hooks[0].shell.create.before@post.env.FIXTURE_ON: expected "2", got "1".
system-inject fail: request.system: expected to contain "FIXTURE-ABSENT", got "You are an AI agent running in OpenCode, …
event-file fail:    files[0]..fixture/events.log: expected file to exist, but it does not.
tool-basic + noTools: [execute]:  noTools: expected tool "execute" not to be called, but it was.
```

The last line proves that `noTools: [execute]` in the `tool-direct` fixture is a real check: the same assertion fails for a Code Mode tool.

### 2.6 Not verified, be careful

- **The Action self-test job (M12) only runs on GitHub.** The `run:` script was executed locally (M12 shows how), but `uses: ./` and the composite outputs were not. If the `fail` leg's `result` output comes back empty on GitHub, keep the `outcome` check, drop only the `FAIL_RESULT` line, and write it in `docs/NOTES.md`.
- **The live tier with a real key** was not run. The budget and attempt logic are covered by the fake binary. Do not run the live tier with a real key as part of this brief; write "live: not run" in NOTES.md. The maintainer can try it after the PR.
- **The gate on a real pull request** (base-branch history) was not run end to end. The unit test covers the branch choice, and the `gh` behavior in 2.4 was checked by hand.
- **Bun versions other than 1.4.2** were not tried for the dot-directory behavior. If yours differs, re-run M1 step 1 and record it.

---

## 3. Files touched

```
src/run.ts                 # M3 order + entry, M4 bun test paths, M5 shared budget, M6 --scenario check, M10 --gate-artifact
src/tiers/load.ts          # M3 serverEntry option + log check on both paths, M6 resetDir
src/tiers/live.ts          # M5 budget failure, M6 resetDir, M7 live.timeoutMs
src/tiers/scripted.ts      # M6 resetDir, M7 timeout default + no judgeReply
src/tiers/ui-static.ts     # M6 resetDir
src/tiers/judge.ts         # M11 stub default reply is a fail
src/plugin/entry.ts        # M3 explicit entry must exist
src/plugin/install.ts      # M3 StepError
src/cli.ts                 # M3 validate tolerance, M6 --opencode check + exports, M10 --gate-artifact
src/config/schema.ts       # M6 reserved ids + workspace paths, M7 removed fields, M10 comment
src/config/load.ts         # M11 no duplicate warning
src/assert/matchers.ts     # M8 missing values fail
src/assert/expect.ts       # M9 namespaced names
src/gate/history.ts        # M10 historyBranch + temp cleanup
src/gate/gate.ts           # M10 use historyBranch
src/stub/codemode.ts       # M11 comment
src/util/fs.ts             # M6 resetDir
schema/config.json         # M7 regenerated (bun run schema)
schema/scenario.json       # M7 regenerated
action.yml                 # M10 pass artifact-name as --gate-artifact
.github/workflows/ci.yml   # M12 Action self-test job
README.md                  # M13
docs/NOTES.md              # every milestone: findings
test/helpers/fake-opencode.ts   # M2 new: fake opencode binary
test/helpers/tmp.ts             # M2 new: temp dirs that get cleaned up
test/helpers/run-ci.ts          # M2 new: shared runCi test setup
test/unit/run-exit-codes.test.ts    # M2 new
test/unit/run-entry.test.ts         # M3 new
test/unit/entry.test.ts             # M3 one test changed
test/e2e/tier1.test.ts              # M3 pass serverEntry
test/unit/run-bun-test.test.ts      # M4 new
test/unit/live-loop.test.ts         # M5 new
test/unit/run-budget.test.ts        # M5 new
test/unit/run-inputs.test.ts        # M6 new
test/unit/scenario-rules.test.ts    # M6 new
test/unit/config-schema.test.ts     # M7 tests changed
test/unit/matchers-missing.test.ts  # M8 new
test/unit/namespaced-tools.test.ts  # M9 new
test/unit/gate-wiring.test.ts       # M10 new
test/e2e/tier2.test.ts              # M12 four new cases
test/fixtures/plugins/{hook-mutate,shell-env,system-inject,event-file}/.opencode-ci/scenarios/fail.yaml  # M12 new
test/fixtures/plugins/tool-direct/.opencode-ci/scenarios/pass.yaml  # M12 noTools: [execute]
```

Unit test counts after each milestone (`bun run check` prints `N pass`): M0 213, M2 217, M3 222, M4 224, M5 231, M6 237, M7 238, M8 242, M9 246, M10 248, M11 248. E2E: 24 until M12, then 28.

---

## 4. Milestones

### M0: Baseline

**Do:**

1. Set up as in section 1.
2. Read `docs/reports/review-v1.md` and SPEC sections 3.2, 4, 5, 6.1, 6.2, 7.2, 8 and 11.
3. Run the baseline.

**Acceptance:**

```bash
bun run check        # ends with " 213 pass" and " 0 fail"
bun run test:e2e     # ends with " 24 pass" and " 0 fail"
git status --short   # prints nothing
```

No commit for M0.

### M1: Reproduce the two surprises yourself

You will build on these two behaviors, so see them with your own eyes first. Everything goes under `review/spike-v1.1/` (git-ignored).

**Do:**

1. Bun skips dot-directories:
   ```bash
   S=review/spike-v1.1 && rm -rf $S && mkdir -p $S/dot/.opencode-ci
   printf 'import { expect, test } from "bun:test";\ntest("ok", () => expect(1).toBe(1));\n' > $S/dot/.opencode-ci/ok.test.ts
   (cd $S/dot && bun test .opencode-ci; echo "exit=$?")
   (cd $S/dot && bun test ./.opencode-ci/ok.test.ts; echo "exit=$?")
   ```
2. Stale evidence in a reused out dir:
   ```bash
   S=review/spike-v1.1
   cp -r test/fixtures/plugins/tool-basic $S/stale && rm -rf $S/stale/.opencode-ci/out
   cd $S/stale
   bun ../../../bin/opencode-plugin-ci.ts run --tier scripted --scenario tool-basic-pass --quiet --out ../stale-out; echo "run1 exit=$?"
   sed -i 's/name: "echo_tool"/name: "echo_tool_renamed"/' src/server.ts
   bun ../../../bin/opencode-plugin-ci.ts run --tier scripted --scenario tool-basic-pass --quiet --out ../stale-out; echo "run2 exit=$?"
   bun ../../../bin/opencode-plugin-ci.ts run --tier scripted --scenario tool-basic-pass --quiet --out ../stale-out-fresh; echo "run3 exit=$?"
   grep -c '"kind":"inventory"' ../stale-out/2.0.26/tool-basic-pass/probe.jsonl ../stale-out-fresh/2.0.26/tool-basic-pass/probe.jsonl
   cd ../../..
   ```
   (On macOS, use `sed -i ''`.)
3. Add a section `## v1.1 M1: reproductions (<date>)` to `docs/NOTES.md` with the commands and their output.

**Acceptance:**

- Step 1 prints `The following filters did not match any test files` and `exit=1`, then ` 1 pass` and `exit=0`.
- Step 2 prints `run1 exit=0`, `run2 exit=0`, `run3 exit=1`, and the counts `…/stale-out/…:2` and `…/stale-out-fresh/…:1`.
- If either differs, write it in NOTES.md and stop.

Commit: `v1.1 M1: record reproductions` (only `docs/NOTES.md`).

### M2: A fake opencode binary and shared test setup

`runCi` and the live attempt loop have no tests, because each run needs opencode. The fake below plays back planned runs: it writes the probe records and the `step_finish` cost that the real binary would, in milliseconds and with no network. Every later milestone tests through it.

How it works: `makeFakeOpencode(dir, plan)` writes `plan.json` and an executable `opencode` bash wrapper that runs this same file with the plan path as its first argument. Each `opencode run` consumes the next entry of `plan.runs` (the last one repeats) and counts itself in `plan.json.count`. It reads the sandbox's `opencode.jsonc` to find the probe's output file and the shim dir, writes `tool.before`/`tool.after` records (phases `pre` and `post`) for each planned tool call, then an `inventory` record whose plugin list contains the plugin under test with the planned status. On stdout it prints an optional `text` event, a `step_finish` event with the planned `cost`, and an optional `error` event.

**Do:**

1. Create these three helpers exactly:

````ts file:test/helpers/fake-opencode.ts
// A stand-in for the `opencode` binary, for orchestration tests that must be
// fast and deterministic. `makeFakeOpencode(dir, plan)` writes the plan and a
// bash wrapper; point `opencodeBin` / OPENCODE_BIN at the wrapper.
//
// The sandbox passes only an allowlisted env to opencode, so the plan path
// travels as an argument baked into the wrapper, never as an env var.
//
// Each `run` invocation consumes the next entry of `plan.runs` (the last
// entry repeats). The number of `run` invocations so far is kept in
// `<plan>.count`, so tests can assert how many runs happened.
import {
	appendFileSync,
	chmodSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface FakeToolCall {
	tool: string;
	input?: unknown;
	result?: unknown;
	status?: "completed" | "error";
}

export interface FakeRun {
	/** Process exit code [0]. */
	exitCode?: number;
	/** Emitted as one `text` event when set. */
	text?: string;
	/** Emitted in one `step_finish` event [0]. */
	cost?: number;
	/** Emits one `error` event with this message when set. */
	error?: string;
	/** Written to stderr verbatim. */
	stderr?: string;
	/** Inventory status of the plugin under test ["active"]. */
	pluginStatus?: "active" | "failed" | "missing";
	/** Inventory tools [[]]. */
	inventoryTools?: string[];
	/** Written as tool.before/tool.after probe records, pre and post. */
	toolCalls?: FakeToolCall[];
}

export interface FakePlan {
	/** Reported by `--version` ["2.0.26"]. */
	version?: string;
	/** Printed one per line by `models` [["opencode/fake-model"]]. */
	models?: string[];
	runs: FakeRun[];
}

/** Write `<dir>/plan.json` and an executable `<dir>/opencode` wrapper; return the wrapper path. */
export function makeFakeOpencode(dir: string, plan: FakePlan): string {
	const planPath = join(dir, "plan.json");
	writeFileSync(planPath, JSON.stringify(plan));
	const wrapper = join(dir, "opencode");
	writeFileSync(
		wrapper,
		`#!/usr/bin/env bash\nexec bun '${import.meta.path}' '${planPath}' "$@"\n`,
	);
	chmodSync(wrapper, 0o755);
	return wrapper;
}

/** How many `run` invocations the fake has served for the plan in `dir`. */
export function fakeRunCount(dir: string): number {
	const file = join(dir, "plan.json.count");
	return existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;
}

function main(): number {
	const [planPath, command, ...rest] = process.argv.slice(2);
	if (planPath === undefined) {
		return 2;
	}
	const plan = JSON.parse(readFileSync(planPath, "utf8")) as FakePlan;
	if (command === "--version") {
		console.log(`opencode v${plan.version ?? "2.0.26"}`);
		return 0;
	}
	if (command === "models") {
		console.log((plan.models ?? ["opencode/fake-model"]).join("\n"));
		return 0;
	}
	if (command !== "run") {
		console.error(
			`fake opencode: unsupported command ${command} ${rest.join(" ")}`,
		);
		return 2;
	}

	const countFile = `${planPath}.count`;
	const n = existsSync(countFile) ? Number(readFileSync(countFile, "utf8")) : 0;
	writeFileSync(countFile, String(n + 1));
	const run = plan.runs[Math.min(n, plan.runs.length - 1)] ?? {};

	// The sandbox writes JSON (not JSONC) to this path, so JSON.parse works.
	const configFile = join(
		process.env.XDG_CONFIG_HOME ?? "",
		"opencode",
		"opencode.jsonc",
	);
	const config = JSON.parse(readFileSync(configFile, "utf8")) as {
		plugins?: { package: string; options?: Record<string, unknown> }[];
	};
	const plugins = config.plugins ?? [];
	const probeOut = plugins.find((p) => typeof p.options?.out === "string")
		?.options?.out as string | undefined;
	const underTest = plugins.find((p) =>
		p.package.endsWith("/plugin-under-test"),
	);

	if (probeOut !== undefined) {
		let seq = 0;
		const write = (record: Record<string, unknown>): void => {
			appendFileSync(
				probeOut,
				`${JSON.stringify({ ...record, seq: seq++, t: Date.now() })}\n`,
			);
		};
		(run.toolCalls ?? []).forEach((call, index) => {
			for (const phase of ["pre", "post"]) {
				write({
					kind: "tool.before",
					phase,
					tool: call.tool,
					callID: `call-${index}`,
					input: call.input ?? {},
				});
			}
			for (const phase of ["pre", "post"]) {
				write({
					kind: "tool.after",
					phase,
					tool: call.tool,
					callID: `call-${index}`,
					status: call.status ?? "completed",
					input: call.input ?? {},
					result: call.result ?? { content: "" },
				});
			}
		});
		const status = run.pluginStatus ?? "active";
		write({
			kind: "inventory",
			phase: "post",
			plugins:
				underTest === undefined || status === "missing"
					? []
					: [
							{
								id: "fixture-under-test",
								source: {
									type: "local",
									path: `${underTest.package}/server.js`,
								},
								status,
								error:
									status === "failed" ? "Error: fake setup failure" : undefined,
							},
						],
			tools: run.inventoryTools ?? [],
			commands: [],
			agents: [],
			skills: [],
			mcp: [],
		});
	}

	if (run.text !== undefined) {
		console.log(
			JSON.stringify({ type: "text", part: { type: "text", text: run.text } }),
		);
	}
	console.log(
		JSON.stringify({
			type: "step_finish",
			part: {
				type: "step-finish",
				reason: "stop",
				cost: run.cost ?? 0,
				tokens: {
					input: 10,
					output: 5,
					reasoning: 0,
					cache: { read: 0, write: 0 },
				},
			},
		}),
	);
	if (run.error !== undefined) {
		console.log(
			JSON.stringify({
				type: "error",
				error: { type: "fake", message: run.error },
			}),
		);
	}
	if (run.stderr !== undefined) {
		process.stderr.write(run.stderr);
	}
	return run.exitCode ?? 0;
}

if (import.meta.main) {
	process.exit(main());
}
````

````ts file:test/helpers/tmp.ts
// Temp dirs for tests. Call cleanupTempDirs() from an afterAll so a test run
// leaves nothing behind in the OS temp dir.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made: string[] = [];

/** mkdtemp under the OS temp dir; removed by the next cleanupTempDirs(). */
export function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	made.push(dir);
	return dir;
}

export function cleanupTempDirs(): void {
	for (const dir of made.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
}
````

````ts file:test/helpers/run-ci.ts
// Shared setup for tests that drive `runCi` with the fake opencode binary.
// Call isolateCiEnv() once at the top of a test file.
import { afterAll, afterEach, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FakeRun, makeFakeOpencode } from "./fake-opencode.ts";
import { cleanupTempDirs, tempDir } from "./tmp.ts";

/** The smallest plugin opencode will activate. */
export const PLUGIN_JS =
	'export default { id: "fixture-run", setup: async () => {} };\n';

/** Write a throwaway plugin repo; `files` maps relative paths to contents. */
export function makePlugin(files: Record<string, string>): string {
	const dir = tempDir("run-plugin-");
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}
	return dir;
}

/** Point OPENCODE_BIN at a fresh fake; returns the fake's directory. */
export function useFake(runs: FakeRun[]): string {
	const dir = tempDir("run-fake-");
	process.env.OPENCODE_BIN = makeFakeOpencode(dir, { runs });
	return dir;
}

const SAVED = [
	"OPENCODE_BIN",
	"OPENCODE_API_KEY",
	"GITHUB_ACTIONS",
	"GITHUB_STEP_SUMMARY",
] as const;

/**
 * Save and restore the env vars runCi reads, and clear the CI ones for each
 * test: with GITHUB_ACTIONS set the gate could run, and with
 * GITHUB_STEP_SUMMARY set the report would be appended to the real summary.
 */
export function isolateCiEnv(): void {
	let saved: Record<string, string | undefined> = {};
	beforeEach(() => {
		saved = Object.fromEntries(SAVED.map((name) => [name, process.env[name]]));
		delete process.env.GITHUB_ACTIONS;
		delete process.env.GITHUB_STEP_SUMMARY;
		delete process.env.OPENCODE_API_KEY;
	});
	afterEach(() => {
		for (const name of SAVED) {
			if (saved[name] === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = saved[name];
			}
		}
	});
	afterAll(cleanupTempDirs);
}
````

2. Create this test file. It covers behavior that already works on `main`, so it passes right away; it proves the fake works.

````ts file:test/unit/run-exit-codes.test.ts
// runCi exit codes and skips across required and allowed opencode versions.
// These already pass on v1; they prove the fake opencode binary works.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runCi } from "../../src/run.ts";
import { fakeRunCount } from "../helpers/fake-opencode.ts";
import {
	isolateCiEnv,
	makePlugin,
	PLUGIN_JS,
	useFake,
} from "../helpers/run-ci.ts";

isolateCiEnv();

const TWO_VERSIONS = 'opencode:\n  versions: ["2.0.26", "latest"]\n';

describe("runCi exit codes", () => {
	test("a plugin that loads passes tier 1", async () => {
		const fake = useFake([{}]);
		const cwd = makePlugin({ "index.ts": PLUGIN_JS });
		const outcome = await runCi({ cwd, tiers: ["load"], quiet: true });
		expect(outcome.exitCode).toBe(0);
		expect(fakeRunCount(fake)).toBe(1);
	});

	test("a required-version tier 1 failure exits 1", async () => {
		useFake([{ pluginStatus: "missing" }, {}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/config.yaml": TWO_VERSIONS,
		});
		const outcome = await runCi({ cwd, tiers: ["load"], quiet: true });
		expect(outcome.exitCode).toBe(1);
	});

	test("an allowed-version tier 1 failure exits 0 and is reported", async () => {
		useFake([{}, { pluginStatus: "missing" }]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/config.yaml": TWO_VERSIONS,
		});
		const outcome = await runCi({ cwd, tiers: ["load"], quiet: true });
		expect(outcome.exitCode).toBe(0);
		expect(readFileSync(outcome.reportPath, "utf8")).toContain(
			"⚠️ allowed failure",
		);
	});

	test("a failing tier 1 skips that version's scripted scenarios", async () => {
		const fake = useFake([{ pluginStatus: "failed" }]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/scenarios/smoke.yaml":
				"id: smoke\nmode: scripted\nprompt: hi\nscript:\n  - text: done\n",
		});
		const outcome = await runCi({ cwd, quiet: true });
		expect(outcome.exitCode).toBe(1);
		const smoke = outcome.resultsFile.results.find((r) => r.id === "smoke");
		expect(smoke?.skipped).toBe("tier 1 failed");
		expect(fakeRunCount(fake)).toBe(1);
	});
});
````

**Acceptance:**

```bash
bun test ./test/unit/run-exit-codes.test.ts   # " 4 pass", " 0 fail"
bun run check                                 # " 217 pass", " 0 fail"
```

Commit: `v1.1 M2: fake opencode binary and runCi test setup`.

### M3: Build before resolving entries; one server entry everywhere (B1, B2, S2)

**Do:**

1. Create the test file:

````ts file:test/unit/run-entry.test.ts
// Review B1, B2, S2 and the install/build exit code: install and build run
// before entries are resolved, tier 1 loads the configured plugin.entry, a
// missing plugin.entry is a configuration error, and a failing build is the
// plugin's failure (exit 1), not a configuration error (exit 2).
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "../../src/config/load.ts";
import { resolveEntries } from "../../src/plugin/entry.ts";
import { StepError } from "../../src/plugin/install.ts";
import { runCi } from "../../src/run.ts";
import {
	isolateCiEnv,
	makePlugin,
	PLUGIN_JS,
	useFake,
} from "../helpers/run-ci.ts";
import { tempDir } from "../helpers/tmp.ts";

isolateCiEnv();

const SHIM = ".opencode-ci/out/2.0.26/load/plugin-under-test/server.js";

describe("entries and the install/build steps", () => {
	test("runs plugin.build before resolving a dist/ entry", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"package.json":
				'{ "name": "fixture-built", "type": "module", "main": "./dist/server.js" }',
			"src/server.js": PLUGIN_JS,
			".opencode-ci/config.yaml":
				"plugin:\n  build: mkdir -p dist && cp src/server.js dist/server.js\n",
		});
		const outcome = await runCi({ cwd, tiers: ["load"], quiet: true });
		expect(outcome.exitCode).toBe(0);
		expect(readFileSync(join(cwd, SHIM), "utf8")).toContain("/dist/server.js");
	});

	test("tier 1 loads plugin.entry, not auto-detection", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"package.json": '{ "name": "fixture-explicit", "type": "module" }',
			"src/plugin.ts": PLUGIN_JS,
			".opencode-ci/config.yaml": "plugin:\n  entry: src/plugin.ts\n",
		});
		const outcome = await runCi({ cwd, tiers: ["load"], quiet: true });
		expect(outcome.exitCode).toBe(0);
		expect(readFileSync(join(cwd, SHIM), "utf8")).toContain("/src/plugin.ts");
	});

	test("a missing plugin.entry is a configuration error even when index.ts exists", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"package.json": '{ "name": "fixture-typo", "type": "module" }',
			"index.ts": PLUGIN_JS,
			".opencode-ci/config.yaml": "plugin:\n  entry: src/typo.ts\n",
		});
		await expect(runCi({ cwd, tiers: ["load"], quiet: true })).rejects.toThrow(
			ConfigError,
		);
	});

	test("an explicit entry still resolves the TUI entry", () => {
		const dir = tempDir("entry-both-");
		mkdirSync(join(dir, "src"));
		writeFileSync(join(dir, "src/plugin.ts"), PLUGIN_JS);
		writeFileSync(join(dir, "tui.ts"), PLUGIN_JS);
		const entries = resolveEntries(dir, "src/plugin.ts");
		expect(entries.server).toBe(join(dir, "src/plugin.ts"));
		expect(entries.tui).toBe(join(dir, "tui.ts"));
	});

	test("a failing build is the plugin's failure, not a config error", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/config.yaml": "plugin:\n  build: exit 3\n",
		});
		await expect(runCi({ cwd, quiet: true })).rejects.toThrow(StepError);
		await expect(runCi({ cwd, quiet: true })).rejects.toThrow(
			"build step failed (exit 3): exit code 3.",
		);
	});
});
````

   Run `bun test ./test/unit/run-entry.test.ts`. Expected now: the file fails to load with `Export named 'StepError' not found in module '…/src/plugin/install.ts'`.

2. `src/plugin/install.ts`: a failing install or build is the plugin's failure (exit 1), not a configuration error (exit 2). Replace the `ConfigError` import with a `StepError` class:

````ts find:src/plugin/install.ts
// Run a plugin's install/build shell step before any tier runs.
import { type ChildProcess, spawn } from "node:child_process";
import { ConfigError } from "../config/load.ts";
````

````ts replace:src/plugin/install.ts
// Run a plugin's install/build shell step before any tier runs.
import { type ChildProcess, spawn } from "node:child_process";

/** A plugin install/build command failed: the plugin's failure (exit 1), not a config error. */
export class StepError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StepError";
	}
}
````

   Then, in the same file, replace every `new ConfigError(` with `new StepError(` (there are three), and in the doc comment of `runStep` replace `Throws ConfigError (exit 2 upstream) when` with `Throws StepError (exit 1 upstream) when`. `cmdRun` in `src/cli.ts` already maps any non-`ConfigError` to exit 1; do not change it.

   Run the test again. Expected now: ` 1 pass`, ` 4 fail`. The build-failure test already passes because `StepError` is now thrown; the other four need the steps below.

3. `src/run.ts`: run install and build first, then resolve entries. Replace the header comment's first steps:

````ts find:src/run.ts
// Orchestrator for `opencode-plugin-ci run` (M10 order):
// 1. Load + validate config/scenarios.
// 2. Resolve entries (exit 2 when neither server nor TUI exists).
// 3. Run plugin.install / plugin.build once.
````

````ts replace:src/run.ts
// Orchestrator for `opencode-plugin-ci run`:
// 1. Load + validate config/scenarios (and every --scenario id).
// 2. Run plugin.install / plugin.build once (a failure is exit 1).
// 3. Resolve entries (exit 2 when neither server nor TUI exists). This must
//    follow the build: the entry is often a build output such as dist/.
````

   Then the steps themselves:

````ts find:src/run.ts
	const pluginPath = resolve(cwd, config.plugin.path);
	// 2. Resolve entries (throws ConfigError when nothing resolves).
	const entries = ensureEntriesOrThrow(pluginPath, config.plugin.entry);
	const tuiOnly = isTuiOnly(config, entries);
	if (tuiOnly) {
		logger.info("TUI-only plugin: tier 1 is static; tiers 2/3 are skipped.");
	}

	// 3. Install + build once, before any tier.
	if (config.plugin.install !== undefined) {
		logger.info(`Running install step: ${config.plugin.install}`);
		await runStep("install", config.plugin.install, pluginPath);
	}
	if (config.plugin.build !== undefined) {
		logger.info(`Running build step: ${config.plugin.build}`);
		await runStep("build", config.plugin.build, pluginPath);
	}
````

````ts replace:src/run.ts
	const pluginPath = resolve(cwd, config.plugin.path);
	// 2. Install + build once, before resolving entries: the entry is often
	// a build output (dist/server.js) that does not exist in a fresh checkout.
	if (config.plugin.install !== undefined) {
		logger.info(`Running install step: ${config.plugin.install}`);
		await runStep("install", config.plugin.install, pluginPath);
	}
	if (config.plugin.build !== undefined) {
		logger.info(`Running build step: ${config.plugin.build}`);
		await runStep("build", config.plugin.build, pluginPath);
	}

	// 3. Resolve entries (throws ConfigError when nothing resolves).
	const entries = ensureEntriesOrThrow(pluginPath, config.plugin.entry);
	const tuiOnly = isTuiOnly(config, entries);
	if (tuiOnly) {
		logger.info("TUI-only plugin: tier 1 is static; tiers 2/3 are skipped.");
	}
````

   And pass the resolved entry to tier 1:

````ts find:src/run.ts
				: await runLoad({
						pluginPath,
						pluginOptions: config.plugin.options,
````

````ts replace:src/run.ts
				: await runLoad({
						pluginPath,
						serverEntry: entries.server as string,
						pluginOptions: config.plugin.options,
````

   (`entries.server` is always set here: `tuiOnly` is false, and `ensureEntriesOrThrow` throws when neither entry exists.)

4. `src/tiers/load.ts`: take the entry from the caller instead of resolving it, and check log lines against the real entry path too (stack traces name the real file, not the shim).

````ts find:src/tiers/load.ts
import { parseLogs, pluginLogProblems } from "../opencode/logs.ts";
import { resolveEntries } from "../plugin/entry.ts";
import { writeShim } from "../plugin/shim.ts";
````

````ts replace:src/tiers/load.ts
import { parseLogs, pluginLogProblems } from "../opencode/logs.ts";
import { writeShim } from "../plugin/shim.ts";
````

````ts find:src/tiers/load.ts
export interface RunLoadOptions {
	pluginPath: string;
````

````ts replace:src/tiers/load.ts
export interface RunLoadOptions {
	pluginPath: string;
	/** Absolute server entry, resolved once by the caller (honors plugin.entry). */
	serverEntry: string;
````

````ts find:src/tiers/load.ts
	const pluginPath = resolve(opts.pluginPath);
	const entries = resolveEntries(pluginPath);
	if (entries.server === undefined) {
		throw new ConfigError(
			`No server entry found under ${pluginPath}: ` +
				`looked for package.json exports["./server"]/["."], main, ` +
				`then server.{ts,js,mjs} and index.{ts,js,mjs}.`,
		);
	}
	const serverEntry = entries.server;
````

````ts replace:src/tiers/load.ts
	const serverEntry = opts.serverEntry;
````

````ts find:src/tiers/load.ts
		const problems = pluginLogProblems(parseLogs(run.stderr), {
			id: plugin?.id,
			path: shimServerJs,
		});
````

````ts replace:src/tiers/load.ts
		const lines = parseLogs(run.stderr);
		// Stack traces name the real entry, not the shim: check both paths.
		const problems = [
			...pluginLogProblems(lines, { id: plugin?.id, path: shimServerJs }),
			...pluginLogProblems(lines, { path: serverEntry }),
		].filter((line, index, all) => all.indexOf(line) === index);
````

5. `src/plugin/entry.ts`: an explicit entry that does not exist is an error, never a fallback. The TUI entry is still resolved.

````ts find:src/plugin/entry.ts
 * Resolve absolute server/tui entry paths. An explicit entry is joined to
 * pluginPath; when it names an existing file it wins, otherwise resolution
 * falls through to the default order (so a typo surfaces as "no entry"
 * instead of a crash). Paths that resolve to nothing are left undefined.
````

````ts replace:src/plugin/entry.ts
 * Resolve absolute server/tui entry paths. An explicit entry is joined to
 * pluginPath and must name an existing file: a missing explicit entry throws
 * ConfigError instead of silently falling back to auto-detection (a typo
 * must never test a different file). Other paths that resolve to nothing are
 * left undefined.
````

````ts find:src/plugin/entry.ts
		const candidate = abs(explicit);
		if (isFile(candidate)) {
			entries.server = candidate;
			return entries;
		}
		// Fall through: the explicit path names nothing, so keep looking
		// and let the caller report "no server entry" with full context.
	}

	const pkg = readPackageJson(pluginPath);

	const serverTarget = serverFromExports(pkg);
````

````ts replace:src/plugin/entry.ts
		const candidate = abs(explicit);
		if (!isFile(candidate)) {
			throw new ConfigError(
				`plugin.entry ${JSON.stringify(explicit)} does not exist (resolved to ${candidate}). ` +
					"Fix the path, or check that plugin.build creates it.",
			);
		}
		entries.server = candidate;
	}

	const pkg = readPackageJson(pluginPath);

	const serverTarget =
		entries.server === undefined ? serverFromExports(pkg) : undefined;
````

   The later branches of `resolveEntries` (`main`, then the `server.*`/`index.*` files) already run only when `entries.server === undefined`, and the TUI branch runs either way. Do not change them.

6. `src/cli.ts`: `validate` never builds, so a missing entry is only a warning when `plugin.build` is set (run checks again after building).

````ts find:src/cli.ts
import { ensureEntriesOrThrow } from "./plugin/entry.ts";
````

````ts replace:src/cli.ts
import { type Entries, ensureEntriesOrThrow } from "./plugin/entry.ts";
````

````ts find:src/cli.ts
		const entries = ensureEntriesOrThrow(pluginPath, config.plugin.entry);
		const tuiOnly = isTuiOnly(config, entries);
````

````ts replace:src/cli.ts
		let entries: Entries | undefined;
		try {
			entries = ensureEntriesOrThrow(pluginPath, config.plugin.entry);
		} catch (error) {
			// The entry may be a build output that `validate` never builds;
			// `run` resolves entries again after plugin.build.
			if (
				!(error instanceof ConfigError) ||
				config.plugin.build === undefined
			) {
				throw error;
			}
			logger.warn(
				`${error.message} (plugin.build is set, so run checks again after building).`,
			);
		}
		const tuiOnly = entries !== undefined && isTuiOnly(config, entries);
````

````ts find:src/cli.ts
			`entries: server=${entries.server ?? "-"} tui=${entries.tui ?? "-"}`,
````

````ts replace:src/cli.ts
			entries === undefined
				? "entries: not found yet (created by plugin.build?)"
				: `entries: server=${entries.server ?? "-"} tui=${entries.tui ?? "-"}`,
````

7. Update the two existing tests that encode the old behavior.

   `test/unit/entry.test.ts`:

````ts find:test/unit/entry.test.ts
	test("missing explicit entry falls through to detection", () => {
		const dir = makeDir();
		writeFile(dir, "server.ts");
		expect(resolveEntries(dir, "does/not-exist.ts").server).toBe(
			resolve(dir, "server.ts"),
		);
	});
````

````ts replace:test/unit/entry.test.ts
	test("missing explicit entry throws instead of falling back", () => {
		const dir = makeDir();
		writeFile(dir, "server.ts");
		expect(() => resolveEntries(dir, "does/not-exist.ts")).toThrow(
			/plugin\.entry "does\/not-exist\.ts" does not exist/,
		);
	});
````

   `test/e2e/tier1.test.ts` (it calls `runLoad`, which now needs `serverEntry`). Add a helper after `opencodeBin()`:

````ts find:test/e2e/tier1.test.ts
function outDir(name: string): string {
````

````ts replace:test/e2e/tier1.test.ts
/** The fixture's server entry, resolved the way `run` resolves it. */
function serverEntryOf(name: string): string {
	const entry = resolveEntries(join(FIXTURES, name)).server;
	if (entry === undefined) {
		throw new Error(`fixture ${name} has no server entry`);
	}
	return entry;
}

function outDir(name: string): string {
````

   Then add `serverEntry: serverEntryOf("<fixture>"),` right after `pluginPath: join(FIXTURES, "<fixture>"),` in each of the three `runLoad({` calls: twice for `"tool-basic"` and once for `"throws"`. Do not touch the `tui-only` and `tui-broken` tests; they call `runUiStatic`, which is unchanged.

**Acceptance:**

```bash
bun test ./test/unit/run-entry.test.ts   # " 5 pass", " 0 fail"
bun run check                            # " 222 pass", " 0 fail"
bun test ./test/e2e/tier1.test.ts ./test/e2e/cli.test.ts   # all pass
```

Commit: `v1.1 M3: build before resolving entries; tier 1 uses plugin.entry`.

### M4: Run `.opencode-ci` test files by path (B3)

**Do:**

1. Create the test file:

````ts file:test/unit/run-bun-test.test.ts
// Review B3: the bun-test case runs .opencode-ci/**/*.test.ts and reports
// both outcomes. `bun test .opencode-ci` never matches (bun skips
// dot-directories), so this test fails until each file is passed by path.
import { describe, expect, test } from "bun:test";
import { runCi } from "../../src/run.ts";
import {
	isolateCiEnv,
	makePlugin,
	PLUGIN_JS,
	useFake,
} from "../helpers/run-ci.ts";

isolateCiEnv();

describe("bun-test case", () => {
	test("a passing test file makes bun-test pass", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/ok.test.ts":
				'import { expect, test } from "bun:test";\ntest("fine", () => expect(1).toBe(1));\n',
		});
		const outcome = await runCi({ cwd, tiers: ["scripted"], quiet: true });
		const row = outcome.resultsFile.results.find((r) => r.id === "bun-test");
		expect(row?.pass).toBe(true);
		expect(outcome.exitCode).toBe(0);
	});

	test("a failing test file in a subdir makes bun-test fail with its name", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/nested/bad.test.ts":
				'import { expect, test } from "bun:test";\ntest("deliberately fails", () => expect(1).toBe(2));\n',
		});
		const outcome = await runCi({ cwd, tiers: ["scripted"], quiet: true });
		const row = outcome.resultsFile.results.find((r) => r.id === "bun-test");
		expect(row?.pass).toBe(false);
		expect((row?.failures ?? []).join("\n")).toContain("deliberately fails");
		expect(outcome.exitCode).toBe(1);
	});
});
````

   Run it. Expected now: ` 0 pass`, ` 2 fail` (the passing case is reported as a failure, and the failing case's message is the "did not match any test files" note instead of the test name).

2. `src/run.ts`:

````ts find:src/run.ts
			const proc = Bun.spawn(["bun", "test", ".opencode-ci"], {
				cwd,
				env: { ...process.env, OPENCODE_BIN: bin },
				stdout: "pipe",
				stderr: "pipe",
				stdin: "ignore",
			});
````

````ts replace:src/run.ts
			// Explicit "./" paths: `bun test <dir>` skips dot-directories, so a
			// ".opencode-ci" filter never matches any file (bun 1.4.2).
			const proc = Bun.spawn(
				["bun", "test", ...testFiles.map((file) => `./${relative(cwd, file)}`)],
				{
					cwd,
					env: { ...process.env, OPENCODE_BIN: bin },
					stdout: "pipe",
					stderr: "pipe",
					stdin: "ignore",
				},
			);
````

   `testFiles` (absolute paths) and `relative` are already in scope in `run.ts`.

**Acceptance:**

```bash
bun test ./test/unit/run-bun-test.test.ts   # " 2 pass"
bun run check                               # " 224 pass", " 0 fail"
```

Commit: `v1.1 M4: run .opencode-ci test files by explicit path`.

### M5: The live budget never hides a failure, and is shared across versions (B4, S1)

**Do:**

1. Create both test files:

````ts file:test/unit/live-loop.test.ts
// The live attempt loop (k-of-n, early stop, judge gating, budget), driven by
// the fake opencode binary so no real model or key is needed.
import { afterAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { ConfigSchema, ScenarioSchema } from "../../src/config/schema.ts";
import { type LiveBudget, runLiveScenario } from "../../src/tiers/live.ts";
import {
	type FakeRun,
	fakeRunCount,
	makeFakeOpencode,
} from "../helpers/fake-opencode.ts";
import { cleanupTempDirs, tempDir } from "../helpers/tmp.ts";

const PLUGIN = resolve(import.meta.dir, "../fixtures/plugins/tool-basic");
const ENTRY = join(PLUGIN, "src/server.ts");

const PASS: FakeRun = {
	text: "echo:hi",
	cost: 0.01,
	toolCalls: [
		{
			tool: "echo_tool",
			input: { text: "hi" },
			result: { content: "echo:hi" },
		},
	],
};
const FAIL: FakeRun = { text: "I did not use the tool", cost: 0.01 };

async function live(
	runs: FakeRun[],
	opts: { budget?: LiveBudget; judge?: boolean } = {},
) {
	const dir = tempDir("live-loop-");
	const bin = makeFakeOpencode(dir, { runs });
	const config = ConfigSchema.parse({ live: { model: "fake/model" } });
	const scenario = ScenarioSchema.parse({
		id: "live-smoke",
		mode: "live",
		prompt: "Use the echo tool on the word hi",
		expect: { tools: [{ name: "echo_tool" }] },
		...(opts.judge ? { judge: { rubric: "The reply shows echo:hi." } } : {}),
	});
	const result = await runLiveScenario({
		scenario,
		config,
		pluginPath: PLUGIN,
		serverEntry: ENTRY,
		opencodeBin: bin,
		outDir: join(dir, "out"),
		version: "2.0.26",
		budget: opts.budget ?? { spent: 0, limit: 1 },
		model: "fake/model",
		keys: { OPENCODE_API_KEY: "fake" },
	});
	return { result, runs: fakeRunCount(dir) };
}

afterAll(cleanupTempDirs);

describe("live attempt loop", () => {
	test("pass, fail, pass passes after 3 attempts", async () => {
		const { result, runs } = await live([PASS, FAIL, PASS]);
		expect(result.pass).toBe(true);
		expect(result.skipped).toBeUndefined();
		expect(result.attempts?.map((a) => a.pass)).toEqual([true, false, true]);
		expect(runs).toBe(3);
	});

	test("stops early after 2 passes", async () => {
		const { result, runs } = await live([PASS, PASS, PASS]);
		expect(result.pass).toBe(true);
		expect(result.attempts).toHaveLength(2);
		expect(runs).toBe(2);
	});

	test("stops early once passing is impossible", async () => {
		const { result, runs } = await live([FAIL, FAIL, PASS]);
		expect(result.pass).toBe(false);
		expect(result.attempts).toHaveLength(2);
		expect(runs).toBe(2);
		expect((result.failures ?? []).join("\n")).toContain(
			"0 of 2 attempt(s) passed, needed 2 of 3",
		);
	});

	test("the judge runs only after the deterministic checks pass", async () => {
		const verdict: FakeRun = { text: '{"pass":true,"reason":"ok"}' };
		const { result, runs } = await live([FAIL, FAIL], { judge: true });
		expect(result.pass).toBe(false);
		expect(result.judge).toBeUndefined();
		expect(runs).toBe(2);
		const judged = await live([PASS, verdict, PASS, verdict], { judge: true });
		expect(judged.result.pass).toBe(true);
		expect(judged.result.judge).toEqual({ pass: true, reason: "ok" });
		expect(judged.runs).toBe(4);
	});

	test("running out of budget after a failed attempt is a failure, not a skip", async () => {
		const { result, runs } = await live([{ ...FAIL, cost: 1.5 }]);
		expect(runs).toBe(1);
		expect(result.skipped).toBeUndefined();
		expect(result.pass).toBe(false);
		expect(result.failures?.[0]).toBe(
			"live scenario live-smoke: 0 of 1 attempt(s) passed, needed 2 of 3 (budget exhausted ($1.50 of $1.00)).",
		);
	});

	test("running out of budget before any attempt is a skip", async () => {
		const { result, runs } = await live([PASS], {
			budget: { spent: 1, limit: 1 },
		});
		expect(runs).toBe(0);
		expect(result.pass).toBe(true);
		expect(result.skipped).toBe("budget exhausted ($1.00 of $1.00)");
	});
});
````

````ts file:test/unit/run-budget.test.ts
// Review S1: one live budget for the whole run, shared by every version.
import { describe, expect, test } from "bun:test";
import { runCi } from "../../src/run.ts";
import { type FakeRun, fakeRunCount } from "../helpers/fake-opencode.ts";
import {
	isolateCiEnv,
	makePlugin,
	PLUGIN_JS,
	useFake,
} from "../helpers/run-ci.ts";

isolateCiEnv();

describe("live budget", () => {
	test("one live budget is shared across opencode versions", async () => {
		const pass: FakeRun = {
			cost: 0.6,
			toolCalls: [{ tool: "echo_tool", result: { content: "echo:hi" } }],
		};
		const fake = useFake([pass]);
		process.env.OPENCODE_API_KEY = "fake";
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/config.yaml":
				'opencode:\n  versions: ["2.0.26", "latest"]\nlive:\n  model: fake/model\n  budgetUSD: 1\n',
			".opencode-ci/scenarios/live.yaml":
				"id: live-smoke\nmode: live\nprompt: hi\nexpect:\n  tools:\n    - name: echo_tool\n",
		});
		const outcome = await runCi({ cwd, tiers: ["live"], quiet: true });
		const rows = outcome.resultsFile.results;
		expect(rows.find((r) => r.opencode === "2.0.26")?.pass).toBe(true);
		expect(rows.find((r) => r.opencode === "latest")?.skipped).toBe(
			"budget exhausted ($1.20 of $1.00)",
		);
		expect(fakeRunCount(fake)).toBe(2);
		expect(outcome.exitCode).toBe(0);
	});
});
````

   Run them. Expected now: `live-loop` ` 5 pass`, ` 1 fail` (`running out of budget after a failed attempt is a failure, not a skip`), and `run-budget` ` 0 pass`, ` 1 fail` (the `latest` row runs instead of being skipped, because each version gets a fresh budget).

2. `src/tiers/live.ts`: when the budget runs out after attempts ran, stop and fail; skip only when no attempt ran.

````ts find:src/tiers/live.ts
	let judge: { pass: boolean; reason: string } | undefined;

	for (let n = 0; n < maxAttempts; n++) {
````

````ts replace:src/tiers/live.ts
	let judge: { pass: boolean; reason: string } | undefined;
	let budgetStop: string | undefined;

	for (let n = 0; n < maxAttempts; n++) {
````

````ts find:src/tiers/live.ts
		if (opts.budget.spent >= opts.budget.limit) {
			return {
````

````ts replace:src/tiers/live.ts
		if (opts.budget.spent >= opts.budget.limit) {
			if (attempts.length > 0) {
				// Attempts already ran and fewer than `pass` passed: stopping
				// here must fail the case, never hide those attempts as a skip.
				budgetStop = budgetExhaustedReason(opts.budget);
				break;
			}
			return {
````

````ts find:src/tiers/live.ts
					`live scenario ${scenario.id}: ${passed} of ${attempts.length} attempt(s) passed, needed ${need} of ${maxAttempts}.`,
````

````ts replace:src/tiers/live.ts
					`live scenario ${scenario.id}: ${passed} of ${attempts.length} attempt(s) passed, needed ${need} of ${maxAttempts}${budgetStop === undefined ? "" : ` (${budgetStop})`}.`,
````

3. `src/run.ts`: create the budget once, above the version loop.

````ts find:src/run.ts
	const results: CaseResult[] = [];

	// 4. One pass per opencode version.
````

````ts replace:src/run.ts
	const results: CaseResult[] = [];
	// One budget for the whole live tier across every opencode version
	// (SPEC 5.1: "hard stop for the whole live tier").
	const budget: LiveBudget = { spent: 0, limit: config.live.budgetUSD };

	// 4. One pass per opencode version.
````

````ts find:src/run.ts
			if (pending.length > 0) {
				const budget: LiveBudget = { spent: 0, limit: config.live.budgetUSD };
				const keys = collectLiveKeys(config);
````

````ts replace:src/run.ts
			if (pending.length > 0) {
				const keys = collectLiveKeys(config);
````

**Acceptance:**

```bash
bun test ./test/unit/live-loop.test.ts ./test/unit/run-budget.test.ts   # " 7 pass", " 0 fail"
bun run check                                                           # " 231 pass", " 0 fail"
```

Commit: `v1.1 M5: budget exhaustion fails started cases; one budget per run`.

### M6: Fresh evidence per case, and input hygiene (B5)

Every tier must empty its case's evidence dir before it starts, because the probe appends. The scenario id becomes a dir name, so ids that collide with the tool's own case dirs (`load`, `bun-test`) are rejected, and `--opencode` values (also a path segment) are validated like `opencode.versions`.

**Do:**

1. Create both test files:

````ts file:test/unit/run-inputs.test.ts
// Review B5 and input hygiene: a re-run into the same out dir never sees the
// previous run's evidence, evidence dirs are only ever reset inside the out
// dir, and bad --scenario / --opencode values are rejected up front.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseRunArgs } from "../../src/cli.ts";
import { runCi } from "../../src/run.ts";
import { resetDir } from "../../src/util/fs.ts";
import type { FakeRun } from "../helpers/fake-opencode.ts";
import {
	isolateCiEnv,
	makePlugin,
	PLUGIN_JS,
	useFake,
} from "../helpers/run-ci.ts";
import { tempDir } from "../helpers/tmp.ts";

isolateCiEnv();

describe("run inputs and evidence dirs", () => {
	test("a second run in the same out dir never sees the first run's evidence", async () => {
		const called: FakeRun = {
			toolCalls: [{ tool: "echo_tool", result: { content: "echo:hi" } }],
		};
		// Run 1: tier 1, then the scenario (the tool is called).
		// Run 2: tier 1, then the scenario (the tool is NOT called).
		useFake([{}, called, {}, {}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/scenarios/echo.yaml":
				"id: echo\nmode: scripted\nprompt: hi\nscript:\n  - text: done\nexpect:\n  tools:\n    - name: echo_tool\n",
		});
		const first = await runCi({ cwd, quiet: true });
		expect(first.exitCode).toBe(0);
		const second = await runCi({ cwd, quiet: true });
		expect(second.exitCode).toBe(1);
	});

	test("resetDir refuses paths outside the root", () => {
		const root = tempDir("reset-root-");
		expect(() => resetDir(join(root, ".."), root)).toThrow("refusing to reset");
		expect(() => resetDir(root, root)).toThrow("refusing to reset");
		resetDir(join(root, "2.0.26", "load"), root);
	});

	test("an unknown --scenario id is a configuration error", async () => {
		useFake([{}]);
		const cwd = makePlugin({
			"index.ts": PLUGIN_JS,
			".opencode-ci/scenarios/smoke.yaml":
				"id: smoke\nmode: scripted\nprompt: hi\nscript:\n  - text: done\n",
		});
		await expect(
			runCi({ cwd, scenarios: ["smok"], quiet: true }),
		).rejects.toThrow("unknown --scenario id(s): smok (known: smoke).");
	});

	test("--opencode accepts x.y.z and latest, rejects path syntax", () => {
		expect(parseRunArgs(["--opencode", "2.0.26,latest"]).opencodes).toEqual([
			"2.0.26",
			"latest",
		]);
		expect(() => parseRunArgs(["--opencode", "../.."])).toThrow(
			'Invalid --opencode "../..": expected x.y.z or "latest".',
		);
	});
});
````

````ts file:test/unit/scenario-rules.test.ts
// Review B5 follow-ups: scenario ids that collide with the tool's own case
// ids are rejected, and workspace files must stay inside the project dir.
import { describe, expect, test } from "bun:test";
import { ScenarioSchema } from "../../src/config/schema.ts";

const base = { mode: "scripted", prompt: "hi", script: [] };

describe("scenario rules", () => {
	test("ids load and bun-test are reserved", () => {
		for (const id of ["load", "bun-test"]) {
			const parsed = ScenarioSchema.safeParse({ ...base, id });
			expect(parsed.success).toBe(false);
			if (!parsed.success) {
				expect(parsed.error.issues[0]?.message).toBe(
					`scenario "${id}": id "${id}" is reserved (the tool uses it for its own case and evidence dir)`,
				);
			}
		}
	});

	test("workspace paths must stay inside the project dir", () => {
		for (const key of ["../escape.txt", "a/../../b", "/etc/passwd"]) {
			const parsed = ScenarioSchema.safeParse({
				...base,
				id: "ws",
				workspace: { [key]: "x" },
			});
			expect(parsed.success).toBe(false);
			if (!parsed.success) {
				expect(parsed.error.issues[0]?.message).toBe(
					`scenario "ws": workspace path "${key}" must be relative and stay inside the project dir`,
				);
			}
		}
		const ok = ScenarioSchema.safeParse({
			...base,
			id: "ws",
			workspace: { "a/b.txt": "x", ".env": "A=1" },
		});
		expect(ok.success).toBe(true);
	});
});
````

   Run them. Expected now: `run-inputs` fails to load (`Export named 'parseRunArgs' not found` or `'resetDir' not found`), and `scenario-rules` gives ` 0 pass`, ` 2 fail`.

2. `src/util/fs.ts`: add `resetDir`. Add `rmSync` to the existing `node:fs` import and a `node:path` import:

````ts find:src/util/fs.ts
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";

/** mkdir -p. */
export function ensureDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}
````

````ts replace:src/util/fs.ts
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, relative } from "node:path";

/** mkdir -p. */
export function ensureDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

/**
 * Empty `dir` (rm -rf, then mkdir -p). Evidence dirs are reset before each
 * case because the probe appends: records left by an earlier run in the same
 * out dir would otherwise be evaluated as if this run produced them. Refuses
 * any `dir` that is not strictly inside `root`, so a bad path segment can
 * never delete something outside the out dir.
 */
export function resetDir(dir: string, root: string): void {
	const rel = relative(root, dir);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`refusing to reset ${dir}: it is not inside ${root}`);
	}
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
}
````

3. Use it in all four tiers: each tier's one `mkdirSync(evidenceDir, { recursive: true });` becomes `resetDir(evidenceDir, opts.outDir);`. `src/tiers/live.ts` still uses `mkdirSync` for attempt dirs, so its `node:fs` import stays; `load.ts`, `scripted.ts` and `ui-static.ts` drop `mkdirSync` from theirs. The four call replacements:

````ts find:src/tiers/load.ts
	mkdirSync(evidenceDir, { recursive: true });
````

````ts replace:src/tiers/load.ts
	resetDir(evidenceDir, opts.outDir);
````

````ts find:src/tiers/scripted.ts
	mkdirSync(evidenceDir, { recursive: true });
````

````ts replace:src/tiers/scripted.ts
	resetDir(evidenceDir, opts.outDir);
````

````ts find:src/tiers/ui-static.ts
	mkdirSync(evidenceDir, { recursive: true });
````

````ts replace:src/tiers/ui-static.ts
	resetDir(evidenceDir, opts.outDir);
````

````ts find:src/tiers/live.ts
	mkdirSync(evidenceDir, { recursive: true });
````

````ts replace:src/tiers/live.ts
	resetDir(evidenceDir, opts.outDir);
````

   The import edits:

````ts find:src/tiers/load.ts
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
````

````ts replace:src/tiers/load.ts
import { copyFileSync, writeFileSync } from "node:fs";
````

````ts find:src/tiers/load.ts
import { startStub } from "../stub/stub.ts";
````

````ts replace:src/tiers/load.ts
import { startStub } from "../stub/stub.ts";
import { resetDir } from "../util/fs.ts";
````

````ts find:src/tiers/scripted.ts
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
````

````ts replace:src/tiers/scripted.ts
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
````

````ts find:src/tiers/scripted.ts
import { startStub } from "../stub/stub.ts";
````

````ts replace:src/tiers/scripted.ts
import { startStub } from "../stub/stub.ts";
import { resetDir } from "../util/fs.ts";
````

````ts find:src/tiers/ui-static.ts
import { mkdirSync, writeFileSync } from "node:fs";
````

````ts replace:src/tiers/ui-static.ts
import { writeFileSync } from "node:fs";
````

````ts find:src/tiers/ui-static.ts
import type { CaseResult } from "../report/results.ts";
````

````ts replace:src/tiers/ui-static.ts
import type { CaseResult } from "../report/results.ts";
import { resetDir } from "../util/fs.ts";
````

````ts find:src/tiers/live.ts
import { type RunOutput, Sandbox } from "../sandbox/sandbox.ts";
import { runJudge } from "./judge.ts";
````

````ts replace:src/tiers/live.ts
import { type RunOutput, Sandbox } from "../sandbox/sandbox.ts";
import { resetDir } from "../util/fs.ts";
import { runJudge } from "./judge.ts";
````

4. `src/config/schema.ts`: export `versionSchema`, reserve the tool's ids, and keep workspace paths inside the project.

````ts find:src/config/schema.ts
import { z } from "zod";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SCENARIO_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const versionSchema = z.union([
````

````ts replace:src/config/schema.ts
import { isAbsolute } from "node:path";
import { z } from "zod";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SCENARIO_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
// Case ids the runner itself uses: tier 1 ("load") and the escape hatch.
const RESERVED_IDS = ["load", "bun-test"];

export const versionSchema = z.union([
````

````ts find:src/config/schema.ts
	.superRefine((val, ctx) => {
		const tag = `scenario "${val.id}"`;
````

````ts replace:src/config/schema.ts
	.superRefine((val, ctx) => {
		const tag = `scenario "${val.id}"`;
		if (RESERVED_IDS.includes(val.id)) {
			ctx.addIssue({
				code: "custom",
				path: ["id"],
				message: `${tag}: id "${val.id}" is reserved (the tool uses it for its own case and evidence dir)`,
			});
		}
		for (const key of Object.keys(val.workspace ?? {})) {
			if (isAbsolute(key) || key.split(/[\\/]/).includes("..")) {
				ctx.addIssue({
					code: "custom",
					path: ["workspace", key],
					message: `${tag}: workspace path "${key}" must be relative and stay inside the project dir`,
				});
			}
		}
````

5. `src/cli.ts`: export the flag parser (tests call it) and validate `--opencode`.

````ts find:src/cli.ts
import { ConfigError, loadAll } from "./config/load.ts";
````

````ts replace:src/cli.ts
import { ConfigError, loadAll } from "./config/load.ts";
import { versionSchema } from "./config/schema.ts";
````

````ts find:src/cli.ts
interface RunFlags {
````

````ts replace:src/cli.ts
export interface RunFlags {
````

````ts find:src/cli.ts
function parseRunArgs(args: string[]): RunFlags {
````

````ts replace:src/cli.ts
export function parseRunArgs(args: string[]): RunFlags {
````

````ts find:src/cli.ts
			opencodes.push(...collectValues([raw]));
````

````ts replace:src/cli.ts
			for (const version of collectValues([raw])) {
				// The version becomes an evidence path segment, so it must
				// never contain path syntax: same rule as opencode.versions.
				if (!versionSchema.safeParse(version).success) {
					throw new UsageError(
						`Invalid --opencode ${JSON.stringify(version)}: expected x.y.z or "latest".`,
					);
				}
				opencodes.push(version);
			}
````

6. `src/run.ts`: an unknown `--scenario` id is a configuration error (it used to run nothing and exit 0).

````ts find:src/run.ts
import { loadAll } from "./config/load.ts";
````

````ts replace:src/run.ts
import { ConfigError, loadAll } from "./config/load.ts";
````

````ts find:src/run.ts
	const pluginPath = resolve(cwd, config.plugin.path);
	// 2. Install + build once, before resolving entries: the entry is often
````

````ts replace:src/run.ts
	const unknown = (wantedScenarios ?? []).filter(
		(id) => !scenarios.some((scenario) => scenario.id === id),
	);
	if (unknown.length > 0) {
		throw new ConfigError(
			`unknown --scenario id(s): ${unknown.join(", ")} (known: ${scenarios.map((s) => s.id).join(", ") || "none"}).`,
		);
	}

	const pluginPath = resolve(cwd, config.plugin.path);
	// 2. Install + build once, before resolving entries: the entry is often
````

**Acceptance:**

```bash
bun test ./test/unit/run-inputs.test.ts ./test/unit/scenario-rules.test.ts   # " 6 pass", " 0 fail"
bun run check                                                                # " 237 pass", " 0 fail"
```

Then re-run M1 step 2 with a fresh copy (`rm -rf review/spike-v1.1/stale review/spike-v1.1/stale-out*` first). Expected now: `run1 exit=0`, `run2 exit=1`, `run3 exit=1`, and both inventory counts `1`.

Commit: `v1.1 M6: reset evidence dirs per case; reserve tool ids; validate --opencode and --scenario`.

### M7: Remove config fields that do nothing; wire up timeouts (S3)

Decision (SPEC decision 19): fields with no effect are removed, so setting them fails validation instead of being silently ignored. `expect.providers` and `expect.models` (provider checks are v2), `gate.window` and `gate.threshold` (the verbatim gate hard-codes 5 and 0.9), and scenario `judgeReply` (scripted scenarios never run the judge; live ones never use the stub). `live.timeoutMs` [240000] becomes the default for live attempts, so scenario `timeoutMs` loses its schema default; scripted runs keep 120000.

**Do:**

1. `src/config/schema.ts`:

````ts find:src/config/schema.ts
		mcp: stringArray(),
		providers: stringArray(),
		models: stringArray(),
	})
````

````ts replace:src/config/schema.ts
		mcp: stringArray(),
	})
````

````ts find:src/config/schema.ts
		enabled: z.boolean().default(true),
		window: z.number().int().positive().default(5),
		threshold: z.number().min(0).max(1).default(0.9),
		bootstrap: z.enum(["fail", "allow"]).default("fail"),
````

````ts replace:src/config/schema.ts
		enabled: z.boolean().default(true),
		bootstrap: z.enum(["fail", "allow"]).default("fail"),
````

````ts find:src/config/schema.ts
		judgeReply: z.string().optional(),
		timeoutMs: z.number().int().positive().default(120_000),
````

````ts replace:src/config/schema.ts
		// No default here: scripted runs fall back to 120000 and live runs to
		// config.live.timeoutMs, so an unset value must stay distinguishable.
		timeoutMs: z.number().int().positive().optional(),
````

````ts find:src/config/schema.ts
		if (val.mode === "live" && val.judgeReply !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["judgeReply"],
				message: `${tag}: field "judgeReply" is scripted-only and is not allowed when mode is "live"`,
			});
		}
````

````ts replace:src/config/schema.ts
````

   (The replacement is empty: delete that `if` block. Keep the closing `});` of `superRefine` that follows it.)

2. `src/tiers/scripted.ts`:

````ts find:src/tiers/scripted.ts
		script: scenario.script ?? [],
		judgeReply: scenario.judgeReply,
````

````ts replace:src/tiers/scripted.ts
		script: scenario.script ?? [],
````

````ts find:src/tiers/scripted.ts
	let run: RunOutput | undefined;
	try {
		run = await sandbox.run(scenario.prompt, {
			timeoutMs: scenario.timeoutMs,
		});
````

````ts replace:src/tiers/scripted.ts
	const timeoutMs = scenario.timeoutMs ?? 120_000;
	let run: RunOutput | undefined;
	try {
		run = await sandbox.run(scenario.prompt, { timeoutMs });
````

````ts find:src/tiers/scripted.ts
			failures.push(`opencode run timed out after ${scenario.timeoutMs}ms.`);
````

````ts replace:src/tiers/scripted.ts
			failures.push(`opencode run timed out after ${timeoutMs}ms.`);
````

3. `src/tiers/live.ts`:

````ts find:src/tiers/live.ts
	const resolvedModel = model;

	const need = opts.config.live.pass;
````

````ts replace:src/tiers/live.ts
	const resolvedModel = model;

	// Live models are slower than the stub: an unset scenario timeout uses
	// config.live.timeoutMs [240000], not the scripted default.
	const timeoutMs = scenario.timeoutMs ?? opts.config.live.timeoutMs;
	const need = opts.config.live.pass;
````

````ts find:src/tiers/live.ts
			run = await sandbox.run(scenario.prompt, {
				timeoutMs: scenario.timeoutMs,
			});
````

````ts replace:src/tiers/live.ts
			run = await sandbox.run(scenario.prompt, { timeoutMs });
````

````ts find:src/tiers/live.ts
				failures.push(`opencode run timed out after ${scenario.timeoutMs}ms.`);
````

````ts replace:src/tiers/live.ts
				failures.push(`opencode run timed out after ${timeoutMs}ms.`);
````

````ts find:src/tiers/live.ts
				timeoutMs: scenario.timeoutMs,
				text: textOf(run.events),
````

````ts replace:src/tiers/live.ts
				timeoutMs,
				text: textOf(run.events),
````

4. Update `test/unit/config-schema.test.ts`:

````ts find:test/unit/config-schema.test.ts
			mcp: [],
			providers: [],
			models: [],
		});
````

````ts replace:test/unit/config-schema.test.ts
			mcp: [],
		});
````

````ts find:test/unit/config-schema.test.ts
		expect(config.gate.enabled).toBe(true);
		expect(config.gate.window).toBe(5);
		expect(config.gate.threshold).toBe(0.9);
````

````ts replace:test/unit/config-schema.test.ts
		expect(config.gate.enabled).toBe(true);
````

````ts find:test/unit/config-schema.test.ts
	test("judgeReply is scripted-only", () => {
		const parsed = ScenarioSchema.safeParse({
			id: "live-x",
			mode: "live",
			prompt: "hi",
			judgeReply: '{"pass":true}',
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toMatch(/"judgeReply"/);
		}
	});
````

````ts replace:test/unit/config-schema.test.ts
	test("judgeReply is no longer a scenario field", () => {
		const parsed = ScenarioSchema.safeParse({
			...scriptedBase,
			judgeReply: '{"pass":true}',
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toMatch(/judgeReply/);
		}
	});

	test("removed config fields fail validation instead of being ignored", () => {
		for (const raw of [
			{ expect: { providers: ["p"] } },
			{ expect: { models: ["m"] } },
			{ gate: { window: 10 } },
			{ gate: { threshold: 0.5 } },
		]) {
			expect(ConfigSchema.safeParse(raw).success).toBe(false);
		}
	});
````

````ts find:test/unit/config-schema.test.ts
	test("scenario timeoutMs defaults to 120000", () => {
		const parsed = ScenarioSchema.safeParse(scriptedBase);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.timeoutMs).toBe(120_000);
````

````ts replace:test/unit/config-schema.test.ts
	test("scenario timeoutMs has no schema default (tiers apply their own)", () => {
		const parsed = ScenarioSchema.safeParse(scriptedBase);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.timeoutMs).toBeUndefined();
````

   `scriptedBase` is already defined in that file; it is a valid scripted scenario.

5. Regenerate the JSON Schemas: `bun run schema`. `git diff --stat schema/` must show both `schema/config.json` and `schema/scenario.json` changed.

**Acceptance:**

```bash
grep -rn "judgeReply\|providers\|threshold" src/config/schema.ts   # prints nothing
grep -n "scenario.timeoutMs" src/tiers/*.ts                        # only the two "scenario.timeoutMs ??" lines
bun run check                                                      # " 238 pass", " 0 fail" (schema-sync passes)
```

Commit: `v1.1 M7: remove no-op config fields; live.timeoutMs is the live default`.

### M8: A value that was never recorded fails (S4)

**Do:**

1. Create the test file:

````ts file:test/unit/matchers-missing.test.ts
// Review S4: a value that was never recorded fails every matcher except
// `exists: false`, so a misspelled field cannot pass a negative matcher.
import { describe, expect, test } from "bun:test";
import { check } from "../../src/assert/matchers.ts";

describe("matchers on a value that was never recorded", () => {
	test("notContains fails instead of passing vacuously", () => {
		expect(check(undefined, { notContains: "secret" }, "input.comand")).toEqual(
			["input.comand: no value was recorded (check the field name)."],
		);
	});

	test("notMatches and equals fail the same way", () => {
		expect(check(undefined, { notMatches: "x" }, "a")).toEqual([
			"a: no value was recorded (check the field name).",
		]);
		expect(check(undefined, { equals: "x" }, "a")).toEqual([
			"a: no value was recorded (check the field name).",
		]);
	});

	test("exists: false passes, exists: true fails", () => {
		expect(check(undefined, { exists: false }, "x")).toEqual([]);
		expect(check(undefined, { exists: true }, "x")).toEqual([
			"x: expected value to exist, got undefined.",
		]);
	});

	test("null counts as recorded", () => {
		expect(check(null, { notContains: "secret" }, "x")).toEqual([]);
	});
});
````

   Run it. Expected now: ` 2 pass`, ` 2 fail`.

2. `src/assert/matchers.ts`, at the top of `check`:

````ts find:src/assert/matchers.ts
	label: string,
): string[] {
	const failures: string[] = [];
````

````ts replace:src/assert/matchers.ts
	label: string,
): string[] {
	// A field that was never recorded fails every matcher except
	// `exists: false`. Otherwise a typo in a field name (`comand`) would let
	// `notContains`/`notMatches` pass vacuously.
	if (value === undefined && matcher.exists !== true) {
		return matcher.exists === false
			? []
			: [`${label}: no value was recorded (check the field name).`];
	}

	const failures: string[] = [];
````

   `exists: true` on a missing value keeps its existing message (`expected value to exist, got undefined.`), which the existing code already produces.

**Acceptance:**

```bash
bun test ./test/unit/matchers-missing.test.ts   # " 4 pass"
bun run check                                   # " 242 pass", " 0 fail"
bun test ./test/e2e/tier2.test.ts               # all pass: no fixture relied on a missing value
```

Commit: `v1.1 M8: missing values fail every matcher except exists: false`.

### M9: Namespaced tool names (S5)

**Do:**

1. Create the test file:

````ts file:test/unit/namespaced-tools.test.ts
// Review S5: hooks record a namespaced tool as <namespace>_<name>, while
// catalogs use tools.ns.name and inner calls ns.name. Assertions accept all
// three spellings, and a bare name fails with a hint.
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { evaluate, normalizeToolName } from "../../src/assert/expect.ts";
import { ScenarioSchema } from "../../src/config/schema.ts";
import { ProbeLog, type ProbeRecord } from "../../src/probe/read.ts";

describe("namespaced tool names", () => {
	test("normalizeToolName maps every spelling to the effective name", () => {
		expect(normalizeToolName("ns_spike_echo")).toBe("ns_spike_echo");
		expect(normalizeToolName("ns.spike_echo")).toBe("ns_spike_echo");
		expect(normalizeToolName("tools.ns.spike_echo")).toBe("ns_spike_echo");
		expect(normalizeToolName('tools.ns["my-tool"]')).toBe("ns_my-tool");
		expect(normalizeToolName("echo_tool")).toBe("echo_tool");
	});

	function evidence(tool: string) {
		const records: ProbeRecord[] = [
			{
				kind: "tool.before",
				phase: "post",
				seq: 0,
				tool,
				callID: "c1",
				input: { text: "hi" },
			},
			{
				kind: "tool.after",
				phase: "post",
				seq: 1,
				tool,
				callID: "c1",
				status: "completed",
				result: { content: "echo:hi" },
			},
		];
		return {
			run: {
				code: 0,
				timedOut: false,
				stdout: "",
				stderr: "",
				events: [],
				durationMs: 0,
			},
			probe: new ProbeLog(records),
			stubRequests: [],
			projectDir: tmpdir(),
			mode: "scripted" as const,
		};
	}

	function expectBlock(block: unknown) {
		return ScenarioSchema.parse({
			id: "ns",
			mode: "scripted",
			prompt: "hi",
			script: [],
			expect: block,
		}).expect;
	}

	test("the dotted catalog form matches the recorded effective name", () => {
		const failures = evaluate(
			expectBlock({ tools: [{ name: "ns.spike_echo", status: "completed" }] }),
			evidence("ns_spike_echo"),
		);
		expect(failures).toEqual([]);
	});

	test("a bare name fails with a hint naming the namespaced form", () => {
		const failures = evaluate(
			expectBlock({ tools: [{ name: "spike_echo" }] }),
			evidence("ns_spike_echo"),
		);
		expect(failures.join("\n")).toContain("did you mean ns_spike_echo?");
	});

	test("noTools catches the dotted form", () => {
		const failures = evaluate(
			expectBlock({ noTools: ["ns.spike_echo"] }),
			evidence("ns_spike_echo"),
		);
		expect(failures.join("\n")).toContain(
			'expected tool "ns.spike_echo" not to be called',
		);
	});
});
````

   Run it. Expected now: the file fails to load (`Export named 'normalizeToolName' not found`).

2. `src/assert/expect.ts`: add the normalizer and a hint helper right before `const HOOK_KINDS`. `pathSegments` already exists in this file (it parses `tools.ns["my-tool"]`).

````ts find:src/assert/expect.ts
const HOOK_KINDS: Record<string, string> = {
````

````ts replace:src/assert/expect.ts
/**
 * Canonical tool name for comparisons. Hooks record a namespaced tool under
 * its effective name `<namespace>_<name>` (dots in the namespace become
 * underscores), while catalogs and `tool_use` inner calls use dots
 * (`tools.ns.my_tool`, `ns.my_tool`). Joining the segments with `_` maps all
 * of those to the effective name.
 */
export function normalizeToolName(name: string): string {
	const segments =
		name.startsWith("tools.") || name.startsWith("tools[")
			? pathSegments(name)
			: name.split(".");
	return segments.join("_");
}

/** Recorded names that end in `_<wanted>`: likely the namespaced form the author meant. */
function namespacedHints(recorded: string[], wanted: string): string[] {
	const suffix = `_${normalizeToolName(wanted)}`;
	return [...new Set(recorded.filter((name) => name.endsWith(suffix)))];
}

const HOOK_KINDS: Record<string, string> = {
````

   Then use it in the three comparisons. `tools`:

````ts find:src/assert/expect.ts
		const calls = ev.probe
			.toolCalls("post")
			.filter((call) => call.tool === tool.name);
		failures.push(
			...check(calls.length, { count: tool.count ?? { gte: 1 } }, label),
		);
		if (calls.length === 0) {
			return;
		}
````

````ts replace:src/assert/expect.ts
		const recorded = ev.probe.toolCalls("post");
		const calls = recorded.filter(
			(call) => normalizeToolName(call.tool) === normalizeToolName(tool.name),
		);
		failures.push(
			...check(calls.length, { count: tool.count ?? { gte: 1 } }, label),
		);
		if (calls.length === 0) {
			const hints = namespacedHints(
				recorded.map((call) => call.tool),
				tool.name,
			);
			if (hints.length > 0) {
				failures.push(
					`${label}: namespaced tools are recorded as <namespace>_<name>; did you mean ${hints.join(" or ")}?`,
				);
			}
			return;
		}
````

   `noTools`:

````ts find:src/assert/expect.ts
		if (probeNames.includes(name) || eventNames.includes(name)) {
````

````ts replace:src/assert/expect.ts
		const wanted = normalizeToolName(name);
		if (
			[...probeNames, ...eventNames].some(
				(called) => normalizeToolName(called) === wanted,
			)
		) {
````

   `hooks[].tool`:

````ts find:src/assert/expect.ts
		if (hook.tool !== undefined) {
			candidates = candidates.filter(
				(record) => String(record.tool ?? "") === hook.tool,
			);
		}
````

````ts replace:src/assert/expect.ts
		if (hook.tool !== undefined) {
			const wanted = normalizeToolName(hook.tool);
			candidates = candidates.filter(
				(record) => normalizeToolName(String(record.tool ?? "")) === wanted,
			);
		}
````

   Leave `request.tools` (the `includes` check on offered tools) unchanged: it already matches catalog names by their last segment.

**Acceptance:**

```bash
bun test ./test/unit/namespaced-tools.test.ts   # " 4 pass"
bun run check                                   # " 246 pass", " 0 fail"
```

Commit: `v1.1 M9: normalize namespaced tool names in assertions`.

### M10: Gate history on pull requests and in matrix builds (S6, S7)

**Do:**

1. Create the test file:

````ts file:test/unit/gate-wiring.test.ts
// Review S6 and S7: pull request runs read the base branch's gate history,
// and `run --gate-artifact` (what the Action passes) names the history
// artifact.
import { describe, expect, test } from "bun:test";
import { parseRunArgs } from "../../src/cli.ts";
import { historyBranch } from "../../src/gate/history.ts";

describe("gate wiring", () => {
	test("pull request runs read the base branch; other runs their own ref", () => {
		expect(
			historyBranch({ GITHUB_REF_NAME: "4/merge", GITHUB_BASE_REF: "main" }),
		).toBe("main");
		expect(
			historyBranch({ GITHUB_REF_NAME: "main", GITHUB_BASE_REF: "" }),
		).toBe("main");
		expect(historyBranch({ GITHUB_REF_NAME: "release" })).toBe("release");
		expect(historyBranch({})).toBeUndefined();
	});

	test("--gate-artifact is parsed in both spellings", () => {
		expect(parseRunArgs(["--gate-artifact", "leg-a"]).gateArtifact).toBe(
			"leg-a",
		);
		expect(parseRunArgs(["--gate-artifact=leg-b"]).gateArtifact).toBe("leg-b");
		expect(parseRunArgs([]).gateArtifact).toBeUndefined();
	});
});
````

   Run it. Expected now: the file fails to load (`Export named 'historyBranch' not found`).

2. `src/gate/history.ts`: add `historyBranch` and delete the downloaded history after reading it. Add `rmSync` to the `node:fs` import:

````ts find:src/gate/history.ts
import { mkdtempSync, readFileSync } from "node:fs";
````

````ts replace:src/gate/history.ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
````

````ts find:src/gate/history.ts
/** Resolve the workflow file name: explicit config wins, else GITHUB_WORKFLOW_REF. */
````

````ts replace:src/gate/history.ts
/**
 * Branch whose runs form the gate history. On pull_request runs
 * GITHUB_REF_NAME is "<n>/merge", which no run is ever filed under (gh lists
 * runs by head branch), so PR runs read the target branch's history from
 * GITHUB_BASE_REF, which GitHub sets only on pull request events.
 */
export function historyBranch(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const base = env.GITHUB_BASE_REF;
	if (base !== undefined && base.length > 0) {
		return base;
	}
	return env.GITHUB_REF_NAME;
}

/** Resolve the workflow file name: explicit config wins, else GITHUB_WORKFLOW_REF. */
````

   Then split `fetchHistory` so the temp dir is always removed. Find the line that creates `tmpRoot` and the `const history` line after it:

````ts find:src/gate/history.ts
	const tmpRoot =
		opts.tmpDir ?? mkdtempSync(join(tmpdir(), "opencode-ci-gate-"));
	const history: GateHistoryRun[] = [];
````

````ts replace:src/gate/history.ts
	const tmpRoot =
		opts.tmpDir ?? mkdtempSync(join(tmpdir(), "opencode-ci-gate-"));
	try {
		return await downloadHistory(opts, run, runs, tmpRoot);
	} finally {
		if (opts.tmpDir === undefined) {
			rmSync(tmpRoot, { recursive: true, force: true });
		}
	}
}

async function downloadHistory(
	opts: FetchHistoryOptions,
	run: CommandRunner,
	runs: { id: number; createdAt: string }[],
	tmpRoot: string,
): Promise<GateHistoryRun[]> {
	const history: GateHistoryRun[] = [];
````

   The rest of the old `fetchHistory` body (the download loop and `return history;`) now forms the body of `downloadHistory`; do not change it. Inside `fetchHistory`, the command runner is the local `run`, the sorted run list is the local `runs`, and the options parameter is `opts: FetchHistoryOptions`, so the call and the new signature match them.

3. `src/gate/gate.ts`: use it.

````ts find:src/gate/gate.ts
	gatePrerequisites,
	resolveWorkflowName,
````

````ts replace:src/gate/gate.ts
	gatePrerequisites,
	historyBranch,
	resolveWorkflowName,
````

````ts find:src/gate/gate.ts
	const branch = env.GITHUB_REF_NAME;
````

````ts replace:src/gate/gate.ts
	const branch = historyBranch(env);
````

4. `src/cli.ts`: add `--gate-artifact <name>` (and `--gate-artifact=<name>`).

````ts find:src/cli.ts
//                                [--opencode v]... [--out dir] [--keep] [--gate]
````

````ts replace:src/cli.ts
//                                [--opencode v]... [--out dir] [--keep] [--gate]
//                                [--gate-artifact name]
````

````ts find:src/cli.ts
  opencode-plugin-ci run [--tier load|scripted|live] [--scenario <id>] [--opencode <v>] [--out <dir>] [--keep] [--gate] [--verbose] [--quiet]
````

````ts replace:src/cli.ts
  opencode-plugin-ci run [--tier load|scripted|live] [--scenario <id>] [--opencode <v>] [--out <dir>] [--keep] [--gate] [--gate-artifact <name>] [--verbose] [--quiet]
````

````ts find:src/cli.ts
	keep: boolean;
	gate: boolean;
	verbose: boolean;
````

````ts replace:src/cli.ts
	keep: boolean;
	gate: boolean;
	gateArtifact?: string;
	verbose: boolean;
````

````ts find:src/cli.ts
	let out: string | undefined;
	let keep = false;
````

````ts replace:src/cli.ts
	let out: string | undefined;
	let gateArtifact: string | undefined;
	let keep = false;
````

````ts find:src/cli.ts
			if (arg === "--out") {
				i++;
			}
		} else if (arg === "--keep") {
````

````ts replace:src/cli.ts
			if (arg === "--out") {
				i++;
			}
		} else if (
			arg === "--gate-artifact" ||
			arg.startsWith("--gate-artifact=")
		) {
			gateArtifact =
				arg === "--gate-artifact"
					? takeValue(args, i, "--gate-artifact")
					: arg.slice("--gate-artifact=".length);
			if (arg === "--gate-artifact") {
				i++;
			}
		} else if (arg === "--keep") {
````

````ts find:src/cli.ts
	return { tiers, scenarios, opencodes, out, keep, gate, verbose, quiet };
````

````ts replace:src/cli.ts
	return {
		tiers,
		scenarios,
		opencodes,
		out,
		keep,
		gate,
		gateArtifact,
		verbose,
		quiet,
	};
````

````ts find:src/cli.ts
			gate: flags.gate,
			verbose: flags.verbose,
````

````ts replace:src/cli.ts
			gate: flags.gate,
			gateArtifact: flags.gateArtifact,
			verbose: flags.verbose,
````

5. `src/run.ts`: the flag overrides `gate.artifact`.

````ts find:src/run.ts
	gate?: boolean;
	verbose?: boolean;
````

````ts replace:src/run.ts
	gate?: boolean;
	/** Overrides gate.artifact; the Action passes its artifact-name input. */
	gateArtifact?: string;
	verbose?: boolean;
````

````ts find:src/run.ts
	const gateOutcome = await runGate({
		cwd,
		config,
````

````ts replace:src/run.ts
	const gateConfig: Config =
		opts?.gateArtifact === undefined
			? config
			: { ...config, gate: { ...config.gate, artifact: opts.gateArtifact } };
	const gateOutcome = await runGate({
		cwd,
		config: gateConfig,
````

6. `src/config/schema.ts`, the comment on `artifact`:

````ts find:src/config/schema.ts
		// Artifact name the gate downloads history from. Must match the
		// `artifact-name` input of the GitHub Action (M13); matrix users
		// set a distinct name per leg here and there.
````

````ts replace:src/config/schema.ts
		// Artifact name the gate downloads history from. `run --gate-artifact`
		// overrides it; the GitHub Action passes its `artifact-name` input
		// that way, so matrix legs never need per-leg config.
````

7. `action.yml`: pass the input through `env:` (never interpolate inputs into `run:`).

````yaml find:action.yml
  artifact-name:
    description: "Artifact name for evidence + results (must match gate.artifact; use a distinct name per matrix leg)"
    default: "opencode-plugin-ci-results"
````

````yaml replace:action.yml
  artifact-name:
    description: "Artifact name for evidence + results. The gate also reads history from this name, so use a distinct name per matrix leg."
    default: "opencode-plugin-ci-results"
````

````yaml find:action.yml
        IN_VERSIONS: ${{ inputs.opencode-versions }}
````

````yaml replace:action.yml
        IN_VERSIONS: ${{ inputs.opencode-versions }}
        IN_ARTIFACT: ${{ inputs.artifact-name }}
````

````yaml find:action.yml
        set +e
        bun "$ACTION_PATH/bin/opencode-plugin-ci.ts" run "${args[@]}" --out .opencode-ci/out
````

````yaml replace:action.yml
        args+=(--gate-artifact "$IN_ARTIFACT")
        set +e
        bun "$ACTION_PATH/bin/opencode-plugin-ci.ts" run "${args[@]}" --out .opencode-ci/out
````

**Acceptance:**

```bash
bun test ./test/unit/gate-wiring.test.ts                 # " 2 pass"
bun run check                                            # " 248 pass", " 0 fail"
bun -e 'const {parse}=require("yaml");const a=parse(require("fs").readFileSync("action.yml","utf8"));console.log(a.runs.steps.find(s=>s.id==="run").run)' | grep -c 'inputs\.'   # 0: no inputs interpolated into the script
bun bin/opencode-plugin-ci.ts --help | grep -c -- --gate-artifact   # 1
```

Commit: `v1.1 M10: PR gate history from the base branch; --gate-artifact`.

### M11: Small fixes

**Do:**

1. `src/tiers/judge.ts`: the stub judge must default to a fail, never a pass.

````ts find:src/tiers/judge.ts
			judgeReply: opts.stubReply ?? '{"pass":true,"reason":"stubbed"}',
````

````ts replace:src/tiers/judge.ts
			judgeReply:
				opts.stubReply ?? '{"pass":false,"reason":"no stubReply given"}',
````

2. `src/config/load.ts`: the "using defaults" warning is returned in `warnings` and printed by the caller, so it printed twice. Delete the direct print:

````ts find:src/config/load.ts
		for (const w of warnings) {
			console.warn(w);
		}
		return { config: ConfigSchema.parse({}), warnings };
````

````ts replace:src/config/load.ts
		return { config: ConfigSchema.parse({}), warnings };
````

3. `src/stub/codemode.ts`: the comment wrongly blamed the brief's regex.

````ts find:src/stub/codemode.ts
	// NOTE: the capture group below includes the trailing "(" (the `\(` sits
	// inside the group in the spec regex). Strip it so the result is a usable
	// call path such as `tools.spike_echo` rather than `tools.spike_echo(`.
````

````ts replace:src/stub/codemode.ts
	// The capture group includes the trailing "(", which is stripped so the
	// result is a usable call path such as `tools.spike_echo`.
````

4. No code change for these review nits; record each decision in NOTES.md:
   - Results keep `opencode` as the **requested** version (`latest`), because the required/allowed split, `report` and the gate key on it (SPEC 7.1).
   - The duplicate `probe-live.jsonl` copy in evidence dirs stays; it is harmless now that dirs are reset.
   - Gate history still downloads the full evidence artifact per run; splitting out a results-only artifact is a v2 item.

**Acceptance:**

```bash
grep -c '"pass":true' src/tiers/judge.ts   # 0
grep -c "console.warn" src/config/load.ts  # 0
bun run check                              # " 248 pass", " 0 fail"
```

Commit: `v1.1 M11: judge stub defaults to fail; single defaults warning; comment fix`.

### M12: Failing fixture scenarios and the Action self-test (S8)

SPEC 9 asks for a passing and a deliberately failing scenario per surface fixture; only `tool-basic` had one. The `tool-direct` fixture also never proved that its tool is direct.

**Do:**

1. Create the four failing scenarios:

````yaml file:test/fixtures/plugins/hook-mutate/.opencode-ci/scenarios/fail.yaml
id: hook-mutate-fail
description: Deliberately failing scenario (expects the raw command after the hook, which redacts it)
mode: scripted
prompt: Print the word secret.
script:
  - toolCalls:
      - name: shell
        arguments: { command: "echo secret", description: "print secret" }
  - text: done
expect:
  exitCode: 0
  hooks:
    - hook: tool.execute.before
      phase: post
      tool: shell
      input: { command: { equals: "echo secret" } }
````

````yaml file:test/fixtures/plugins/shell-env/.opencode-ci/scenarios/fail.yaml
id: shell-env-fail
description: Deliberately failing scenario (expects FIXTURE_ON=2, the hook injects 1)
mode: scripted
prompt: Show the fixture env var.
script:
  - toolCalls:
      - name: shell
        arguments:
          command: "echo FIXTURE_ON=$FIXTURE_ON"
          description: "print fixture env"
  - text: done
expect:
  exitCode: 0
  hooks:
    - hook: shell.create.before
      env: { FIXTURE_ON: { equals: "2" } }
````

````yaml file:test/fixtures/plugins/system-inject/.opencode-ci/scenarios/fail.yaml
id: system-inject-fail
description: Deliberately failing scenario (expects text the hook never adds)
mode: scripted
prompt: Hello.
script:
  - text: done
expect:
  exitCode: 0
  request:
    nth: 1
    system: { contains: FIXTURE-ABSENT }
````

````yaml file:test/fixtures/plugins/event-file/.opencode-ci/scenarios/fail.yaml
id: event-file-fail
description: Deliberately failing scenario (no tool call, so the event never fires and the file is never written)
mode: scripted
prompt: Just answer.
script:
  - text: done
expect:
  exitCode: 0
  files:
    - path: .fixture/events.log
      exists: true
````

2. Prove `tool-direct` is direct:

````yaml find:test/fixtures/plugins/tool-direct/.opencode-ci/scenarios/pass.yaml
      output: { contains: "echo:hi" }
  request:
````

````yaml replace:test/fixtures/plugins/tool-direct/.opencode-ci/scenarios/pass.yaml
      output: { contains: "echo:hi" }
  # codemode is false, so the call must not go through Code Mode's execute tool.
  noTools: [execute]
  request:
````

   Never add a failing scenario to `tool-direct` or `throws`: the Action self-test below expects `tool-direct` to pass as a whole and `throws` to fail.

3. Add the cases to `test/e2e/tier2.test.ts`:

````ts find:test/e2e/tier2.test.ts
	{ fixture: "hook-mutate", file: "pass.yaml", pass: true },
	{ fixture: "shell-env", file: "pass.yaml", pass: true },
	{ fixture: "system-inject", file: "pass.yaml", pass: true },
	{ fixture: "event-file", file: "pass.yaml", pass: true },
];
````

````ts replace:test/e2e/tier2.test.ts
	{ fixture: "hook-mutate", file: "pass.yaml", pass: true },
	{
		fixture: "hook-mutate",
		file: "fail.yaml",
		pass: false,
		contains:
			'hooks[0].tool.execute.before@post.input.command: expected "echo secret", got "echo [x]".',
	},
	{ fixture: "shell-env", file: "pass.yaml", pass: true },
	{
		fixture: "shell-env",
		file: "fail.yaml",
		pass: false,
		contains:
			'hooks[0].shell.create.before@post.env.FIXTURE_ON: expected "2", got "1".',
	},
	{ fixture: "system-inject", file: "pass.yaml", pass: true },
	{
		fixture: "system-inject",
		file: "fail.yaml",
		pass: false,
		contains: 'request.system: expected to contain "FIXTURE-ABSENT"',
	},
	{ fixture: "event-file", file: "pass.yaml", pass: true },
	{
		fixture: "event-file",
		file: "fail.yaml",
		pass: false,
		contains:
			"files[0]..fixture/events.log: expected file to exist, but it does not.",
	},
];
````

4. Add an Action self-test job at the end of `.github/workflows/ci.yml`:

````yaml find:.github/workflows/ci.yml
      - name: Run end-to-end tests
        env:
          OPENCODE_BIN: ${{ runner.temp }}/oc/node_modules/.bin/opencode
        run: bun run test:e2e
````

````yaml replace:.github/workflows/ci.yml
      - name: Run end-to-end tests
        env:
          OPENCODE_BIN: ${{ runner.temp }}/oc/node_modules/.bin/opencode
        run: bun run test:e2e
  action:
    # Runs the composite Action from this checkout, the way users run it.
    # load + scripted only: no live key is needed, and the gate never runs.
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: pass
        uses: ./
        with:
          working-directory: test/fixtures/plugins/tool-direct
          tiers: load,scripted
          artifact-name: action-self-test-pass
      - id: fail
        uses: ./
        continue-on-error: true
        with:
          working-directory: test/fixtures/plugins/throws
          tiers: load,scripted
          artifact-name: action-self-test-fail
      - name: Check the Action's outputs
        env:
          PASS_RESULT: ${{ steps.pass.outputs.result }}
          PASS_REPORT: ${{ steps.pass.outputs.report-path }}
          FAIL_RESULT: ${{ steps.fail.outputs.result }}
          FAIL_OUTCOME: ${{ steps.fail.outcome }}
        run: |
          echo "pass: result=$PASS_RESULT report=$PASS_REPORT"
          echo "fail: result=$FAIL_RESULT outcome=$FAIL_OUTCOME"
          test "$PASS_RESULT" = pass
          test -f "$PASS_REPORT"
          test "$FAIL_OUTCOME" = failure
          test "$FAIL_RESULT" = fail
````

5. Run the Action's script locally, the way the composite step runs it. This uses the tool's own opencode install path (no `OPENCODE_BIN`), so it also checks that path:

   ```bash
   S=review/spike-v1.1 && rm -rf $S/act-* && mkdir -p $S
   bun -e 'const {parse}=require("yaml");const a=parse(require("fs").readFileSync("action.yml","utf8"));require("fs").writeFileSync(process.argv[1],a.runs.steps.find(s=>s.id==="run").run)' "$S/act-run.sh"
   for fx in tool-direct throws; do
     cp -r test/fixtures/plugins/$fx $S/act-$fx && rm -rf $S/act-$fx/.opencode-ci/out
     (cd $S/act-$fx && env -u OPENCODE_BIN XDG_CACHE_HOME=$PWD/../act-cache IN_TIERS=load,scripted IN_VERSIONS= IN_ARTIFACT=leg-$fx ACTION_PATH=$OLDPWD GITHUB_OUTPUT=$PWD/../act-$fx.out bash -e ../act-run.sh > ../act-$fx.log 2>&1; echo "$fx exit=$?")
     cat $S/act-$fx.out
   done
   ```

**Acceptance:**

- The local Action run prints `tool-direct exit=0` with `result=pass` and a `report-path=…/report.md` line, then `throws exit=1` with `result=fail`. The first run installs opencode into `review/spike-v1.1/act-cache/opencode-plugin-ci/opencode/2.0.26/`.
- `bun run test:e2e` gives ` 28 pass`, ` 0 fail`.
- `bun run check` gives ` 248 pass`, ` 0 fail` (the `fixtures still parse` test loads the new files).
- After you push (M14), the `action` job is green on GitHub. If it is not, see section 2.6.

Commit: `v1.1 M12: failing scenario per fixture; tool-direct proves it is direct; Action self-test job`.

### M13: Docs

**Do:**

1. `README.md`. Apply these replacements in order.

````markdown find:README.md
  entry: dist/server.js       # optional override; else auto-detected
  install: bun install        # optional, runs once before any tier
  build: bun run build        # optional, runs once before any tier
````

````markdown replace:README.md
  entry: dist/server.js       # optional; must exist after build, else auto-detected
  install: bun install        # optional, runs once before any tier
  build: bun run build        # optional, runs once before entries are resolved
````

````markdown find:README.md
  mcp: []
  providers: []               # for provider plugins (tier 1)
  models: []                  # for provider plugins (tier 1)
````

````markdown replace:README.md
  mcp: []
````

````markdown find:README.md
  budgetUSD: 1.00             # hard stop for the whole live tier
````

````markdown replace:README.md
  budgetUSD: 1.00             # hard stop for the whole live tier, across all versions
  timeoutMs: 240000           # per live attempt, unless the scenario sets timeoutMs
````

````markdown find:README.md
  enabled: true               # historical flake gate, live tier only
  window: 5
  threshold: 0.9
````

````markdown replace:README.md
  enabled: true               # historical flake gate, live tier only
````

````markdown find:README.md
  artifact: opencode-plugin-ci-results  # must match the Action's artifact-name input
````

````markdown replace:README.md
  artifact: opencode-plugin-ci-results  # history artifact; --gate-artifact (the Action's artifact-name) overrides it
````

````markdown find:README.md
id: redacts-secrets           # ^[a-z0-9][a-z0-9-]*$
````

````markdown replace:README.md
id: redacts-secrets           # ^[a-z0-9][a-z0-9-]*$; "load" and "bun-test" are reserved
````

````markdown find:README.md
workspace:                    # files written into the project dir before the run
````

````markdown replace:README.md
workspace:                    # files written into the project dir before the run (relative paths, no "..")
````

````markdown find:README.md
timeoutMs: 120000
expect:
````

````markdown replace:README.md
timeoutMs: 120000             # optional; default 120000 (scripted) or live.timeoutMs (live)
expect:
````

````markdown find:README.md
and forbidden in live mode; `expect.request` and `judgeReply` are
scripted-only; `judge` is live-only; `live.pass <= live.repeat`.
````

````markdown replace:README.md
and forbidden in live mode; `expect.request` is scripted-only; `judge` is
live-only; `live.pass <= live.repeat`; `id` must not be `load` or `bun-test`;
`workspace` keys must be relative paths that stay inside the project dir.
````

````markdown find:README.md
Non-string values are compared as JSON for the string matchers; `equals`
uses deep equality.
````

````markdown replace:README.md
Non-string values are compared as JSON for the string matchers; `equals`
uses deep equality. **A field with no recorded value fails every matcher
except `exists: false`**, so a misspelled field name (`input: { comand: …
}`) fails with `no value was recorded (check the field name)` instead of
passing a `notContains`.
````

````markdown find:README.md
  assertions against the **probe** (`tools:` / `hooks:`), which sees every
  inner call under its real name — never against `tool_use` events.
````

````markdown replace:README.md
  assertions against the **probe** (`tools:` / `hooks:`), which sees every
  inner call under its real name — never against `tool_use` events.
- Tools registered with a `namespace` are recorded as
  `<namespace>_<name>` (dots become `_`). In `tools:`, `noTools:` and
  `hooks[].tool` you may write that name, `ns.name` or the catalog path
  `tools.ns.name`; all three match. A bare `name` does not match, and the
  failure says which namespaced name was recorded.
````

````markdown find:README.md
Filter with `run --tier load --tier scripted`, `--scenario <id>`
(repeatable, comma-separated), `--opencode <v>`, `--out <dir>`, `--keep`
(keep sandboxes for debugging), `--gate` (force the gate locally),
`--verbose` / `--quiet`.
````

````markdown replace:README.md
Filter with `run --tier load --tier scripted`, `--scenario <id>`
(repeatable, comma-separated; an unknown id is a config error, exit 2),
`--opencode <v>` (`x.y.z` or `latest`), `--out <dir>`, `--keep`
(keep sandboxes for debugging), `--gate` (force the gate locally),
`--gate-artifact <name>` (overrides `gate.artifact`), `--verbose` /
`--quiet`. Each case's evidence dir under `--out` is wiped when the case
starts, so re-running into the same out dir never mixes runs.
````

````markdown find:README.md
unaffected). `.opencode-ci/**/*.test.ts` files run once via `bun test`
with `OPENCODE_BIN` set, folded in as a `bun-test` case.
````

````markdown replace:README.md
unaffected). `.opencode-ci/**/*.test.ts` files run once via `bun test`
with `OPENCODE_BIN` set, folded in as a `bun-test` case (the tool passes
each file as an explicit `./` path, because `bun test` skips dot-dirs
when given a directory filter). The live budget is shared by every
version in one run. Once it is spent, a case that has not started is
`skipped`, and a case that already ran attempts but has fewer than `pass`
passes fails with `(budget exhausted …)` in its failure line.
````

````markdown find:README.md
History comes from earlier `opencode-plugin-ci-results` artifacts on the
same branch via `gh`, so the workflow needs `actions: read`.
````

````markdown replace:README.md
History comes from earlier `opencode-plugin-ci-results` artifacts via
`gh`, so the workflow needs `actions: read`. Push runs read their own
branch's history; pull request runs read the **base** branch's history
(`GITHUB_BASE_REF`), since a PR's own ref has no earlier runs.
````

````markdown find:README.md
**Matrix builds:** artifact names must be unique within a workflow run, so
give each matrix leg a distinct `artifact-name` Action input **and** set the
same value in that leg's `gate.artifact` config (the gate downloads history
by that name). Example:
````

````markdown replace:README.md
**Matrix builds:** artifact names must be unique within a workflow run, so
give each matrix leg a distinct `artifact-name` Action input. The Action
passes it to the CLI as `--gate-artifact`, so each leg reads its own
history; no config change is needed. Example:
````

````markdown find:README.md
      artifact-name: opencode-plugin-ci-results-${{ matrix.opencode }}
```

with `gate: { artifact: opencode-plugin-ci-results-2.0.26 }` in the
required leg's config (each leg reads its own checkout's config, so
parameterize it per leg or keep one artifact per workflow).
````

````markdown replace:README.md
      opencode-versions: ${{ matrix.opencode }}
      artifact-name: opencode-plugin-ci-results-${{ matrix.opencode }}
```
````

````markdown find:README.md
`upload-artifact` (default `true`), `artifact-name` (default
`opencode-plugin-ci-results`). Outputs `result` (`pass`/`fail`) and
`report-path`.
````

````markdown replace:README.md
`upload-artifact` (default `true`), `artifact-name` (default
`opencode-plugin-ci-results`; also the gate's history name). There is no
`config` input: the tool reads `.opencode-ci/config.*` in
`working-directory`. Outputs `result` (`pass`/`fail`; a fully skipped run
is `pass`) and `report-path`.
````

2. `docs/NOTES.md`: add a section `## v1.1 (<date>)` with:
   - the toolchain versions from section 1,
   - the M1 reproductions and the M6 re-run,
   - one line per milestone with anything that differed from this brief (or "as briefed"),
   - the M11 decisions,
   - "live: not run" (see 2.6),
   - an updated **Known gaps** list: remove the items this release fixed (gaps 1, 7 and 9 are now decided; see SPEC decisions 19 and 23), and keep: no `workspace.tar` or per-case `result.json`, no `webfetch`/`websearch` report flag, `ctx.storage` not snapshotted, no dogfood workflow, gate history downloads full evidence artifacts, provider expectations deferred to v2.

3. Re-read `docs/SPEC.md` sections 3.2, 4, 5.1, 5.2, 5.3, 6.1, 6.2, 7.1, 7.2, 8 and 9. For every sentence, confirm the code does it, or add it to Known gaps with a one-line reason.

**Acceptance:**

```bash
grep -n "providers\|window: 5\|threshold\|judgeReply" README.md   # prints nothing
grep -c -- "--gate-artifact" README.md                            # 3 or more
bun run check                                                     # " 248 pass", " 0 fail"
```

Commit: `v1.1 M13: README and NOTES for v1.1`.

### M14: Final pass and PR

**Do:**

1. Check every SPEC decision from 14 to 25 against the code, one line each in NOTES.md (`decision 17: src/tiers/live.ts budgetStop; test live-loop "running out of budget…"`).
2. Run everything once more from a clean tree:
   ```bash
   git status --short     # prints nothing (review/ and .opencode-ci/out/ are git-ignored)
   bun run check          # " 248 pass", " 0 fail"
   bun run test:e2e       # " 28 pass", " 0 fail"
   ls "${TMPDIR:-/tmp}" | grep -c '^run-plugin-\|^run-fake-\|^live-loop-'   # 0: the new tests clean up after themselves
   ```
3. Push and open the PR:
   ```bash
   git push -u origin fix/v1.1
   ```
   Title: `opencode-plugin-ci v1.1: fixes from the v1 review`. Body, in this order:
   - **Before:** one paragraph: what was broken for users (compiled plugins could not run in CI, `plugin.entry` was ignored by tier 1, the `bun-test` escape hatch was always red, a live failure could be reported as skipped, re-runs could pass on stale evidence, PR runs had no gate history).
   - **After:** one paragraph: what works now.
   - **How:** a short paragraph naming the fake opencode binary and the Action self-test job.
   - The summary lines of `bun run check` and `bun run test:e2e`.
   - The Known gaps list.
   - Anything in NOTES.md that contradicts this brief or SPEC.
4. Wait for CI. All three jobs (`check`, `e2e`, `action`) must be green. If `action` fails, read its log and section 2.6, fix, and push again.

**Acceptance:** the PR is open, CI is green on its head commit, and NOTES.md has the decision checklist.

---

## 5. Gotchas (re-read before every milestone)

1. **Test first.** Run each new test file before the fix and see it fail the stated way. A test that already passes is testing the wrong thing.
2. **Tabs.** TypeScript in this repo is tab-indented. Run `bun run format` after edits.
3. **Clear CI env in `runCi` tests.** `isolateCiEnv()` deletes `GITHUB_ACTIONS` and `GITHUB_STEP_SUMMARY`; without that, a test run inside GitHub Actions would trigger the gate and append to the real job summary.
4. **The fake opencode gets its plan as an argument**, never through env: the sandbox passes only an allowlisted env to opencode.
5. **The fake's run counter is per plan.** Each `useFake()` call makes a new dir; `fakeRunCount(dir)` counts only that fake's `run` calls.
6. **`resetDir` only inside `--out`.** Never call `rmSync` on an evidence dir directly, and never weaken the "not inside" check.
7. **Install and build come before entry resolution.** Anything that resolves entries before `runStep("build", …)` brings B1 back.
8. **Tier 1 never resolves its own entry.** It takes `serverEntry` from `run.ts`.
9. **`bun test` with a directory filter skips dot-dirs.** Pass files as `./relative/path.test.ts`.
10. **A recorded failure is never a skip.** Only "no attempt ran" may become `skipped`.
11. **`tool-direct` stays pass-only and `throws` stays fail-only**: the Action self-test runs each fixture as a whole.
12. **Never interpolate `${{ inputs.* }}` into a `run:` script.** Pass inputs through `env:`.
13. **Never commit `review/` or `.opencode-ci/out/`.** Stage by path.
14. **Never print or record secret values.** Do not log `process.env`; the fake uses the literal key `fake`.
15. When something differs from this brief, write it in `docs/NOTES.md` first, then adapt.

## 6. Definition of done

- [ ] Every milestone's acceptance passes, and each milestone M1 to M13 is its own commit.
- [ ] `bun run check`: 248 pass, 0 fail. `bun run test:e2e`: 28 pass, 0 fail, against `@opencode/cli@2.0.26`.
- [ ] The M1 stale-evidence reproduction now gives `run2 exit=1`.
- [ ] `schema/*.json` are regenerated and in sync.
- [ ] `docs/NOTES.md` has the v1.1 section: toolchain, reproductions, per-milestone notes, M11 decisions, "live: not run", Known gaps, and the decision 14 to 25 checklist.
- [ ] The PR is open with the body from M14, and CI (`check`, `e2e`, `action`) is green.
