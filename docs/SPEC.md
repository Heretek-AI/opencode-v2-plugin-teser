# opencode-plugin-ci: specification (v1)

Status: draft. Targets opencode v2 (`@opencode/cli` 2.x, `@opencode/plugin` 2.x) only.

## 1. Goal

Give opencode v2 plugin authors one tool that answers "does my plugin actually work?" the same way on a laptop and in GitHub Actions. It does so by driving the real `opencode` binary with the plugin loaded and asserting on what happened.

Non-goals for v1:

- Testing TUI rendering (themes, footer widgets, anything only in `@opencode/plugin/tui`). These plugins get load checks only. Full TUI coverage is tracked for v2 in a separate issue.
- Testing v1 (`@opencode-ai/*`) plugins.
- Benchmarking model quality.

## 2. Background and verified facts

Everything here was checked against `@opencode/cli@2.0.26` and the `@opencode/plugin@2.0.26` type definitions on 2026-10-17.

**Headless invocation.** Bare `opencode` starts the interactive UI, so CI uses `opencode run`. The harness always uses:

```
opencode run --standalone --auto --format json --print-logs --log-level all [--model p/m] "<prompt>"
```

- `--standalone` runs a private server instead of the shared background service. Without it, server logs are not printed (`--print-logs` help: "server logs require --standalone") and runs could share state.
- `--auto` auto-approves permissions that are not explicitly denied. `--dangerously-skip-permissions` and `--yolo` are hidden aliases of it.
- `--log-level` accepts `all|trace|debug|info|warn|warning|error|fatal|none`.
- `--format json` writes one JSON event per line to stdout. Observed event types are `step_start`, `step_finish`, `text`, `tool_use` (with `part.tool` and `part.state.status` set to `completed` or `error`) and `error`.
- stdin must be closed (`stdio: ["ignore", ...]`), because `run` reads piped stdin as part of the prompt.
- `--pure` and an `OPENCODE_PERMISSION` env var do not exist in v2.

**Plugin API surfaces.** A v2 plugin is `Plugin.define({ id, setup(ctx) })`. The `ctx` domains the harness must be able to observe are:

| Surface | API | How v1 of this tool observes it |
|---|---|---|
| Tools | `ctx.tool.transform(editor => editor.add/update/remove)` | Probe inventory, `tool_use` events |
| Tool hooks | `ctx.tool.hook("execute.before" \| "execute.after")` | Probe log |
| Shell hooks | `ctx.shell.hook("create.before")` (mutable `command`, `cwd`, `env`) | Probe log |
| Session transforms | `ctx.session` hooks: `prompt`, `context`, `compaction`, `title`, `model.request`, `http.request`, `http.response`, `retry` | Probe log and the stub model's recorded requests |
| Events | `ctx.event.subscribe` | Side effects on disk and the probe log |
| Agents, commands, skills, MCP | `ctx.agent`, `ctx.command`, `ctx.skill`, `ctx.mcp` | Probe inventory |
| Providers and models | `ctx.provider`, `ctx.model`, `ctx.aisdk.hook` | Live tier only (see 6.4) |
| Storage | `ctx.storage` | Sandbox data dir after the run |

There is no `ctx.tool.register`, `ctx.shell.env` or `ctx.subscribe`. Some earlier write-ups name them, but they are not part of the API.

**Prior art.** `Heretek-AI/claude-4-opencode/e2e` provides the isolated sandbox (`lib/sandbox.ts`), the scripted OpenAI-compatible stub model (`lib/stub-llm.ts`) and the live-tier pattern (`live/live.test.ts`). `Heretek-AI/IUMBTEMS/scripts/e2e-report.ts` and `e2e-gate.ts` provide reporting and the historical flake gate. This tool extracts and generalizes them; it does not depend on either repo.

**Ecosystem.** `Heretek-AI/awesome-opencode` lists 154 plugins with `compat: v2`. That flag means "depends on `@opencode/*`", detected statically, not "verified working". Eighteen of them are primarily provider plugins.

## 3. Architecture

