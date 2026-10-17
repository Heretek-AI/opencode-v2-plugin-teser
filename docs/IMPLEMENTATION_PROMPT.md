# Implementation brief: opencode-plugin-ci

You are implementing `@heretek-ai/opencode-plugin-ci`. It is a CLI and GitHub Action that checks whether an opencode v2 plugin actually works. It does this by running the real `opencode` binary with the plugin loaded and asserting on what happened.

Read this entire file before you write any code. It is long on purpose. Every fact in the "Verified facts" section was confirmed by running opencode 2.0.26 on 2026-10-17. Do not re-derive those facts and do not "improve" on them from memory. Your training data describes opencode **v1**, which is a different API, and it is wrong for this project.

---

## 0. How to work

1. **Work in milestones, in order.** Each milestone below has a goal, the files to create, and an **acceptance check**. A milestone is only done when its acceptance check passes. Do not start the next milestone until it does.
2. **After every milestone:** run `bun run check` (defined in milestone 1). Then commit with a clear message that names the milestone, for example `M3: sandbox and opencode binary resolution`. Stage files explicitly; never use `git add -A` or `git add .`.
3. **Never** skip, delete, or weaken a failing test to make it pass. Never mark a test `.skip` or `.todo` to get green. If a test is wrong, fix the test and say why in the commit message.
4. **Do not invent opencode APIs.** If you need an API that is not described in this file, look it up in this order:
   - the `@opencode/plugin` type definitions in `node_modules/@opencode/plugin/dist/promise/*.d.ts`,
   - the opencode source at `/home/john/Projects/opencode-v2-plugin-teser/review/opencode`,
   - a throwaway experiment (milestone 2 shows how).

   Write what you learned in `docs/NOTES.md` with the date and the evidence (a file path or a command and its output).
5. **If something in this file turns out to be wrong** on the opencode version you have, stop and write the discrepancy in `docs/NOTES.md`. Then pick the smallest change that matches reality and continue. Do not silently work around it.
6. **Keep code boring.** Use plain TypeScript, small functions, explicit types, no clever abstractions and no classes unless this file shows one. Comment *why*, not *what*.
7. **Never use `spawnSync` or `execSync` to run `opencode`.** The stub model is an HTTP server in the *same process*. A synchronous spawn blocks the event loop, so the stub can never answer and opencode hangs forever. This was hit during the spike. Always use async `spawn` and await its `close` event.
8. **If you get stuck** for more than three attempts on the same error, write down what you tried in `docs/NOTES.md`, commit what works, and stop with a summary. Do not thrash.

---

## 1. Paths and setup

- **The repository** (your working directory): `/home/john/Projects/opencode-v2-plugin-teser`
  - It already contains `README.md`, `docs/SPEC.md` (the design, which is the source of truth for behavior) and this file.
  - Create a branch before you start: `git checkout -b impl/v1`.
- **The scratch area** for clones: `/home/john/Projects/opencode-v2-plugin-teser/review/`
  - The opencode v2 source is already at `review/opencode`.
  - Clone these two reference repos there (read-only; you copy code *out* of them, never edit them):
    ```bash
    cd /home/john/Projects/opencode-v2-plugin-teser/review
    git clone https://github.com/Heretek-AI/claude-4-opencode
    git clone https://github.com/Heretek-AI/IUMBTEMS
    ```
  - **Add `review/` to `.gitignore` first**, so none of it is ever committed.
- **Tools:**
  - Bun ≥ 1.2 (the spike used 1.4.2)
  - Node ≥ 22 and npm (only used to install the opencode CLI)
  - git
  - On Linux, `unzip` (used by the flake gate)
- **The opencode CLI:** install the pinned version into the scratch area for development:
  ```bash
  mkdir -p review/oc && cd review/oc && npm install --no-save @opencode/cli@2.0.26
  ./node_modules/.bin/opencode --version   # must print: opencode v2.0.26
  ```
  During development, set `OPENCODE_BIN=/home/john/Projects/opencode-v2-plugin-teser/review/oc/node_modules/.bin/opencode`.

Read these files from the clones before milestone 3. You will port parts of them:

| File | What you take from it |
|---|---|
| `review/claude-4-opencode/e2e/lib/sandbox.ts` | The isolated sandbox: env vars, config writing, async spawn, JSON event parsing |
| `review/claude-4-opencode/e2e/lib/stub-llm.ts` | The OpenAI-compatible stub model, SSE response format and request recording |
| `review/claude-4-opencode/e2e/live/live.test.ts` | Live model resolution (`resolveModel`) and the retry-attempt pattern |
| `review/IUMBTEMS/packages/core/src/evals/gate.ts` | `decideGateVerdict` and `parseAcknowledgments`, copied **verbatim** (it has no imports) |
| `review/IUMBTEMS/packages/core/test/evals-gate.test.ts` | Its unit tests, copied and re-pointed at your copy |
| `review/IUMBTEMS/scripts/e2e-gate.ts` | How history is fetched with `gh` |
| `review/IUMBTEMS/scripts/e2e-report.ts` | The Markdown report layout |

**Licenses.** claude-4-opencode is MIT and IUMBTEMS is **Apache-2.0**. Every file you port from IUMBTEMS must keep a header comment saying where it came from and that it is Apache-2.0. Add a `NOTICE` file listing those files. Use MIT for this repo's `LICENSE`, the same as claude-4-opencode.

---

## 2. Verified facts (opencode 2.0.26, do not re-derive)

### 2.1 CLI

- Bare `opencode` opens the interactive UI, which hangs in CI. Always use `opencode run`.
- The exact invocation:
  ```
  opencode run --standalone --auto --format json --print-logs --log-level info "<prompt>"
  ```
  - `--standalone` runs a private server. Without it, `run` talks to a shared background service and server logs are not printed.
  - `--auto` auto-approves permissions. `--dangerously-skip-permissions` and `--yolo` are hidden aliases for it; use `--auto`.
  - `--log-level` accepts `all|trace|debug|info|warn|warning|error|fatal|none`. Use `info` by default and `all` when the user passes `--verbose`.
  - `--agent <name>` selects an agent. `--model provider/model` overrides the model, but setting `model` in the config is enough.
  - There is **no** `--pure` flag.
- **stdin must be closed** (`stdio: ["ignore", "pipe", "pipe"]`). `opencode run` reads piped stdin as part of the prompt.
- **Exit codes:** `run` exits `0` even when a tool call errored. It exits non-zero on provider errors (for example HTTP 403).
- **stdout with `--format json`** is one JSON object per line. Ignore lines that do not start with `{`. The event types observed are:
  - `step_start`: `{ type, timestamp, sessionID, part: { type: "step-start" } }`
  - `tool_use`: `{ type, part: { type: "tool", id, tool, state: { status: "completed"|"error", input, output, error?, metadata } } }`
    - For a Code Mode call, `part.tool` is `"execute"`, `state.input.code` is the script, and inner calls are listed in `state.metadata.metadata.toolCalls` as `[{ tool, status, input }]`.
  - `step_finish`: `{ type, part: { type: "step-finish", reason, cost: number, tokens: { input, output, reasoning, cache: { read, write } } } }`. **Use `cost` and `tokens` for the live budget.**
  - `text`: `{ type, part: { type: "text", text } }`
  - `error`: `{ type, error: { type, message, status?, response? } }`
- **stderr with `--print-logs`** is logfmt, one line per entry, for example:
  ```
  timestamp=2026-10-17T22:02:15.624Z level=WARN run=58f085ac message="failed to load plugin" plugin.id=spike-boom cause="Cause([Die(Error: BOOM in setup)])" http.span=439 role=server
  ```
  - Levels are uppercase: `INFO`, `WARN`, `ERROR`, and so on.
  - Some lines use `msg=` instead of `message=`; handle both.
  - Values may be quoted with `"` and contain escaped quotes.
- **Useful env vars** (confirmed present in the binary):
  - `OPENCODE_DISABLE_AUTOUPDATE=1`
  - `OPENCODE_DISABLE_MODELS_FETCH=1`: without it, offline runs log `level=ERROR message="Failed to fetch models.dev"`, which would trip error-line checks.
  - `OPENCODE_CONFIG_CONTENT`, `OPENCODE_DISABLE_PROJECT_CONFIG`: exist, not needed.
- **Install:** `npm install @opencode/cli@<version>` puts the binary at `node_modules/.bin/opencode`.

### 2.2 Config file (`$XDG_CONFIG_HOME/opencode/opencode.jsonc`)

