# M13 Implementation Report — Composite Action and docs

- **Stage ID:** M13 (`action.yml`, `examples/workflow.yml`, `README.md`,
  `.github/workflows/ci.yml`, `docs/NOTES.md`)
- **Date:** 2026-10-17
- **Branch:** `impl/v1` (not committed, per task instructions)

## Summary

Implemented the M13 packaging surface: a composite GitHub Action that sets
up Bun/Node, installs the tool with `--frozen-lockfile`, and runs the CLI
with inputs passed through `env:` (never interpolated); an
`artifact-name` input (default `opencode-plugin-ci-results`); an example
consumer workflow per SPEC §8; a full README rewrite (quickstart, config
reference, per-assertion-type scenario reference, Code Mode, tiers, gate,
security); and a repo CI workflow (`bun run check` + pinned-opencode
`bun run test:e2e`). Gate wiring needed no code changes: `gate.artifact`
already flows from schema default through `runGate` into `fetchHistory`'s
`gh run download --name`. Acceptance verified: `bun run check` green,
`actionlint` passes on both workflow files, and the README quickstart
followed literally in a fresh temp copy of `tool-basic` exits 0 with a
passing report.

## Files created

- `action.yml` — composite action exactly per M13 spec (`name`,
  `description`, `branding`, inputs `tiers`/`opencode-versions`/
  `working-directory`/`upload-artifact` **plus `artifact-name`** defaulting
  to `opencode-plugin-ci-results`, outputs `result`/`report-path`), plus the
  required `bun install --frozen-lockfile` step in
  `${{ github.action_path }}` before the run step. The run script takes
  `IN_TIERS`/`IN_VERSIONS`/`ACTION_PATH` via `env:`; `--out
  .opencode-ci/out` is relative to the `working-directory` step cwd; the
  upload step uses `name: ${{ inputs.artifact-name }}` with
  `if-no-files-found: ignore`.
- `examples/workflow.yml` — consumer workflow from SPEC §8 (`push` + `pull
  request`, `permissions: contents: read, actions: read` for gate history,
  `Heretek-AI/opencode-v2-plugin-teser@v1` with `tiers:
  load,scripted,live`, `OPENCODE_API_KEY` from secrets).
- `.github/workflows/ci.yml` — this repo's CI: `check` job (`bun install
  --frozen-lockfile`, `bun run check`) on every push/PR, plus an `e2e` job
  installing `@opencode/cli@2.0.26` into `$RUNNER_TEMP/oc` and running `bun
  run test:e2e` with `OPENCODE_BIN` set to it.

## Files modified

- `README.md` — rewritten with all M13-required sections: what it does;
  5-min quickstart (`init --force`, edit, `validate`,
  `run --scenario example`); config reference linking
  `schema/config.json`; scenario reference with one example per assertion
  type (`exitCode`, `noErrors`, `tools`, `noTools`, `hooks`, `request`,
  `files`, `stderr`, `text`); "Your tools are in Code Mode" (stub
  auto-wrap, live models call `execute`, probe-based assertions,
  `codemode: false` opt-out); tiers table + run filters + TUI-only/allowed
  failure/bun-test notes; gate (stable-case rule, acks, history via `gh`,
  run conditions, fallback, bootstrap) **including the matrix instruction
  (distinct `artifact-name` per leg + same value in that leg's
  `gate.artifact`)**; Action inputs/outputs + minimal workflow; security
  (never `pull_request_target` with PR code + secrets; live runs plugin
  code with the real key).
- `docs/NOTES.md` — M13 section: actionlint scope (composite actions are
  not workflows), gate.artifact wiring verification, quickstart
  verification details (local-bin substitution for unpublished `bunx`,
  `--force` and `--scenario example` rationale).

## Files verified, not changed

- `src/config/schema.ts` — `gate.artifact` already exists with the
  required default (`opencode-plugin-ci-results`); no regen needed.
- `src/gate/history.ts` / `src/gate/gate.ts` — `fetchHistory` takes the
  artifact name and `runGate` already passes `config.gate.artifact`, so
  matrix legs downloading by a distinct name work with no code changes.

## Test results

- `bun run check`: green — typecheck + `biome check` (one pre-existing
  `biome.json` deprecation info, untouched) + **213 unit tests pass, 0
  fail** across 17 files.
- `actionlint` 1.7.12 on `.github/workflows/ci.yml` and
  `examples/workflow.yml`: exit 0, no findings. (`action.yml` is a
  composite action, not a workflow, so actionlint's workflow parser does
  not apply; it was hand-checked against the spec instead. See NOTES.md.)
- README quickstart, followed literally in a fresh `/tmp` copy of
  `test/fixtures/plugins/tool-basic` (`bun <repo>/bin/opencode-plugin-ci.ts`
  substituted for unpublished `bunx`, `OPENCODE_BIN` set to the pinned dev
  binary): `init --force` → exit 0; `validate` → exit 0 (server entry
  resolved); `run --scenario example` → **exit 0**, report shows 2 passed
  / 0 failed (`load` + `example`).

## Self-audit notes

- No `${{ inputs.* }}` interpolation inside any `run:` script; the upload
  step's `with:`/`if:` interpolation is outside script context and safe.
- `git status` shows exactly the M13 surface: `M README.md`,
  `M docs/NOTES.md`, `?? action.yml`, `?? .github/`,
  `?? examples/workflow.yml`, plus this report. Nothing committed, per
  instructions. (This report itself is a new file under `docs/reports/`.)
- Known limitation: `bunx @heretek-ai/opencode-plugin-ci` only resolves
  once the package is published; until then local users run
  `bun bin/opencode-plugin-ci.ts`. Noted in NOTES.md, not papered over.
- `docs/reports/` has no `m13` file convention conflict: prior reports are
  named `m<NN>-implementation.md`; this file follows it.