```
plugin repo checkout
   │ install + build (author's commands)
   ▼
Sandbox (temp HOME/XDG, git-initialized project dir, opencode.jsonc)
   ├─ plugin under test   (local path from the checkout)
   ├─ probe plugin        (ships with this tool, observes everything)
   └─ model: stub (tiers 1-2) or real provider (tier 3)
   │
   ▼ opencode run --standalone --auto --format json ...
Evidence: events.jsonl, probe.jsonl, stub-requests.jsonl, stderr.log, workspace snapshot
   │
   ▼
Assertions → results.json → Markdown report (+ flake gate for live runs)
```

### 3.1 Sandbox

Same design as `claude-4-opencode/e2e/lib/sandbox.ts`. Every scenario gets a fresh temp root with its own `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME`, plus an empty `GIT_CONFIG_GLOBAL`, `OPENCODE_DISABLE_AUTOUPDATE=1` and `TERM=dumb`. The project dir is a fresh `git init` with files from the scenario's `workspace` block. The config is written to `$XDG_CONFIG_HOME/opencode/opencode.jsonc` with `update: "disable"`, `share: "disabled"`, the model, the providers and:

```jsonc
"plugins": [
  { "package": "<checkout>/<plugin.path>", "options": { /* scenario plugin options */ } },
  { "package": "<tool>/probe", "options": { "out": "<root>/probe.jsonl" } }
]
```

Nothing touches the user's real opencode setup. `--keep` (or `OPENCODE_PLUGIN_CI_KEEP=1`) keeps the sandbox for debugging.

### 3.2 Plugin under test

The plugin loads from the checkout being tested, as a local path, after the author's own `install` and `build` commands run. npm is never used, so a PR is tested before anything is published.

### 3.3 Probe plugin

This is a small v2 plugin shipped inside this tool and loaded after the plugin under test. It writes one JSON line per observation to `probe.jsonl`.

- **Inventory**: on the first `session` `prompt` hook (by then every plugin has activated), it records `ctx.plugin.list()`, `ctx.tool.list()`, `ctx.agent`, `ctx.command.list()`, `ctx.skill` and `ctx.mcp` lists.
- **Hooks**: it registers `tool.hook("execute.before")`, `tool.hook("execute.after")`, `shell.hook("create.before")` and the `session` hooks `prompt`, `context`, `model.request`, then records the payload it sees. Large fields are truncated, and values of env keys matching `/KEY|TOKEN|SECRET|PASSWORD/i` are redacted.
- **Events**: it subscribes to `ctx.event` and records event types.
- **Load errors**: it records plugin load failures that `ctx.plugin.list()` exposes.

Because the probe registers after the plugin under test, its hook payloads should show the plugin's mutations. **Hook ordering across plugins is not documented**, so the first implementation task is a spike that confirms registration order equals execution order on 2.0.26. If it does not, the probe instead diffs the stub model's recorded request against the scenario's expectation, and hook assertions fall back to `stub-requests.jsonl`.

### 3.4 Stub model

This is the `stub-llm.ts` pattern: an OpenAI-compatible `/v1/chat/completions` server on `127.0.0.1:0`, configured as provider `stub` through `@ai-sdk/openai-compatible`. Requests that offer tools are agent-loop requests, and each one consumes the next scripted step (`text` or `toolCalls`). Other requests (titles) get a fixed reply. Every request is recorded to `stub-requests.jsonl`. A script that runs out returns `STUB_SCRIPT_EXHAUSTED`, which fails the scenario.

## 4. Tiers

| Tier | Name | Model | Tokens | Runs by default |
|---|---|---|---|---|
| 1 | `load` | stub | 0 | always |
| 2 | `scripted` | stub | 0 | always |
| 3 | `live` | real provider | yes | only when a key is configured |

**Tier 1, load.** This tier needs no authoring. For each opencode version in the matrix it runs one `opencode run` turn with a stub step `{ text: "ok" }` and asserts:

- exit code 0 and no `error` event,
- the plugin under test is in the probe's `plugin.list()` with no load error,
- no stderr log line at level `error` or `fatal` that names the plugin id,
- every contribution declared in `.opencode-ci/config.yaml` `expect` (tools, agents, commands, skills, mcp) appears in the inventory.

TUI-only plugins stop here.

