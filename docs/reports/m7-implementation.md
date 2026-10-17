# M7 Implementation Report — Config and Scenario Schema

- **Stage ID:** M7 (config: `src/config/` + `scripts/gen-schema.ts` + `schema/` + unit tests)
- **Date:** 2026-10-17
- **Branch:** `impl/v1` (not committed, per task instructions)

## Summary

Implemented the M7 configuration layer: zod v4 schemas for
`.opencode-ci/config.*` and `.opencode-ci/scenarios/*` (every object
`.strict()`), a fail-closed loader (`ConfigError` on any layout/schema
problem), a `scripts/gen-schema.ts` generator emitting `schema/config.json` +
`schema/scenario.json` via `z.toJSONSchema()`, and 35 new unit tests. All 10
fixture plugins' configs/scenarios parse unchanged (no fixture fixes needed).

## Files created

- `src/config/schema.ts` — `ConfigSchema` / `ScenarioSchema` /
  `MatcherSchema` (+ `Step`, `ToolCall`, `CountMatcher`, `ScenarioExpect`
  types via `z.infer`). Details:
  - Config: `plugin` (`path` [`.`], `options` [`{}`], optional
    `entry`/`install`/`build`/`ui`), `opencode.versions` ([`["2.0.26"]`],
    non-empty, semver-or-`"latest"`), `expect` (7 string arrays, each
    default `[]`), `live` (`keys`/`repeat` 3/`pass` 2/`budgetUSD`
    1/`timeoutMs` 240000), `gate` (`enabled`/`window` 5/`threshold`
    0.9/`bootstrap` `"fail"`), `logLevel` (`"info"`). Cross-field:
    `live.pass <= live.repeat` via `superRefine`.
  - Scenario: `id` (`/^[a-z0-9][a-z0-9-]*$/`), `mode`, `prompt` (min 1),
    `timeoutMs` [120000], `expect` (exitCode/noErrors/tools/noTools/hooks/
    request/files/stderr/text), optional `plugin.options`,
    `workspace`, `judgeReply`, `judge`. Cross-field: `script` required in
    scripted / forbidden in live, `expect.request` live-forbidden,
    `judge` live-only, `judgeReply` scripted-only. Every message names
    the scenario id and the field (e.g. `scenario "x": field "script"
    is required when mode is "scripted"`).
  - Matcher: `equals`/`contains`/`notContains` (unknown),
    `matches`/`notMatches` (string, `(?i)` accepted — stripping happens
    in M9 matchers, schema just validates the string), `includes`
    (string array), `exists` (boolean), `count` (`eq`/`gte`/`lte`);
    empty matcher rejected. `count` object shared with tool `count`.
  - Defaults use `.prefault()` (not `.default()`) for nested objects:
    zod v4 `.default()` returns the fallback as-is without running inner
    field defaults (verified empirically: `outer.parse({})` gave
    `{plugin:{}}` with `.default({})` vs `{plugin:{path:"."}}` with
    `.prefault({})`). Scalars keep `.default()`.
- `src/config/load.ts` — `loadConfig(cwd?)` (`{config, configPath?,
  warnings}`; both yaml+json present → `ConfigError`; neither → zod
  defaults + `console.warn` + `warnings` entry), `loadScenarios(cwd?)`
  (sorted `*.yaml/*.yml/*.json`, duplicate-`id` error naming id + both
  files), `loadAll(cwd?)`, `formatIssues()` (file path + one line per
  issue), `ConfigError`. YAML errors keep the file path plus the
  `line N` hint from `yaml`'s `linePos`/message.
- `scripts/gen-schema.ts` — `writeSchemas(outDir)` (`mkdir -p`, pretty
  JSON + trailing newline); runs as `bun scripts/gen-schema.ts [outDir]`
  via `import.meta.main`, defaulting to `<repo>/schema`.
- `schema/config.json`, `schema/scenario.json` — generated output,
  committed as files (uncommitted in git, per task constraints).
- `test/unit/config-schema.test.ts` — 18 tests: every default,
  unknown-key rejection at 6 levels (`expect.tool` typo, top-level,
  plugin, scenario, matcher, expect), all 6 cross-field rules (+ a
  valid live+judge case, pass==repeat boundary), `(?i)` acceptance,
  empty-matcher failure, id regex, workspace/plugin-options.
- `test/unit/config-load.test.ts` — 13 tests: yaml-vs-json precedence,
  missing-config defaults+warning, YAML parse error (path+line),
  bad-JSON + schema-violation file/field naming, JSON config parity,
  duplicate-id (id + both files), sorted yaml/yml/json loading,
  missing-dir → `[]`, plus a sweep loading all 10 fixture plugins and
  a shape check on `tool-basic-pass`.
- `test/unit/schema-sync.test.ts` — regenerates into a temp dir via
  `writeSchemas()` and byte-compares with the committed files.

## Test results

- `bun run check` — typecheck clean, biome clean (remaining 18 infos are
  pre-existing), **90 unit tests pass, 0 fail** (55 pre-existing + 35 new).
- `bun scripts/gen-schema.ts` regenerates `schema/*.json` deterministically;
  schema-sync test proves the committed copies are current.
- No fixture changes required: all 10 fixture plugins under
  `test/fixtures/plugins/` load through `loadAll()` unchanged.

## Self-audit notes

- **Fail-closed:** every loader failure path throws `ConfigError`
  (both-configs, bad YAML/JSON, zod violation, duplicate id); no
  permissive fallbacks. Missing config is the only non-throwing case and
  it warns explicitly.
- **Strictness:** all 13 object schemas are `.strict()`; the typo test
  (`expect: {tool: [...]}`) fails as required.
- **Deviations from the M7 reference:** (1) `.prefault()` instead of
  `.default()` for nested-object fallbacks (zod v4 semantics — see above;
  behavior matches the spec's defaults exactly); (2) `writeSchemas()`
  takes an explicit `outDir` (default `schema/`) so the sync test can
  target a temp dir without subprocesses; (3) `judgeReply` live-forbidden
  check added (spec says "scripted only", implied but not listed in the
  cross-field bullets); (4) biome autofixes applied (import sorting,
  `import type { z }`); (5) no commits (per task constraints).
- **Not done (out of scope for M7):** `validate`/`run` CLI wiring (M10+);
  `(?i)` runtime handling (M9 matchers); exit-code-2 mapping (CLI layer).