This shape works (taken from claude-4-opencode's sandbox and confirmed):

```jsonc
{
  "model": "stub/scripted",
  "update": "disable",
  "share": "disabled",
  "plugins": [ { "package": "/abs/path/to/plugin-dir", "options": { } } ],
  "providers": {
    "stub": {
      "name": "Stub",
      "package": "@ai-sdk/openai-compatible",
      "settings": { "baseURL": "http://127.0.0.1:PORT/v1", "apiKey": "stub" },
      "models": {
        "scripted": { "name": "Scripted", "capabilities": { "tools": true }, "limit": { "context": 200000, "output": 8000 } }
      }
    }
  },
  "agents": {
    "opencode-plugin-ci-judge": {
      "mode": "primary",
      "description": "Grades recorded evidence",
      "system": "…",
      "permissions": [ { "action": "*", "resource": "*", "effect": "deny" } ]
    }
  }
}
```

- `permissions` entries are `{ action, resource, effect: "allow" | "deny" | "ask" }`.
- With the deny-all rule above, the model request carries **no tools at all**, and the model cannot create files. This was verified.

### 2.3 Plugin loading

- **A local plugin path must be a directory.** A file path logs `level=WARN message="configured plugin path must be a directory"` and is skipped.
- **Inside the directory, opencode loads `<dir>/server.{ts,js}`, else `<dir>/index.{ts,js}`.** `package.json` `main` and `exports` are **ignored** for local paths.
  - A directory that has neither file is **silently skipped**, with no log line at all.
  - `<dir>/tui.{ts,js}` is the TUI entry. A directory with only `tui.*` never reaches the server.
- `.ts` files load directly, with no build step.
- **The shim trick works** (verified). Put a directory containing only `server.js` with this content:
  ```js
  export { default } from "/abs/path/to/real/entry.js"
  ```
  The plugin loads with the real module, and the real file's own `node_modules` still resolve because the file stays where it is.
- A plugin module's default export is `{ id: string, setup(ctx) }`. Using `Plugin.define()` is optional; a plain object works.
- `ctx.options` is the `options` object from the config entry.
- **Ordering:** plugins load, and their hooks run, **in the order of the `plugins` array.** A later plugin's hook receives the object *after* an earlier plugin mutated it. Verified for `tool.hook("execute.before")`, `shell.hook("create.before")` and `session.hook("context")`, in both orders.
- A plugin whose `setup` throws:
  - shows up in `ctx.plugin.list()` with `state.status: "failed"` and the stack in `state.error`,
  - is logged as `level=WARN message="failed to load plugin" plugin.id=<id>`,
  - does **not** stop other plugins.

### 2.4 Plugin API shapes (`@opencode/plugin` 2.0.26)

```ts
// ctx keys: app, location, options, agent, aisdk, command, event, experimental, generate, model,
// provider, integration, mcp, permission, plugin, reference, rpc, skill, storage, tool, vcs,
// websearch, worktree, session, shell

await ctx.tool.transform((editor) => {          // editor: list() get(id) add(info) update(id, fn) remove(id) namespace(ns)
  editor.add({
    name: "my_tool",                            // NOTE: `name`, not `id`
    description: "…",
    input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, // JSON Schema works
    execute: async (input, context) => ({ content: "result text" }),  // Result: { output?, content?, metadata? }
    options: { codemode: false },               // optional; see Code Mode below
  })
})
await ctx.tool.hook("execute.before", (i) => { /* i: { tool, sessionID, agent, messageID, id, input } — `input` and `tool` are mutable */ })
await ctx.tool.hook("execute.after",  (i) => { /* i: { tool, …, input, status: "completed", result } | { …, status: "error", error } */ })
await ctx.shell.hook("create.before", (i) => { /* i: { command, cwd, timeout, shell, env } — all mutable */ })
await ctx.session.hook("prompt",  (i) => { /* { sessionID, messageID, prompt, metadata?, delivery } */ })
await ctx.session.hook("context", (i) => { /* { sessionID, model, agent, system: SystemPart[], messages, options, tools: Record<name,{description,input}> } */ })
await ctx.session.hook("model.request", (i) => { /* { sessionID, agent, model, kind: "primary"|"compaction"|"title"|"generate", baseURL?, headers } */ })
// other session hooks exist: compaction, generate, title, http.request, http.response, retry, experimental.ws.*

const plugins = await ctx.plugin.list()   // { location, data: [{ id, source: { type: "builtin" } | { type: "local", path }, features: { server: true }, state: { status: "active" | "failed", error?: string } }] }
const tools   = await ctx.tool.list()     // array of tool infos; each has `id` (the effective name, e.g. "my_tool")
const cmds    = await ctx.command.list()  // { location, data: [{ name, description }] }
const mcp     = await ctx.mcp.list()      // { location, data: [] }
// ctx.agent.list / ctx.skill.list exist via the client API but were not exercised: call them defensively

for await (const ev of ctx.event.subscribe()) { /* ev.type, e.g. "session.tool.called" */ }  // AsyncIterable, NOT a callback
```

- Every hook registration returns `Promise<{ dispose }>`. Always `await` it in `setup`.
- **Never await the event loop inside `setup`.** Start it with `void (async () => { for await (…) … })()`, or `setup` never returns.
- `tool.transform` callbacks are **re-run** on reloads (the spike saw each run twice). Transforms must be idempotent.
- **Event types observed:** `integration.updated`, `model.updated`, `provider.updated`, `vcs.branch.updated`, `agent.updated`, `command.updated`, `skill.updated`, `websearch.updated`, `reference.updated`, `plugin.updated`, `session.inbox.enqueued`, `session.execution.started`, `session.instructions.updated`, `session.inbox.delivered`, `session.usage.updated`, `session.renamed`, `session.step.started`, `session.tool.input.started`, `session.tool.input.ended`, `session.tool.called`, `session.step.streamed`, `session.tool.success`, `session.step.ended`.

### 2.5 Code Mode (the most important surprise)

- **Tools that plugins add with `ctx.tool.transform` are NOT offered to the model as normal tools by default.** They are in "Code Mode":
  - The request's `tools` array contains the built-ins (`edit, glob, grep, question, read, shell, skill, subagent, webfetch, websearch, write`) plus one tool called **`execute`**, whose input is `{ code: string }`.
  - Plugin tools are listed in a **catalog inside the system prompt**, with lines like:
    ```
    - spike_echo (1 tool)
      - tools.spike_echo({
      text: string,
    }): Promise<string | null> // Echo the input text back
    ```
    Namespaced tools look like `- tools.opencode.session_rename({`.
  - To call a plugin tool, the model calls `execute` with `{ "code": "return await tools.spike_echo({ text: \"hi\" })" }`. **Verified working through the stub.**
  - If the stub calls `spike_echo` directly, the result is a `tool_use` event with `status: "error"` and `"No tool named \"spike_echo\" is currently available…"`.
- If the plugin sets `options: { codemode: false }` on the tool, it becomes a normal direct tool and appears in the request's `tools` array.
- **`tool.hook("execute.before"/"execute.after")` fires for both the outer `execute` call and every inner call**, with `tool` set to the inner tool's real name (`"spike_echo"`). This is why tool assertions must come from the probe.
- The built-in shell tool is called **`shell`** (not `bash`). Its input is `{ command, description }`.

### 2.6 Things not verified (be careful, check before relying on them)

- How a *namespaced* plugin tool's name appears in `tool.hook` (`ns_name`? `ns.name`?). Find out in milestone 2 and record it.
- `ctx.agent.list()` and `ctx.skill.list()` return shapes. Call them in try/catch and normalize with the `rows()` helper below.
- The `session.hook("http.request")` payload contains a `Request` object, which cannot be serialized as JSON. Record only method, url, and redacted headers.
- Whether the provider package `@ai-sdk/openai-compatible` is downloaded per sandbox, which would be slow. Measure it in milestone 3. If each sandbox re-downloads it, share one `XDG_CACHE_HOME` across sandboxes in a run and note it in NOTES.md.

---

## 3. Target layout

Create exactly this layout. The file names matter because the tests and docs refer to them.

```
.gitignore                   # node_modules/, review/, .opencode-ci/out/, coverage/, *.log
LICENSE                      # MIT, "Copyright (c) 2026 Heretek-AI"
NOTICE                       # lists files ported from IUMBTEMS (Apache-2.0)
README.md                    # user docs (milestone 12)
action.yml                   # composite GitHub Action (milestone 11)
package.json
tsconfig.json
biome.json                   # formatter + linter
bin/
  opencode-plugin-ci.ts      # #!/usr/bin/env bun — imports and calls src/cli.ts main()
src/
  index.ts                   # public programmatic API (re-exports)
  cli.ts                     # argument parsing and command dispatch
  util/
    log.ts                   # tiny logger (respects --quiet/--verbose)
    rows.ts                  # rows(): normalize `[]` or `{ data: [] }`
    fs.ts                    # writeJsonl, readJsonl, ensureDir, isFile
    redact.ts                # redaction + truncation helpers (shared with probe via copy)
  config/
    schema.ts                # zod schemas: Config, Scenario, Step, Matchers
    load.ts                  # find/parse/validate config + scenarios, apply defaults
  opencode/
    binary.ts                # resolve OPENCODE_BIN or install @opencode/cli@<v> into a cache
    events.ts                # parse --format json stdout into typed events + helpers
    logs.ts                  # parse logfmt stderr lines
  plugin/
    entry.ts                 # resolve server/tui entry from plugin.path + package.json
    shim.ts                  # write the shim directory
    install.ts               # run plugin.install / plugin.build in the checkout
  stub/
    stub.ts                  # OpenAI-compatible stub server (ported + extended)
    codemode.ts              # catalog parsing + auto-wrap
  sandbox/
    sandbox.ts               # isolated opencode installation + run()
  probe/
    read.ts                  # parse probe.jsonl into typed records + inventory
  assert/
    matchers.ts              # equals/contains/notContains/matches/notMatches/includes/exists/count
    expect.ts                # evaluate a scenario `expect` block against evidence
  tiers/
    load.ts                  # tier 1 (server plugins)
    ui-static.ts             # tier 1 for TUI-only plugins
    scripted.ts              # tier 2
    live.ts                  # tier 3 (attempts, budget, model resolution)
    judge.ts                 # judge run + verdict parsing
  report/
    results.ts               # results.json (EvalRow shape)
    markdown.ts              # report.md + $GITHUB_STEP_SUMMARY
  gate/
    verdict.ts               # COPY of IUMBTEMS gate.ts (Apache-2.0 header)
    history.ts               # fetch prior results via `gh` (ported from e2e-gate.ts)
    gate.ts                  # orchestrates: read acks, fetch history, decide, exit code
  run.ts                     # orchestrator for `run` command
probe/                       # shipped as-is, loaded by opencode (plain ESM JS, no build)
  core.js
  pre/server.js
  post/server.js
schema/                      # GENERATED by scripts/gen-schema.ts, committed
  config.json
  scenario.json
scripts/
  gen-schema.ts
test/
  unit/                      # fast, no opencode
  e2e/                       # spawns real opencode against fixtures (needs OPENCODE_BIN)
  fixtures/plugins/          # fixture plugins (milestone 6)
examples/
  workflow.yml
  .opencode-ci/config.yaml
  .opencode-ci/scenarios/example.yaml
docs/
  SPEC.md                    # already exists
  NOTES.md                   # your findings log
  IMPLEMENTATION_PROMPT.md   # this file
```

### 3.1 `package.json`

```json
{
  "name": "@heretek-ai/opencode-plugin-ci",
  "version": "0.1.0",
  "description": "Verify opencode v2 plugins actually work, locally and in GitHub Actions",
  "license": "MIT",
  "type": "module",
  "repository": { "type": "git", "url": "git+https://github.com/Heretek-AI/opencode-v2-plugin-teser.git" },
  "bin": { "opencode-plugin-ci": "bin/opencode-plugin-ci.ts" },
  "exports": { ".": "./src/index.ts" },
  "files": ["bin", "src", "probe", "schema", "README.md", "LICENSE", "NOTICE"],
  "engines": { "bun": ">=1.2" },
  "scripts": {
    "check": "bun run typecheck && bun run lint && bun run test:unit",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test:unit": "bun test ./test/unit",
    "test:e2e": "bun test ./test/e2e --timeout 600000",
    "schema": "bun scripts/gen-schema.ts"
  },
  "dependencies": {
    "yaml": "^2.9.1",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@opencode/plugin": "2.0.26",
    "@types/bun": "^1.2.0",
    "@biomejs/biome": "^2.0.0",
    "typescript": "^5.8.0"
  }
}
```

- If a version range above does not resolve, use the newest version that does and note it in NOTES.md.
- `@opencode/plugin` is a dev dependency **only for types**. Runtime code in `probe/` must not import it.
- `tsconfig.json`: `"strict": true`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"target": "ESNext"`, `"types": ["bun"]`, `"noEmit": true`, `"allowImportingTsExtensions": true`. Include `src`, `bin`, `test` and `scripts`. Exclude `review`, `probe` and `test/fixtures`.
- `biome.json`: ignore `review/**`, `schema/**`, `test/fixtures/**/node_modules/**` and `.opencode-ci/out/**`.

---

## 4. Milestones

### M1: Scaffold

**Do:**
- Create the branch.
- Add `.gitignore` (with `review/` in it), `LICENSE`, `NOTICE` (empty list for now), `package.json`, `tsconfig.json` and `biome.json`.
- Add `bin/opencode-plugin-ci.ts`:
  ```ts
  #!/usr/bin/env bun
  import { main } from "../src/cli.ts"
  process.exit(await main(process.argv.slice(2)))
  ```
- Add `src/cli.ts` with `main(argv): Promise<number>`. For now it handles only `--version`, which prints the version from `package.json`, and `--help`.
- Add `test/unit/cli.test.ts` testing `--version`.
- Run `bun install` and **commit `bun.lock`**. The Action installs with `--frozen-lockfile`.

**Acceptance:**
- `bun run check` passes.
- `bun bin/opencode-plugin-ci.ts --version` prints `0.1.0`.

### M2: Re-run the spike yourself (≈30 minutes, do not skip)

This teaches you how opencode behaves before you build on it.

**Do:**
1. Create `review/spike/plugins/a/server.ts` and `review/spike/plugins/b/server.ts`.
   - Plugin `a` (`id: "spike-a"`) adds a tool `spike_echo` with `name`, `description`, a JSON-Schema `input` and `execute` returning `{ content: "echo:" + input.text }`. In `execute.before`, it appends `"+A"` to `input.text` when `i.tool === "spike_echo"`.
   - Plugin `b` (`id: "spike-b"`) logs every `execute.before` input to a file named by `process.env.SPIKE_LOG`.
2. Write `review/spike/run.ts`. It starts the stub server (copy `stub-llm.ts` into `review/spike/` for now) with a script that calls `execute` with `{ code: 'return await tools.spike_echo({ text: "hi" })' }` and then replies with text `done`.
3. Write a sandbox config with `plugins: [a, b]` and run `opencode run --standalone --auto --format json "go"` with **async spawn**.
4. Confirm that:
   - the `tool_use` event for `execute` has `output: "echo:hi+A"`,
   - `b` logged `{"text":"hi+A"}` for `spike_echo`.
5. Swap the order to `[b, a]` and confirm that `b` now logs `{"text":"hi"}`.
6. Find out how a **namespaced** tool's name appears in hooks. In plugin `a`, call `editor.namespace({ name: "ns", description: "test" })` before `editor.add`. If that API needs a different shape, read `node_modules/@opencode/plugin/dist/promise/tool.d.ts` and `node_modules/@opencode/schema/dist/tool.d.ts`.
   - Then read the catalog line from the stub's recorded system text, call the tool through `execute` using that exact path, and record the `tool` value the hook received.
7. Write all of this in `docs/NOTES.md`.

**Acceptance:** `docs/NOTES.md` exists with results for steps 4, 5 and 6, including the exact namespaced name format.

### M3: opencode binary, events, logs, sandbox

**`src/opencode/binary.ts`**

```ts
export async function resolveOpencode(version: string): Promise<{ bin: string; version: string }>
```

- If `process.env.OPENCODE_BIN` is set, return it, and run `<bin> --version` to report the version. In that case, ignore `version`.
- Otherwise:
  - If `version === "latest"`, resolve it with `npm view @opencode/cli version`.
  - Use the cache dir `${XDG_CACHE_HOME ?? ~/.cache}/opencode-plugin-ci/opencode/<version>`. If `<dir>/node_modules/.bin/opencode` exists, use it.
  - Otherwise run `npm install --no-save --no-audit --no-fund --prefix <dir> @opencode/cli@<version>` with async spawn.
- Verify by running `<bin> --version` and checking that the output contains `v<version>`. Throw a clear error if not.

**`src/opencode/events.ts`**

- `parseEvents(stdout: string): RunEvent[]` keeps only lines starting with `{` and wraps `JSON.parse` in try/catch, so a bad line is skipped and counted.
- Write these helpers with exact types:
  - `textOf(events)` joins all `text` parts with `"\n"`.
  - `toolUses(events)` returns `[{ tool, status, input, output, error, innerCalls }]`. `innerCalls` comes from `state.metadata.metadata.toolCalls ?? []`.
  - `errors(events)` returns the `error` events.
  - `usage(events)` sums `cost` and `tokens.input/output` over `step_finish` parts.

**`src/opencode/logs.ts`**

- `parseLogLine(line): Record<string,string> | undefined` is a logfmt parser. It must handle `key=value`, `key="quoted value with \"escapes\""` and keys containing dots (for example `plugin.id`).
- `parseLogs(stderr)` returns the parsed lines. Keep the raw line on each entry as `_raw`.
- `pluginLogProblems(lines, { id?, path })` returns lines where:
  - `level` is `ERROR` or `FATAL` and the raw line contains the plugin id or path, **or**
  - `message`/`msg` is `failed to load plugin` and `plugin.id === id`.
- Unit-test this parser against these exact real lines:
  ```
  timestamp=2026-10-17T22:02:15.624Z level=WARN run=58f085ac message="failed to load plugin" plugin.id=spike-boom cause="Cause([Die(Error: BOOM in setup)])" http.span=439 role=server
  timestamp=2026-10-17T22:02:15.313Z level=INFO run=58f085ac msg="loading plugin" id=/tmp/claude-0/spike/plugins/a entrypoint=file:///tmp/claude-0/spike/plugins/a/server.ts http.span=128 role=server
  timestamp=2026-10-17T21:59:00.449Z level=WARN run=b3b4beed message="configured plugin path must be a directory" target=/tmp/claude-0/spike/plugins/a.ts http.span=85 role=server
  ```

**`src/sandbox/sandbox.ts`**

Port `claude-4-opencode/e2e/lib/sandbox.ts`, but **remove** everything c4o-specific (`c4o()`, `addMarketplace`, `C4O_*` env vars, `serve()`, the `Server` class and `turn()`).

```ts
export interface SandboxOptions {
  opencodeBin: string
  stubUrl?: string                  // stub provider baseURL; omit for live
  liveModel?: string                // "provider/model"; when set, model = liveModel and the stub provider is still configured but unused
  plugins: { package: string; options?: Record<string, unknown> }[]   // already ordered: probe-pre, plugin, probe-post
  agents?: Record<string, unknown>  // e.g. the judge agent
  workspace?: Record<string, string>// relative path -> file content, written into project/
  env?: Record<string, string>      // extra env (live keys, etc.)
  logLevel?: "info" | "all"
  keep?: boolean
}
export class Sandbox {
  readonly root: string; readonly project: string; readonly env: Record<string, string>
  readonly probeFile: string        // <root>/probe.jsonl
  constructor(opts: SandboxOptions)
  run(prompt: string, opts?: { agent?: string; timeoutMs?: number; auto?: boolean }): Promise<RunOutput>
  dispose(): Promise<void>          // rm -rf root unless keep or OPENCODE_PLUGIN_CI_KEEP=1
  [Symbol.asyncDispose](): Promise<void>
}
export interface RunOutput { code: number; timedOut: boolean; stdout: string; stderr: string; events: RunEvent[]; durationMs: number }
```

- **Env** (exactly):
  - `PATH` (inherited)
  - `TERM=dumb`
  - `HOME=<root>/home`
  - `XDG_CONFIG_HOME=<root>/config`, `XDG_DATA_HOME=<root>/data`, `XDG_CACHE_HOME=<root>/cache`, `XDG_STATE_HOME=<root>/state`
  - `GIT_CONFIG_GLOBAL=<root>/gitconfig` (an empty file)
  - `OPENCODE_DISABLE_AUTOUPDATE=1`, `OPENCODE_DISABLE_MODELS_FETCH=1`
  - then `...opts.env`
- **Project:** `mkdir <root>/project`, write `README.md` with `# Sandbox project\n`, write the `workspace` files (create parent dirs), then run `git init -q`.
- **run():**
  - args: `["run", "--standalone", ...(auto !== false ? ["--auto"] : []), "--format", "json", "--print-logs", "--log-level", logLevel ?? "info", ...(agent ? ["--agent", agent] : []), prompt]`
  - spawn options: `cwd: project`, `stdio: ["ignore","pipe","pipe"]`, **async**
  - On timeout (default 120000 ms), kill with `SIGKILL` and set `timedOut: true`.
- **Evidence:** `run()` does not write evidence files; the tier code does.

**Acceptance:**
- `test/unit/logs.test.ts` and `test/unit/events.test.ts` pass, with fixtures copied from the real outputs in section 2.
- `test/e2e/sandbox.test.ts` creates a Sandbox with no plugins and a stub script `[{ text: "ok" }]`. It asserts `code === 0`, that `textOf(events)` contains `ok`, and that there are no `error` events.
- Measure how long that e2e test takes and write the number in NOTES.md (the section 2.6 cache question).

### M4: Stub model with Code Mode auto-wrap and judge detection

**`src/stub/stub.ts`.** Port `stub-llm.ts` and keep its SSE `respond()` function **byte-for-byte**, because it is proven to work. Then extend it:

```ts
export interface ToolCall { name: string; arguments: Record<string, unknown> }
export interface Step { text?: string; toolCalls?: ToolCall[]; raw?: boolean }  // raw: never auto-wrap
export type RequestKind = "primary" | "judge" | "auxiliary"
export interface Recorded { seq: number; kind: RequestKind; step?: Step; sent?: Step; body: ChatRequest }
export interface StubOptions { script: Step[]; judgeReply?: string; recordFile?: string }
export function startStub(opts: StubOptions): Stub   // Stub: { url, requests, primary(), waitForPrimary(n), exhausted: boolean, stop() }
export const JUDGE_SENTINEL = "OPENCODE_PLUGIN_CI_JUDGE"
export const EXHAUSTED = "STUB_SCRIPT_EXHAUSTED"
```

- **Classification**, checked in this order:
  1. If any message's text contains `JUDGE_SENTINEL`, the request is `judge`. Reply with `judgeReply ?? '{"pass":false,"reason":"no judgeReply scripted"}'` as text.
  2. If `body.tools` is a non-empty array, the request is `primary`. It consumes the next script step. If the script is exhausted, reply with text `EXHAUSTED` and set `exhausted = true`.
  3. Otherwise the request is `auxiliary` (titles and the like). Reply with text `Stub title`.
- **Recording:** append every request to `recordFile` as JSONL: `{ seq, kind, step, sent, body }`, where `sent` is the step after auto-wrap.
- **Auto-wrap** happens for `primary` requests only, and only when `step.raw !== true`. For each tool call in the step:
  - If `call.name` is in `body.tools[].function.name`, leave it as is.
  - Otherwise, if `execute` is offered, find the call path with `findCatalogPath(allMessageText(body), call.name)`. Replace the call with `{ name: "execute", arguments: { code: \`return await ${path}(${JSON.stringify(call.arguments)})\` } }`.
  - If neither applies, leave it unchanged. opencode will report "No tool named …", and the scenario's assertions will catch it.

**`src/stub/codemode.ts`**

```ts
/** Every `tools.…(` call path listed in a Code Mode catalog. */
export function catalogPaths(text: string): string[] {
  const re = /^\s*-\s+(tools(?:\.[A-Za-z_$][\w$]*|\[(?:"[^"]+"|'[^']+')\])+)\(/gm
  return [...text.matchAll(re)].map((m) => m[1]!)
}
/** Segments of a path: tools.ns["my-tool"] -> ["ns","my-tool"] */
export function pathSegments(path: string): string[]
/** The path whose last segment equals `name`, or whose segments joined by "_" equal `name`. Undefined if none or ambiguous. */
export function findCatalogPath(text: string, name: string): string | undefined
```

- `allMessageText(body)` joins every message's text content, using the `text()` helper from `stub-llm.ts` (it handles string and array content).
- Unit-test `catalogPaths` and `findCatalogPath` with this exact catalog text, which was captured from opencode 2.0.26:
  ```
  - opencode (2 tools)
    - tools.opencode.session_move({
    directory: string,
  }): Promise<{ sessionID: string, directory: string }> // Move a session …
    - tools.opencode.session_rename({
    title: string,
  }): Promise<{ sessionID: string, title: string }> // Rename a session …
  - spike_echo (1 tool)
    - tools.spike_echo({
    text: string,
  }): Promise<string | null> // Echo the input text back
  ```
  The expected results are:
  - `findCatalogPath(t, "spike_echo") === "tools.spike_echo"`
  - `findCatalogPath(t, "opencode_session_rename") === "tools.opencode.session_rename"`
  - `findCatalogPath(t, "session_rename") === "tools.opencode.session_rename"`
  - `findCatalogPath(t, "nope") === undefined`

**Acceptance:**
- Unit tests pass for classification (feed the request handler fake bodies), auto-wrap and the catalog functions.
- `test/e2e/stub-codemode.test.ts`: a fixture plugin adds `echo_tool` (Code Mode default). The script step `{ toolCalls: [{ name: "echo_tool", arguments: { text: "hi" } }] }` must produce a `tool_use` event for `execute` with status `completed` and output containing `echo:hi`.

### M5: The probe

`probe/` is plain ESM JavaScript, because opencode loads it directly. **It must not import anything** except `node:fs` and `node:path`.

**`probe/core.js`** (a reference implementation; the shapes are verified, but polish it as needed):

```js
import { appendFileSync } from "node:fs"

const SECRET_KEY = /KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE/i
const MAX = 4000
const SYSTEM_MAX = 50000 // system parts are long; plugin additions often land at the end

function clip(value, depth = 0, max = MAX) {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…[+${value.length - max}]` : value
  if (value === null || typeof value !== "object") return value
  if (depth > 6) return "[depth]"
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => clip(item, depth + 1, max))
  const out = {}
  for (const [key, item] of Object.entries(value)) out[key] = clip(item, depth + 1, max)
  return out
}

function redactEnv(env) {
  const out = {}
  for (const [key, value] of Object.entries(env ?? {})) out[key] = SECRET_KEY.test(key) && value ? "[redacted]" : value
  return out
}

/** Deep-copies at record time: later plugins mutate the same object. */
function snapshot(value) {
  try { return JSON.parse(JSON.stringify(value)) } catch { return String(value) }
}

const rows = (json) => (Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [])
const safe = async (fn) => { try { return await fn() } catch (error) { return { error: String(error) } } }

export function makeProbe(phase) {
  let seq = 0
  let inventoryDone = false
  return {
    id: `opencode-plugin-ci.probe.${phase}`,
    setup: async (ctx) => {
      const out = ctx.options?.out
      if (!out) return
      // Metadata goes LAST so a payload field can never overwrite `kind`/`phase`.
      const write = (kind, data, max = MAX) =>
        appendFileSync(out, JSON.stringify({ ...clip(snapshot(data), 0, max), phase, seq: seq++, t: Date.now(), kind }) + "\n")

      write("setup", { ctxKeys: Object.keys(ctx) })

      await ctx.tool.hook("execute.before", (i) => write("tool.before", { tool: i.tool, callID: i.id, input: i.input }))
      await ctx.tool.hook("execute.after", (i) =>
        write("tool.after", { tool: i.tool, callID: i.id, status: i.status, input: i.input, result: i.result, error: i.error }),
      )
      await ctx.shell.hook("create.before", (i) =>
        write("shell.before", { command: i.command, cwd: i.cwd, shell: i.shell, env: redactEnv(i.env) }),
      )
      await ctx.session.hook("prompt", async (i) => {
        write("session.prompt", { prompt: i.prompt })
        if (phase !== "post" || inventoryDone) return
        inventoryDone = true
        write("inventory", {
          plugins: rows(await safe(() => ctx.plugin.list())).map((p) => ({ id: p.id, source: p.source, status: p.state?.status, error: p.state?.error })),
          tools: (await safe(() => ctx.tool.list())).map?.((t) => t.id) ?? [],
          commands: rows(await safe(() => ctx.command.list())).map((c) => c.name),
          agents: rows(await safe(() => ctx.agent.list())).map((a) => a.id ?? a.name),
          skills: rows(await safe(() => ctx.skill.list())).map((s) => s.id ?? s.name),
          mcp: rows(await safe(() => ctx.mcp.list())).map((m) => m.name ?? m[0]),
        })
      })
      await ctx.session.hook("context", (i) =>
        write(
          "session.context",
          {
            agent: i.agent,
            // One string per system part, so an appended part survives clipping of a long base prompt.
            system: (i.system ?? []).map((part) => (typeof part === "string" ? part : (part.text ?? JSON.stringify(part)))),
            tools: Object.keys(i.tools ?? {}),
            messageCount: i.messages?.length ?? 0,
          },
          SYSTEM_MAX,
        ),
      )
      await ctx.session.hook("model.request", (i) =>
        // `requestKind`, not `kind`: `kind` is the record type.
        write("session.model.request", { requestKind: i.kind, model: i.model, baseURL: i.baseURL, headers: redactEnv(i.headers) }),
      )

      if (phase === "post") {
        void (async () => {
          try {
            for await (const ev of ctx.event.subscribe()) write("event", { type: ev?.type })
          } catch (error) {
            write("event.error", { error: String(error) })
          }
        })()
      }
    },
  }
}
```

- `probe/pre/server.js`: `import { makeProbe } from "../core.js"; export default makeProbe("pre")`
- `probe/post/server.js`: `import { makeProbe } from "../core.js"; export default makeProbe("post")`
- The record kinds are: `setup`, `tool.before`, `tool.after`, `shell.before`, `session.prompt`, `session.context`, `session.model.request`, `inventory` (post only), `event` (post only) and `event.error`.
- `session.context.system` is an **array** of strings, one per system part. Matchers on `system` run against the parts joined with `"\n"`.
- This exact code was run against opencode 2.0.26 with `[pre, plugin, post]`:
  - `pre` saw `{"text":"hi"}` and `post` saw `{"text":"hi+A"}`,
  - `post` `shell.before` had `SPIKE_A=1` and `pre` did not,
  - the inventory listed all three local plugins as `active`, plus tools, commands (`init`, `review`), agents (`build`, `general`, `explore`, `compaction`, `title`, `summary`, `plan`) and skills,
  - 46 events were recorded, including `session.tool.called` and `session.tool.success`.

**`src/probe/read.ts`**

- `readProbe(file): ProbeLog` returns `{ records, inventory?, byKind(kind, phase?) }`. Parse JSONL defensively.
- `ProbeLog.toolCalls(phase = "post")` pairs `tool.before` with `tool.after` by `callID` and returns `[{ tool, input, status, result, error }]`. **Exclude** the outer `execute` call when it has inner calls. Keep `execute` itself only if a scenario asserts on it by name.

**Acceptance:** `test/e2e/probe.test.ts` loads `[pre, fixture plugin a, post]`. Plugin `a` mutates `execute.before` input and sets env `SPIKE_A=1` in `shell.create.before`. The test asserts:
- `pre` `tool.before` for `echo_tool` has the original input, and `post` has the mutated input,
- `post` `shell.before` has `env.SPIKE_A === "1"`, and `pre` does not,
- the inventory lists the fixture plugin with status `active` and `echo_tool` in `tools`,
- at least one `event` record has type `session.tool.called`.

### M6: Fixture plugins (used by every later test)

Create these under `test/fixtures/plugins/`. Each one is a directory with a `package.json` (name `fixture-<x>`, `"type": "module"`) and its own `.opencode-ci/` config and scenarios, so they double as end-to-end examples. Write them in `.ts` with no build step. **Point their `package.json` `exports["./server"]` at `./src/server.ts`** so the entry resolver and shim get exercised.

| Fixture | Behavior | Its scenarios (pass and fail) |
|---|---|---|
| `tool-basic` | Adds `echo_tool` (Code Mode default): returns `echo:<text>` | pass: tool called, completed, output contains `echo:hi`. fail: expects `echo:bye` |
| `tool-direct` | Same, with `options: { codemode: false }` | pass: `request.tools includes echo_tool` (direct) |
| `hook-mutate` | `execute.before` on `shell`: replaces `secret` with `[x]` in `input.command` | pass: `post` input `notContains: secret`, `pre` input `contains: secret` |
| `shell-env` | `shell.create.before` sets `env.FIXTURE_ON = "1"` | pass: shell.before env `FIXTURE_ON equals 1`, and tool output contains `FIXTURE_ON=1` when the script runs `echo FIXTURE_ON=$FIXTURE_ON` |
| `system-inject` | `session.hook("context")` pushes `{ type: "text", text: "FIXTURE-SYSTEM" }` to `system` | pass: `request.system contains FIXTURE-SYSTEM` (stub-recorded) |
| `event-file` | Iterates `ctx.event.subscribe()` and writes `.fixture/events.log` in `ctx.location.directory` on `session.tool.called` | pass: `files: [{ path: .fixture/events.log, exists: true }]` |
| `throws` | `setup` throws `Error("fixture boom")` | tier 1 must fail, with `fixture boom` in the failure text |
| `no-entry` | `package.json` with no exports or main, and no `server.*` or `index.*` | `validate`/`run` exits 2 with a clear "no server entry" message |
| `tui-only` | Only `tui.ts` exporting `{ id: "fixture-tui", setup() {} }` | static tier 1 passes; tiers 2 and 3 are reported `skipped` |
| `tui-broken` | `tui.ts` that throws on import | static tier 1 fails |

**Acceptance:**
- Every fixture directory exists, with a short `README.md` saying what it proves.
- `bun test test/e2e` can still be skipped for now; the fixtures are used from M8 on.

### M7: Config and scenario schema

**`src/config/schema.ts`.** Use **zod v4**. Every object schema is `.strict()`, so unknown keys fail. That is a hard requirement from the spec: typos must never silently pass.

- **Config** (defaults in brackets):
  - `plugin`:
    - `path` [`.`]
    - `entry?`
    - `install?`
    - `build?`
    - `options` [`{}`]
    - `ui` [auto-detected; `true` forces TUI-only]
  - `opencode.versions` [`["2.0.26"]`]: a non-empty array of semver or `"latest"`. The first entry is required to pass; the rest may fail.
  - `expect`: `{ tools?, commands?, agents?, skills?, mcp?, providers?, models? }`, each a string array.
  - `live`:
    - `model?`
    - `keys` [`["OPENCODE_API_KEY"]`]
    - `repeat` [3]
    - `pass` [2]: must be ≤ `repeat`
    - `budgetUSD` [1]
    - `timeoutMs` [240000]
  - `gate`:
    - `enabled` [true]
    - `window` [5]
    - `threshold` [0.9]
    - `bootstrap` [`"fail"`]: `"fail" | "allow"`
    - `workflow?` [inferred from `GITHUB_WORKFLOW_REF`]
  - `logLevel` [`"info"`]: `"info" | "all"`
- **Scenario:**
  - `id`: must match `/^[a-z0-9][a-z0-9-]*$/`
  - `description?`
  - `mode`: `"scripted" | "live"`
  - `plugin?: { options? }`
  - `workspace?: Record<string,string>`
  - `prompt: string`
  - `script?: Step[]`: required when `mode === "scripted"`, forbidden when `"live"`
  - `judgeReply?`: scripted only, used to test the judge path offline
  - `timeoutMs` [120000]
  - `expect`: see below
  - `judge?: { rubric: string; model?: string }`: live only
- **Matcher** is an object with any of `equals, contains, notContains, matches, notMatches, includes, exists, count`.
  - `matches` and `notMatches` are JavaScript regex source strings. Support a leading `(?i)` by stripping it and adding the `i` flag.
  - `count` is `{ eq?, gte?, lte? }`.
- **expect:**
  - `exitCode?` [0]
  - `noErrors?` [true]
  - `tools?`: `[{ name, status?: "completed"|"error", input?: Record<string, Matcher>, output?: Matcher, count? }]`
  - `noTools?: string[]`
  - `hooks?`: `[{ hook: "tool.execute.before"|"tool.execute.after"|"shell.create.before"|"session.context"|"session.prompt", phase?: "pre"|"post" ["post"], tool?, input?: Record<string,Matcher>, env?: Record<string,Matcher>, system?: Matcher }]`
  - `request?`: `{ nth?: number [1], system?: Matcher, tools?: Matcher }` (scripted only)
  - `files?`: `[{ path, exists?: boolean, contains?, notContains?, matches? }]`
  - `stderr?: Matcher`
  - `text?: Matcher`
- **Cross-field checks** go in `superRefine`. Each produces a clear message naming the scenario file and the field:
  - `request` is not allowed in live mode,
  - `script` is required in scripted mode and forbidden in live mode,
  - `judge` is live only,
  - `pass ≤ repeat`.

**`src/config/load.ts`**

- Find `.opencode-ci/config.yaml` or `.opencode-ci/config.json` under the working directory. **Both existing is an error.** Neither existing means use the defaults, with a warning.
- Scenarios are `.opencode-ci/scenarios/*.{yaml,yml,json}`, sorted by filename. Duplicate `id`s are an error.
- Parse YAML with the `yaml` package. Errors must include the file path and the line number when `yaml` gives one.

**`scripts/gen-schema.ts`** writes `schema/config.json` and `schema/scenario.json` using `z.toJSONSchema()`. Commit the output. Add a unit test that regenerates both into a temp dir and compares them with the committed files, so the schemas never drift.

**Acceptance:** unit tests cover:
- defaults,
- the unknown-key rejection (`expect: { tool: [...] }` with a typo must fail),
- every cross-field rule,
- the YAML-vs-JSON precedence error,
- the duplicate-id error,
- the `(?i)` handling.

### M8: Entry resolution, shim, install/build, tier 1

**`src/plugin/entry.ts`**

```ts
export interface Entries { server?: string; tui?: string }   // absolute file paths
export function resolveEntries(pluginPath: string, explicit?: string): Entries
```

Server entry order (the first one that exists as a file wins):
1. `explicit` (relative to `pluginPath`),
2. `package.json` `exports["./server"]`, then `exports["."]`. Each may be a string or a conditions object; take `import ?? default ?? bun ?? node`, and accept nested `{ ".": { import: … } }`,
3. `package.json` `main`,
4. `server.ts`, `server.js`, `server.mjs`,
5. `index.ts`, `index.js`, `index.mjs`.

TUI entry order: `exports["./tui"]`, then `tui.ts`, `tui.js`, `tui.mjs`.

Unit-test it with temp directories covering every branch.

**`src/plugin/shim.ts`**

- `writeShim(root, serverEntry): string` creates `<root>/plugin-under-test/server.js` containing exactly:
  ```js
  export { default } from "<file:// URL of serverEntry>"
  ```
  Use `pathToFileURL(serverEntry).href` so spaces and Windows paths are safe.
- It returns the shim directory.

**`src/plugin/install.ts`**

- `runStep(name, command, cwd)` runs a shell command (`bash -lc` on POSIX, `cmd /c` on Windows) with **async** spawn and streams output. It throws `ConfigError` with the exit code on failure.
- It runs once per `run`, before any tier.

**`src/tiers/load.ts`**, tier 1:

1. Create a stub with script `[{ text: "ok" }]`.
2. Create a Sandbox with plugins `[probe/pre, shim, probe/post]` (absolute paths, with `probe` resolved relative to the package via `new URL("../../probe/pre", import.meta.url)`), and `options` set to `{ out: probeFile, phase }` for the probes.
3. Run `run("Reply with ok.")`.
4. Write evidence into `<out>/<version>/load/`: `events.jsonl`, `stderr.log`, `probe.jsonl` and `stub-requests.jsonl`.
5. Assert the following. Each failed check becomes a human-readable failure string.
   - `code === 0`, not timed out, and no `error` events.
   - The inventory exists. If it does not, report: "probe inventory missing: opencode never reached a prompt".
   - The plugin under test is found as the inventory plugin whose `source.path` equals `<shimDir>/server.js`.
     - If it is missing: "plugin never registered. opencode loads only server.*/index.* from a directory; the resolved entry was <entry>".
     - If its status is `failed`: "plugin setup failed: <error first 3 lines>".
   - `pluginLogProblems(...)` is empty. If not, list the lines.
   - Each `config.expect.tools[]` item is in `inventory.tools`, and the same for commands, agents, skills and mcp.
6. Return a `CaseResult` (see M10) with `tier: "load"` and `id: "load"`.

**`src/tiers/ui-static.ts`** runs a child process `bun -e` that does `const m = await import(<file url>); const d = m.default; …`. It prints JSON `{ ok, id?, error? }` and checks `typeof d?.id === "string" && typeof d?.setup === "function"`. Run it with `cwd` set to the plugin path, so the plugin's own `node_modules` resolve, with a 30 s timeout.

**Acceptance** (e2e):
- `tool-basic` passes tier 1, with the expected tool listed.
- `throws` fails with a message containing `fixture boom`.
- `no-entry` exits 2.
- `tui-only` passes static, and `tui-broken` fails static.

### M9: Matchers, expect evaluation, tier 2

**`src/assert/matchers.ts`**

```ts
export function check(value: unknown, matcher: Matcher, label: string): string[]   // returns failure messages, [] = pass
```

- Non-string values are compared as `JSON.stringify(value)` for `contains`, `notContains`, `matches` and `notMatches`.
- `equals` uses deep equality.
- Messages must be specific, for example: `tools[0].output: expected to contain "echo:bye", got "echo:hi"` (truncate the "got" part to 300 chars).

**`src/assert/expect.ts`**

```ts
export interface Evidence { run: RunOutput; probe: ProbeLog; stubRequests: Recorded[]; projectDir: string; mode: "scripted" | "live" }
export function evaluate(expect: ScenarioExpect, ev: Evidence): string[]
```

- `tools` come from `probe.toolCalls("post")`.
  - For each expected tool, find calls whose `tool === name`. Assert `count` (default `gte: 1`).
  - Then require that **at least one** call matches `status`, `input` and `output` together.
  - The output text for a call is `result.content` joined (string, or an array of `{text}`) or `result.output` stringified.
- `noTools` means no probe call with that name **and** no `tool_use` event with that name.
- `request` picks the nth `primary` stub request (1-based):
  - `system` = all system-role text,
  - `tools` = the direct tool names **plus** the catalog tool names. For the catalog names, take `catalogPaths(text)` and map each to its last segment and its `_`-joined form.
- `files` paths are relative to `projectDir`. Reject any `..` that escapes it.
- `text` is `textOf(events)`, and `stderr` is the raw stderr.

**`src/tiers/scripted.ts`** runs one scenario per sandbox:
1. Start a stub with the scenario script, `judgeReply` and a `recordFile`.
2. Create a sandbox with merged plugin options (`config.plugin.options` shallow-merged with `scenario.plugin.options`) and the workspace files.
3. Run with the scenario prompt and timeout.
4. Write the evidence files.
5. Evaluate. If `stub.exhausted`, add the failure "script exhausted: opencode made more model requests than the script has steps".
6. Return a `CaseResult`.

Run scenarios with concurrency `min(4, os.availableParallelism())`, using a tiny promise pool you write yourself.

**Acceptance:** every fixture's pass scenarios pass and every fail scenario fails, with the expected message. Put this in `test/e2e/tier2.test.ts` as a table-driven test.

### M10: Results, report, CLI `run`/`validate`/`init`/`report`

**`src/report/results.ts`.** This is the IUMBTEMS `EvalRow` shape, extended:

```ts
export interface CaseResult {
  id: string                 // scenario id, or "load"
  tier: "load" | "scripted" | "live"
  opencode: string           // resolved version
  pass: boolean
  skipped?: string           // reason, when skipped
  description?: string
  failures?: string[]
  tools?: string[]           // tool names called (probe, post)
  steps?: number             // count of step_finish
  costUSD?: number
  tokens?: { input: number; output: number }
  durationMs: number
  textExcerpt?: string       // first 300 chars of text
  attempts?: { pass: boolean; failures: string[] }[]   // live only
  judge?: { pass: boolean; reason: string }
  kept?: string              // evidence dir
}
export interface ResultsFile { version: 1; at: string; tool: string; plugin: string; results: CaseResult[] }
```

The results are written to `<out>/results.json`.

**`src/report/markdown.ts`.** Port the layout of `e2e-report.ts`:
- a header with the plugin, tool version, opencode versions, git SHA (`GITHUB_SHA` or `git rev-parse --short HEAD`) and totals,
- one table per opencode version with the columns: `Tier | Case | Result | Tools | Steps | Cost | Time`,
- results shown as `✅ pass`, `❌ fail`, `⏭️ skipped (<reason>)` or `⚠️ allowed failure` (for a non-required opencode version),
- for each failure, a `<details>` block with the failures list and the evidence path,
- for live runs, a cost and token totals line.

The report is written to `<out>/report.md`. When `GITHUB_STEP_SUMMARY` is set, it is also **appended** there.

**`src/cli.ts`.** Parse arguments by hand; no CLI framework.

```
opencode-plugin-ci init        [--force]                      # writes examples/.opencode-ci/* into cwd; refuses to overwrite without --force
opencode-plugin-ci validate                                   # load + validate config/scenarios + resolve entries; print summary
opencode-plugin-ci run         [--tier load|scripted|live]... [--scenario <id>]... [--opencode <v>]... [--out <dir>] [--keep] [--gate] [--verbose] [--quiet]
opencode-plugin-ci report      [<results.json>]                # re-render report.md (and step summary)
opencode-plugin-ci --version | --help
```

- **Exit codes:**
  - `0`: all required cases pass, and skips are fine.
  - `1`: any required case failed, or the gate failed.
  - `2`: a configuration error, a missing entry, or the gate has no history (unless `gate.bootstrap: allow`).
- **Required vs allowed:** results for `opencode.versions[0]` are required. Failures on other versions are "allowed failures": they are reported but do not affect the exit code.

**`src/run.ts` order:**
1. Load and validate.
2. Resolve entries. If there is no server entry and no TUI entry, exit 2.
3. Run install and build.
4. For each version:
   - Resolve the binary.
   - Run tier 1 (or the static tier 1 for TUI-only plugins).
   - If tier 1 failed, mark this version's tier 2 and tier 3 cases `skipped: "tier 1 failed"`.
   - Otherwise run tier 2, then tier 3.
   - For TUI-only plugins, mark tier 2 and tier 3 `skipped: "TUI-only plugin"`.
5. If any `.opencode-ci/**/*.test.ts` files exist, run `bun test .opencode-ci` once (with `OPENCODE_BIN` set to the required version's binary) and add one case `{ id: "bun-test", tier: "scripted" }` that passes when the exit code is 0, with the last 40 lines of output as its failures otherwise. This is the spec's programmatic escape hatch.
6. Write `results.json` and the report.
7. Run the gate if it applies.
8. Return the exit code.

**`src/index.ts`** exports the programmatic API for `bun:test` users: `Sandbox`, `startStub`, `readProbe`, `evaluate`, `check`, `resolveEntries`, `writeShim`, `resolveOpencode`, `parseEvents`, `textOf`, `toolUses`, plus a convenience `probePluginDirs()` that returns the absolute `pre` and `post` probe directories.

**Acceptance:**
- `bun bin/opencode-plugin-ci.ts run` inside `test/fixtures/plugins/tool-basic` passes and writes `report.md`.
- Inside `throws`, it exits 1.
- `validate` in `no-entry` exits 2.
- A unit test snapshot-checks the Markdown for a fixed `ResultsFile`.

### M11: Live tier, judge, budget

**`src/tiers/live.ts`**

- **Keys:** collect `config.live.keys` from `process.env`. If none are set, every live scenario is `skipped: "no API key (set one of: …)"`. This is **not** a failure. Fork PRs have no secrets.
- **Model:** port `resolveModel` from `live.test.ts`.
  - If `config.live.model` contains `/`, use it as is.
  - Otherwise run `opencode models` in a throwaway sandbox with the keys and pick the line ending in `/<model>`, preferring `opencode-go/` and then `opencode/`.
  - If `live.model` is missing, use `opencode/` + the first model that `opencode models` lists under `opencode/`, and log which one.
- **Per scenario:** up to `repeat` attempts. Each attempt uses a fresh sandbox with `liveModel` and the keys in `env`, then the same `evaluate()` as tier 2 (scripted-only checks are already rejected by the schema).
  - Stop early once `pass` attempts have passed, or once passing has become impossible.
  - Record every attempt in `attempts`.
  - Each attempt's cost (`usage(events).cost`) is added to a run-wide budget counter. Before starting an attempt, if `spent >= budgetUSD`, stop and mark the remaining cases `skipped: "budget exhausted ($x of $y)"`.
- **Judge** (`src/tiers/judge.ts`) runs only when the scenario has `judge.rubric` **and** the deterministic checks passed for that attempt.
  - A fresh sandbox with **no plugins**, the same model (or `judge.model`), and `agents: { "opencode-plugin-ci-judge": { mode: "primary", description: "Grades recorded evidence", system: JUDGE_SYSTEM, permissions: [{ action: "*", resource: "*", effect: "deny" }] } }`.
  - Run with `agent: "opencode-plugin-ci-judge"` and **`auto: false`**.
  - The prompt is built by `buildJudgePrompt({ rubric, text, toolCalls, hookSummary, files })`. It must start with the line `OPENCODE_PLUGIN_CI_JUDGE`, then the rubric, then the evidence sections, each truncated to 8000 chars. It ends with: `Reply with exactly one JSON object: {"pass": true|false, "reason": "<one sentence>"} and nothing else.`
  - `JUDGE_SYSTEM`: "You grade whether recorded evidence satisfies a rubric. You cannot run tools. Be strict: if the evidence does not clearly show the rubric is met, fail it."
  - Parse the verdict from the run's `textOf(events)`: take the first `{…}` block, `JSON.parse` it, and require `typeof pass === "boolean"` and `typeof reason === "string"`. **Anything else is a failed judgement** with the reason `judge reply was not valid JSON: <first 200 chars>`.
  - Judge cost counts toward the budget.

**Acceptance:**
- Unit tests for `buildJudgePrompt` and the verdict parser (valid, invalid, extra prose around the JSON, `pass` as a string `"true"` being rejected).
- e2e: a scripted scenario with `judgeReply` exercises the judge path offline through the stub, using the sentinel. Add a hidden test hook `OPENCODE_PLUGIN_CI_JUDGE_VIA_STUB=1` that lets `judge.ts` use the stub model, for testing only.
- Live: `OPENCODE_API_KEY=… bun bin/opencode-plugin-ci.ts run --tier live` in `tool-basic` with one live scenario ("Use the echo tool on the word hi and show me its output", expecting `tools: [{ name: echo_tool }]`). Run this manually if a key is available and record the result in NOTES.md. If no key is available, say so in NOTES.md. **Do not fake it.**

### M12: Flake gate (live tier only)

1. Copy `review/IUMBTEMS/packages/core/src/evals/gate.ts` to `src/gate/verdict.ts` **verbatim**. Add the Apache-2.0 header comment and list it in `NOTICE`. Copy its tests to `test/unit/gate-verdict.test.ts` and fix the import paths. They must pass unchanged otherwise.
2. `src/gate/history.ts` ports the `gh` logic from `e2e-gate.ts`:
   - `gh run list --workflow <workflow> --branch <GITHUB_REF_NAME> --status completed --limit 15 --json databaseId,conclusion,createdAt --repo <GITHUB_REPOSITORY>`
   - For each run (newest first), `gh run download <id> --name opencode-plugin-ci-results --dir <tmp>/<id> --repo …`. Skip runs where it fails.
   - Read `results.json`. Keep only `tier === "live"` rows of the **required** opencode version.
   - The workflow name comes from `config.gate.workflow` or is parsed from `GITHUB_WORKFLOW_REF` (`owner/repo/.github/workflows/<file>@ref` → `<file>`).
3. `src/gate/gate.ts`:
   - Read `.opencode-ci/acknowledgments.json`. If the file is **absent**, treat it as `{version:1, acknowledgments:[]}`. Note that this differs from IUMBTEMS, which fails when the file is absent; plugin repos should not be forced to create it. If it is present but malformed, exit 1.
   - Build the inputs and call `decideGateVerdict`.
   - Map the result to exit codes: green → 0, regression → 1, no history → 2, or 0 with a warning if `gate.bootstrap: "allow"`.
   - Print the verdict reasons into the report as a "Flake gate" section.
4. The gate runs only when **all** of these hold: the live tier ran with at least one non-skipped case, `gate.enabled`, and either `--gate` was passed or `GITHUB_ACTIONS === "true"`.
   - When it runs, **tier 3 failures are decided by the gate instead of failing directly**.
   - Tiers 1 and 2 are never gated: any failure there is a failure.
   - When `gh` is not available or `GH_TOKEN`/`GITHUB_TOKEN` is not set, the gate prints a clear message and falls back to "fail on any live failure".

**Acceptance:**
- The copied verdict tests pass.
- New unit tests for workflow-name parsing, the absent-acks default and the exit-code mapping, with `history` injected as a function so no network is needed.

### M13: Composite Action and docs

**`action.yml`:**

```yaml
name: opencode plugin CI
description: Verify an opencode v2 plugin actually works
branding: { icon: check-circle, color: green }
inputs:
  tiers:              { description: "Comma-separated: load,scripted,live", default: "load,scripted,live" }
  opencode-versions:  { description: "Overrides config, comma-separated", default: "" }
  working-directory:  { description: "Plugin repo directory", default: "." }
  upload-artifact:    { description: "Upload evidence + results", default: "true" }
outputs:
  result:      { description: "pass | fail | skipped", value: "${{ steps.run.outputs.result }}" }
  report-path: { description: "Path to report.md",     value: "${{ steps.run.outputs.report-path }}" }
runs:
  using: composite
  steps:
    - uses: oven-sh/setup-bun@v2
    - uses: actions/setup-node@v4
      with: { node-version: 22 }
    - id: run
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      env:
        GH_TOKEN: ${{ github.token }}
        # Inputs go through env, never interpolated into the script (prevents script injection).
        IN_TIERS: ${{ inputs.tiers }}
        IN_VERSIONS: ${{ inputs.opencode-versions }}
        ACTION_PATH: ${{ github.action_path }}
      run: |
        args=()
        IFS=',' read -ra T <<< "$IN_TIERS"; for t in "${T[@]}"; do args+=(--tier "$t"); done
        if [ -n "$IN_VERSIONS" ]; then IFS=',' read -ra V <<< "$IN_VERSIONS"; for v in "${V[@]}"; do args+=(--opencode "$v"); done; fi
        set +e
        bun "$ACTION_PATH/bin/opencode-plugin-ci.ts" run "${args[@]}" --out .opencode-ci/out
        code=$?
        set -e
        echo "report-path=$PWD/.opencode-ci/out/report.md" >> "$GITHUB_OUTPUT"
        if [ $code -eq 0 ]; then echo "result=pass" >> "$GITHUB_OUTPUT"; else echo "result=fail" >> "$GITHUB_OUTPUT"; fi
        exit $code
    - if: always() && inputs.upload-artifact == 'true'
      uses: actions/upload-artifact@v4
      with:
        name: opencode-plugin-ci-results
        path: ${{ inputs.working-directory }}/.opencode-ci/out
        if-no-files-found: ignore
```

- The action runs `bun install --frozen-lockfile` in `${{ github.action_path }}` before running, as a step before `run`. Add it.
- The artifact name defaults to `opencode-plugin-ci-results`, and the gate downloads history by that name. Add an `artifact-name` input (default `opencode-plugin-ci-results`) and a matching `gate.artifact` config field (same default). Artifact names must be unique within a workflow run, so the README must tell matrix users to set a distinct name per matrix leg **and** the same value in `gate.artifact`.
- **Never** interpolate `${{ inputs.* }}` directly inside a `run:` script. Pass inputs through `env:` as shown.

Also:
- Add `examples/workflow.yml` from SPEC.md section 8 (with `permissions: actions: read`).
- Write the README with these sections: what it does, a 5-minute quickstart (`bunx @heretek-ai/opencode-plugin-ci init`, edit, run), the config reference (link to the schema), the scenario reference with one example per assertion type, **"Your tools are in Code Mode"** (explain that the stub auto-wraps calls, and that live models call `execute`), tiers, the gate, and security. The security section must say plainly: **never use `pull_request_target` with the PR's code checked out and secrets exposed. The live tier runs the plugin's code with your real API key.**
- Add a CI workflow for this repo, `.github/workflows/ci.yml`. It runs `bun run check` on every push and PR, plus a job that installs `@opencode/cli@2.0.26` and runs `bun run test:e2e`.

**Acceptance:**
- `actionlint` passes, if it is installed (otherwise note that in NOTES.md).
- The README quickstart, followed literally in a fresh temp copy of `test/fixtures/plugins/tool-basic`, works.

### M14: Final pass

- Re-read `docs/SPEC.md` top to bottom. For every statement, either confirm that the code does it or list the gap in `docs/NOTES.md` under "Known gaps" with a one-line reason.
- Run `bun run check` and `bun run test:e2e`, and paste the summary lines of both into the final commit message.
- Push `impl/v1` and open a PR titled `Implement opencode-plugin-ci v1` against `main`. If you cannot push or open PRs, stop and say so. In the PR body:
  - **Before** and **After** paragraphs,
  - the test summary,
  - the "Known gaps" list,
  - anything in NOTES.md that contradicts the spec.

---

## 5. Gotchas (read again before each milestone)

1. **Async spawn only** for opencode. `spawnSync` with an in-process stub hangs.
2. **Plugin tools are Code Mode by default.** Assert tool calls from the probe (`tool.before`/`tool.after`), not from `tool_use` events, which only show `execute`.
3. **The shell tool is `shell`.** Its input has `command` and `description`.
4. **Local plugin dirs ignore `package.json`.** Always load through the shim. A dir with no `server.*`/`index.*` is skipped with **no log line**, so detect it through the inventory.
5. **Hook order = `plugins` array order.** Always use `[probe/pre, plugin, probe/post]`.
6. **Snapshot hook payloads immediately** (deep copy). They are mutable objects shared with later plugins.
7. **`ctx.event.subscribe()` is an async iterable.** Never await it in `setup`.
8. **Set `OPENCODE_DISABLE_MODELS_FETCH=1`**, or offline runs log an ERROR that is not the plugin's fault.
9. **Tool-less requests are not always titles.** The judge request has no tools. Use the sentinel.
10. **Stdin must be `ignore`.**
11. `tool.transform` runs more than once. Fixture transforms must be idempotent (check `editor.get(name)` before `add`).
12. **Never print or record secret values.** The probe redacts env and headers. Never log `process.env`. In the live tier, pass only the configured key names.
13. **Run e2e tests serially** where they share the opencode cache, and keep a per-test sandbox. Use `--keep` / `OPENCODE_PLUGIN_CI_KEEP=1` to debug a failing one, then inspect `<root>/probe.jsonl` and `stderr.log`.
14. When something behaves differently from this brief, **write it in NOTES.md first**, then adapt.

## 6. Definition of done

- [ ] Every milestone's acceptance check passes, and each milestone is its own commit.
- [ ] `bun run check` is green, and `bun run test:e2e` is green against `@opencode/cli@2.0.26`.
- [ ] Every fixture behaves as in the M6 table.
- [ ] `docs/NOTES.md` records: M2 results, namespaced tool naming, the cache timing, the live run result (or "no key available"), and Known gaps.
- [ ] `schema/*.json` are generated and in sync.
- [ ] The README quickstart works as written.
- [ ] `LICENSE`, `NOTICE` and the Apache headers on ported IUMBTEMS files are present.
- [ ] The PR is open with the body described in M14.