**Tier 2, scripted.** This tier runs scenarios with `mode: scripted`: the stub plays the model, so tool calls are deterministic and the run tests the plugin, not a model.

**Tier 3, live.** This tier runs scenarios with `mode: live` against the user's provider and model. Assertions are the same as tier 2 except stub-specific ones, which are rejected at validation. A live scenario passes when at least `pass` of `repeat` attempts pass (default 2 of 3, as in `live.test.ts`). An optional `judge` rubric adds a semantic check (6.3). Without a configured key, tier 3 is reported as `skipped`, not failed, so fork PRs (which get no secrets) stay green.

## 5. Configuration

### 5.1 `.opencode-ci/config.yaml`

```yaml
# yaml-language-server: $schema=https://unpkg.com/@heretek-ai/opencode-plugin-ci/schema/config.json
plugin:
  path: .                    # plugin package dir in the checkout
  install: bun install       # optional
  build: bun run build       # optional
  options: {}                # default plugin options for every scenario
  ui: false                  # true = TUI-only plugin, tier 1 only
opencode:
  versions: ["2.0.26", "latest"]   # first is required; others may fail without failing the job
expect:                      # tier 1 inventory expectations
  tools: [my_tool]
  commands: []
  agents: []
  skills: []
  mcp: []
live:
  model: opencode/some-model # provider/model, or a bare id resolved via `opencode models`
  keys: [OPENCODE_API_KEY]   # env vars passed into the sandbox
  repeat: 3
  pass: 2
  budgetUSD: 1.00            # hard stop for the whole live tier
gate:
  enabled: true              # historical flake gate, live tier only (7.2)
  window: 5
  threshold: 0.9
```

JSON (`config.json`) is accepted with the same schema. Exactly one of the two may exist.

### 5.2 Scenario files: `.opencode-ci/scenarios/*.yaml` (or `.json`)

```yaml
id: redacts-secrets
description: execute.before strips API keys from bash commands
mode: scripted               # scripted | live
plugin:
  options: { mode: strict }  # merged over config plugin.options
workspace:                   # files written into the project dir before the run
  .env: "API_KEY=sk-test\n"
prompt: "print the env file"
script:                      # scripted only: one step per agent-loop request
  - toolCalls:
      - name: bash
        arguments: { command: "cat .env", description: "show env" }
  - text: done
timeoutMs: 120000
expect:
  exitCode: 0
  tools:                     # from tool_use events
    - name: bash
      status: completed
  noTools: [webfetch]
  hooks:                     # from probe.jsonl
    - hook: tool.execute.before
      tool: bash
      input: { command: { notContains: "sk-test" } }
    - hook: shell.create.before
      env: { MY_PLUGIN_ACTIVE: { equals: "1" } }
  request:                   # scripted only, from stub-requests.jsonl
    nth: 1
    system: { contains: "Never print secrets" }
    tools: { includes: [my_tool] }
  files:                     # project dir after the run
    - path: .my-plugin/log.jsonl
      exists: true
      contains: "redacted"
  stderr:
    notMatches: "(?i)unhandled"
  text:                      # concatenated `text` events
    notContains: "sk-test"
judge:                       # live only, optional
  rubric: "The reply explains that the key was redacted and does not reveal it."
```

Matchers are `equals`, `contains`, `notContains`, `matches`, `notMatches`, `includes` (arrays), `exists` and `count`. They are combinable and AND-ed. Unknown keys fail validation, so typos never silently pass.

A JSON Schema for both files is published in the package (`schema/config.json`, `schema/scenario.json`), and `validate` checks it.

### 5.3 Programmatic API

For authors who outgrow YAML, the package exports the primitives the runner itself uses:

```ts
import { Sandbox, startStub, loadProbe, assert } from "@heretek-ai/opencode-plugin-ci"
import { test, expect } from "bun:test"

test("custom", async () => {
  await using sandbox = await Sandbox.create({ plugin: ".", script: [{ text: "ok" }] })
  const run = await sandbox.run("hi")
  expect(run.probe.inventory.tools).toContain("my_tool")
})
```

`bun:test` files under `.opencode-ci/**/*.test.ts` are run by the CLI as part of tier 2, and their results are folded into the same report.

## 6. Execution details

### 6.1 Run order

1. Validate config and scenarios (fail fast on schema errors).
2. Run `plugin.install` and `plugin.build` once in the checkout.
3. For each opencode version: resolve the binary (`OPENCODE_BIN`, else `npx @opencode/cli@<v>`, cached), then tier 1, tier 2 and tier 3 in order. Scenarios within a tier run with concurrency `min(4, cpus)`; each has its own sandbox and stub port.
4. A failing tier 1 skips tiers 2 and 3 for that version, because they would all fail for the same reason.

### 6.2 Evidence

Every scenario writes `<out>/<version>/<scenario>/` with `events.jsonl`, `probe.jsonl`, `stub-requests.jsonl`, `stderr.log`, `workspace.tar` (for failures only) and `result.json`. The default `<out>` is `.opencode-ci/out` (git-ignored). The Action uploads it as an artifact.

### 6.3 Judge

The judge is the user's original two-agent idea, scoped so that it cannot skip evidence. It runs only for live scenarios that define `judge.rubric`, and only after deterministic assertions pass.

- It is a second `opencode run --standalone --format json` in a fresh sandbox with **no plugins** and all tools denied via the permission config (the exact config key is confirmed in the step-1 spike). It uses the same model unless `judge.model` is set.
- Its prompt contains the rubric and the evidence: the run's text, `tool_use` events, probe hook log (truncated) and any `files` the scenario names. It never sees the plugin's source.
- It must reply with one JSON object `{"pass": boolean, "reason": string}`. Any other reply counts as a failed judgement.
- Judge tokens count toward `live.budgetUSD`.

### 6.4 Provider plugins

A plugin whose job is to be the model provider cannot be checked against the stub. For these plugins:

- tier 1 asserts that the provider and models appear (`expect.providers`, `expect.models`, read from the probe's `ctx.provider` and `ctx.model`);
- tier 2 is optional, using `model: <their-provider>/<model>` with `baseURL` pointed at the stub when the provider is OpenAI-compatible;
- tier 3 is the real test.

### 6.5 Isolation and network

Tiers 1 and 2 need no network beyond installing opencode. The stub binds to loopback only. The tool does not sandbox the network itself (that is the runner's job), but the report flags any `tool_use` of `webfetch` or `websearch` in scripted scenarios.

## 7. Reporting and gating

### 7.1 Results and report

`results.json` uses the IUMBTEMS `EvalRow` shape (`id`, `pass`, `tools`, `failures`, `steps`, `costUSD`, `textExcerpt`, `kept`, ...) with `tier` and `opencode` added, so the gate logic ports unchanged. The Markdown report is generated from `e2e-report.ts`. It contains one table per opencode version, a row per scenario, failures expanded with the first failing assertion and evidence links, and token and cost totals for the live tier. It is written to `report.md` and appended to `$GITHUB_STEP_SUMMARY` when that is set. This is on by default.

### 7.2 Historical flake gate (live tier only)

This is ported from `IUMBTEMS/scripts/e2e-gate.ts` and applies only to live-tier rows. Tiers 1 and 2 are deterministic and fail on any failure.

- **History**: the gate reads the `results.json` from the `opencode-plugin-ci` artifacts of the last N runs of the same workflow on the same branch. It does this through the GitHub API with the job's `GITHUB_TOKEN`, so the workflow needs `actions: read`. History is not stored in the Actions cache, because a cache eviction would silently reset it.
- **Stable case**: a case passed at least `threshold` (default 90%) of at least `window` (default 5) sampled runs.
- **Verdict**: the live tier fails only when a stable case fails now. **Sticky red** also applies: a case that was stable before its current failure streak keeps failing until it passes or a human acknowledges the streak.
- **Acknowledgments**: `.opencode-ci/acknowledgments.json` in the plugin repo has the format `{ "version": 1, "acknowledgments": [{ "case", "reason", "issue", "date" }] }`. It is human-written; the tool never writes it. It is fail-closed: a malformed file fails the gate.
- **No history**: a red live tier with no history to judge it against exits 2. The Action reports this as a failure unless `gate.bootstrap: allow` is set, for the first runs in a new repo.
- **Local runs**: the gate is skipped locally unless `--gate` is passed with a `GITHUB_TOKEN` and `--repo`.

## 8. Packaging

One package, two entry points, in this repo.

**npm**: `@heretek-ai/opencode-plugin-ci`, with bin `opencode-plugin-ci`. It runs on Bun ≥ 1.2. The CLI is a Bun script; `bunx` works with no extra install.

```
opencode-plugin-ci init                 # writes .opencode-ci/config.yaml and one example scenario
opencode-plugin-ci validate             # schema-checks config and scenarios
opencode-plugin-ci run [--tier load|scripted|live] [--scenario id] [--opencode 2.0.26] [--keep] [--gate]
opencode-plugin-ci report [results.json]
```

Exit codes: 0 pass, 1 failure, 2 configuration error or gate with no history.

**GitHub Action**: `Heretek-AI/opencode-v2-plugin-teser@v1`, a composite action that sets up Bun, installs `@opencode/cli` for each requested version and runs the same CLI.

```yaml
name: plugin-ci
on: [push, pull_request]
permissions:
  contents: read
  actions: read          # flake gate history
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Heretek-AI/opencode-v2-plugin-teser@v1
        with:
          tiers: load,scripted,live      # live auto-skips without a key
        env:
          OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
```

Inputs are `tiers`, `opencode-versions` (overrides config), `config` (path), `working-directory` and `upload-artifact` (default true). Outputs are `result` (`pass`/`fail`/`skipped`) and `report-path`.

The docs must state plainly: never run this on `pull_request_target` with the PR's code checked out and secrets exposed. The live tier runs the plugin under test with the real key.

## 9. Validation plan for this tool

- **Self-tests**: fixture plugins in `test/fixtures/` cover each surface (a tool, an `execute.before` mutation, a `shell.create.before` env injection, a `session` `context` system-prompt transform, an `event.subscribe` file write, and a plugin that throws in `setup`). Each has passing and deliberately failing scenarios.
- **Dogfood**: a scheduled workflow runs tier 1 against a handful of `compat: v2` entries from `awesome-opencode` (at least one memory, one tool, one shell-hook, one session-transform and one provider plugin). It also publishes a table that awesome-opencode can later use as a "verified loads on 2.0.x" signal.

## 10. Implementation order

1. Spike: confirm cross-plugin hook execution order, the `ctx.plugin.list()` load-error shape and the permission config that denies all tools, on 2.0.26 (3.3, 6.3).
2. Sandbox, stub and probe, extracted from `claude-4-opencode/e2e/lib`.
3. Tier 1 and the CLI `run`, `validate` and `init` commands.
4. Scenario schema and tier 2 assertions.
5. Report (ported `e2e-report.ts`).
6. Live tier, judge and budget.
7. Flake gate (ported `e2e-gate.ts`).
8. Composite Action, docs and the dogfood workflow.

## 11. Decisions log

| # | Decision |
|---|---|
| 1 | Three tiers: load, deterministic stub-scripted, opt-in live with judge |
| 2 | One CLI plus a composite GitHub Action, identical locally and in CI |
| 3 | Declarative YAML/JSON scenarios, with exported TS primitives for `bun:test` |
| 4 | v1 is headless only; TUI-only plugins get load checks, and full TUI coverage is tracked for v2 |
| 5 | Markdown step-summary report by default; historical flake gate for live runs |
| 6 | The plugin loads from the PR checkout after the author's install/build, not from npm |
| 7 | A probe plugin observes hooks, transforms and inventory; tier 1 asserts activation through it, not just clean stderr |
| 8 | Gate history comes from earlier runs' artifacts (`actions: read`), not the cache; acknowledgments live in the plugin repo |
| 9 | The judge is a plugin-free, tool-less second `opencode run` that returns a JSON verdict over recorded evidence, only for live scenarios with a rubric |
| 10 | Live scenarios pass on k of n attempts (default 2 of 3) under a USD budget; a missing key means `skipped`, not failed |
| 11 | The default opencode matrix is a pinned version (required) plus `latest` (allowed to fail) |
