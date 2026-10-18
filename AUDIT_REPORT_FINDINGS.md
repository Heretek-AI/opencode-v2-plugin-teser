# AUDIT_REPORT_FINDINGS: opencode-v2-plugin-teser

## Baseline

- Commit: `af6675cc17e994faf4b9c8df3f386a65097fb489`
- Commit date: `2026-10-17 20:34:47 -0400` (`Merge pull request #4 from Heretek-AI/impl/v1`)
- Audit date (UTC): `2026-10-18T02:00:34Z`
- Tools: bun 1.4.2, node v26.10.0, npm 11.19.1, git 2.56.0, gh 2.97.0 (authed BillyOutlast), jq-1.8.2, rg 15.1.0, curl 8.22.0, opencode v2.0.32 system; fresh 2.0.26 + head 2.0.32 in $AUDIT_TMP; `npm view @opencode/cli version → 2.0.32`
- Host: Linux; loopback-only stub; isolated HOME/XDG per sandbox; `gh auth status` authed
- `git status --porcelain` at start: only `?? PROMPT_ADVERSARIAL_FLEET_AUDIT.md`
- AUDIT_TMP=/tmp/opencode-v2-plugin-teser-audit-psbwq9; wt=/tmp/opencode-v2-plugin-teser-audit-psbwq9/wt (detached af6675c)
- Previous report: none (First run)
- Fresh binaries used: `$AUDIT_TMP/oc-2.0.26` (`opencode v2.0.26`), `$AUDIT_TMP/oc-head` (`opencode v2.0.32`); repo `review/oc` (2.0.26) used only for comparison, never as proof
- Critical host factor: stray `/tmp/opencode.json` listing `plugins: ["@heretek-ai/opencode-rea","@aerovato/operator-opencode-v2@latest"]`; opencode v2 walks up from cwd and merges ancestor `opencode.json(c)` files. Polluted runs under default TMPDIR failed spuriously; clean runs used `TMPDIR=/dev/shm/ocz` (ancestors `/dev/shm`,`/dev`,`/` contain no `opencode.json`) without touching any user file. See OCI-4.4-ancestor.
- Checks that could not run here and why: live tier against a real model with a real key (refusal boundary — only skip path + `OPENCODE_PLUGIN_CI_JUDGE_VIA_STUB=1` stub paths exercised, with throwaway dummy key never sent to a real provider); Windows drive-letter shim paths and `cmd /c` install branch (Linux host only); `pull_request_target` with live secrets (forbidden by hard limits — PoC used throwaway `sk-test-*` dummies, stub model, loopback only); real GitHub Actions runner execution of `working-directory: ../` and same-name matrix artifact collision (no GitHub writes allowed — inferred from runner semantics + code + docs); head-install runtime behavior beyond Alpha's 10-fixture matrix (Beta/Gamma deferred to Alpha); full `bun run test:e2e` green baseline in one shot in Gamma scope (deferred to Alpha; equivalent fixture-by-fixture CLI coverage achieved).

## Verdict

`opencode-v2-plugin-teser` does what it is supposed to be: load, scripted (stub, zero tokens), and live-skip tiers reproduce identically at pinned 2.0.26 and head 2.0.32 across all 10 fixtures, the probe inventory/hook-order/request/catalog surfaces behave as claimed, judge isolation and budget skip paths are real, and packaging/verbatim-port/schema-sync claims hold except where noted. The gaps are coverage and containment, not wholesale breakage: 4 untested invariants survived sabotage, ancestor configs leak into the "isolated" sandbox, workspace writes escape, and secrets persist outside env/headers. The single most important fix is ancestor neutralization + allow-list: after each run assert the merged plugin set equals the configured set (`[pre, shimmed plugin, post]` plus shim) and fail tier 1 closed on extras, and contain sandbox roots against walk-up `opencode.json(c)` discovery.

## Prioritized Defect Matrix

| ID | Priority | Claim | Location | Summary |
|---|---|---|---|---|
| OCI-4.4-ancestor | P1 | 4.4 sandbox isolation | `src/sandbox/sandbox.ts:92-95` | Ancestor `opencode.json` merged into sandbox; foreign npm plugins installed/executed; determinism + key-exfil path |
| OCI-1.5-skip | P1 | 1.5 tier-1-fail skips tiers 2-3 | `src/run.ts:248-261` | Cascade `skipped: "tier 1 failed"` has zero test coverage; sabotage green |
| OCI-6.4-unpublished | P1 | 6.4 npm packaging / bunx path | `package.json:1-2` | Package never published; README `bunx` quickstart and `$schema` URLs 404 |
| OCI-6.3-action-guard | P1 | 6.3 zero-interpolation invariant | `action.yml:40-51` | Current file clean but no automated guard; interpolation regression would be silent |
| OCI-6.4-files-guard | P1 | 6.4 published `files` list | `package.json:17-26` | Dropping `probe` from `files` ships a tarball that fails every tier; no test pins `files`/`bin` |
| OCI-7.3-redact-untested | P1 | 7.3 redact regex | `probe/core.js:3` | SECRET_KEY superset has zero tests; narrowing/breaking it stays green |
| OCI-7.3-evidence-leaks | P1 | 7.3 noEvents never embeds secrets | `probe/core.js:69-145` | Only env/headers redacted; prompt/tool I/O/system/stub/events/report embed secrets verbatim |
| OCI-4.4-workspace-escape | P1 | sandbox workspace containment | `src/sandbox/sandbox.ts:108-112` | `join(project,rel)` with no check; `../` escapes projectDir, `../../` escapes sandbox root to /tmp |
| OCI-3.3-meta | P2 | 3.3 probe metadata-last | `probe/core.js:61-65` | Metadata-last ordering untested; payload-spread-last sabotage green (merged Gamma duplicate) |
| OCI-4.3-order | P2 | 4.3 plugin order `[pre,plugin,post]` | `src/tiers/load.ts:88-92` | `load.ts` copy unpinned; swap sabotage green; scripted copy IS pinned |
| OCI-2.5-noerrors | P2 | 2.5 `noErrors` defaults true | `src/assert/expect.ts:381` | `?? true` fallback unpinned; prod default is schema-pinned, fallback is dead-layer only |
| OCI-1.4-cap | P2 | 1.4 inventory expectations | `probe/core.js:15-17` | 200-item array cap truncates tier-1 inventory; false failures over 200 tools |
| OCI-1.4-providers | P2 | 1.4 providers/models | `src/tiers/load.ts:20-26,160-166` | `expect.providers/models` accepted but silently ignored; README contradicts behavior |
| OCI-6.1-allowed-wiring | P2 | 6.1 required/allowed wiring | `src/run.ts:191-192` | `allowedVersions` wiring unpinned; only report labels affected (fail-closed), not exit codes |
| OCI-5.6-inert-window | P2 | 5.6 inert window/threshold | `src/gate/gate.ts:294-311` | `gate.window/threshold` accepted but never read; README over-promises tuning |
| OCI-2.5-files-symlink | P2 | 2.5 files `..` containment | `src/assert/expect.ts:318-370` | Lexical `..`/absolute rejected but symlinks followed out of projectDir |
| OCI-6.4-action-pins | P2 | 6.4/7.2 CI pins | `action.yml:30-31,58` | `checkout/setup-node/upload-artifact@v4` float on superseded majors while v7 exists |
| OCI-7.1-no-line | P3 | 7.1 strict schemas | `src/config/load.ts:31-39` | Errors name file+field, not line; claim says "file path + line" |
| OCI-registry-drift | P3 | registry truth / drift | `src/opencode/binary.ts:79` | Pinned 2.0.26 is 6 releases behind head 2.0.32; drift purely additive; `latest` floats per run |
| OCI-6.3-working-dir | P3 | 6.3 working-directory | `action.yml:39,61` | `working-directory`/artifact path unconstrained; `../` escapes workspace (author-error only) |
| OCI-7.2-floating-majors | P3 | 7.2/6.3 floating majors hygiene | `action.yml:30-31,58` | Same floating `@v2/@v4` as OCI-6.4-action-pins; GitHub-endorsed pattern, SHA-pinning is hygiene |
| OCI-6.2-artifact-poisoning | P3 | 6.2 gate history artifact | `action.yml:17-18` | Default artifact name shared across matrix legs collides unless author overrides per README |

## Findings

### OCI-4.4-ancestor: ancestor `opencode.json` is merged into the "isolated" sandbox
- **Priority:** P1
- **Claim:** 4.4 (binary resolution + sandbox env isolation) + SPEC 3.1 ("Nothing touches the user's real opencode setup" — reverse direction equally unguarded)
- **Location:** `src/sandbox/sandbox.ts:92-95` (`root = join(tmpdir(), ...)` — no ancestor neutralization)
- **Proof:** from repo root with default TMPDIR (pinned 2.0.26 fresh binary):
```bash
cd test/fixtures/plugins/tool-basic
OPENCODE_BIN=$AUDIT_TMP/oc-2.0.26/bin/opencode bun $REPO/bin/opencode-plugin-ci.ts run --tier load --scenario tool-basic-pass --opencode 2.0.26 --out $AUDIT_TMP/out-basic-pass-2026
# control:
TMPDIR=/dev/shm/ocz OPENCODE_BIN=$AUDIT_TMP/oc-2.0.26/bin/opencode bun $REPO/bin/opencode-plugin-ci.ts run --tier load --scenario tool-basic-pass --opencode 2.0.26 --out $AUDIT_TMP/out-clean-pass
```
- **Raw output:**
```
# polluted (default TMPDIR, /tmp/opencode.json present):
tier 1 FAILED with `expected tool "echo_tool" not in inventory tools [rea_address_name, ...200 rea_* tools...]`
probe.jsonl inventory shows active foreign plugins `rea@... (@heretek-ai/opencode-rea)` and `aerovato.operator-memory (@aerovato/operator-opencode-v2@latest)`
stderr.log shows `msg="loading plugin" id=@heretek-ai/opencode-rea entrypoint=file:///tmp/opencode-plugin-ci-*/cache/opencode/npm/...`
# clean (TMPDIR=/dev/shm/ocz): same command PASSED
# polluted N tools: 200, HAS echo_tool: False; clean N tools: 63, echo_tool present
```
- **Why it matters:** Identical checkout gives different results depending on stray ancestor configs, breaking "identically on laptop and CI" (observed cost ~1.8s → ~17s plus false tier-1 failures, and the repo's own e2e inherits the fragility via `tmpdir()`). Ancestor-listed npm plugins are installed (`@latest`) and executed with the sandbox env — in the live tier that env carries real API keys, so any local writer of an ancestor dir can inject key-exfiltrating code.
- **Remediation:** fail-closed allow-list in `runLoad`/`runScenario`: after each run compare `ctx.plugin.list()` ids in the probe inventory against expected (probes + shim) and fail tier 1 on extras; snapshot `/tmp`-style ancestors and refuse/warn when any `opencode.json(c)` exists between sandbox root and filesystem root; ask upstream for `OPENCODE_NO_PROJECT_CONFIG=1` support. Implement (1) today in `runLoad`.
- **Verify the fix:** re-run the Proof command with a planted `$TMPDIR-ancestor/opencode.json` listing a bogus plugin → tier 1 must fail closed (or the file must be provably ignored).
- **Cross-examination:** Beta challenged (reproduced polluted-vs-clean pair on same host, verified `/tmp/opencode.json` is a genuine user file not an audit plant, verified upstream walk-up discovery in `review/opencode/.../config/discovery.ts` + `fs.up` walk, verified `opencode run --help` on 2.0.26 and head shows no neutralizing flag). Verdict: STANDS P1 (P0 considered for live-keys + `@latest` auto-install but rejected — exploit needs local ancestor-dir write, outside threat model).

### OCI-1.5-skip: tier-1-failure cascade skip has zero test coverage
- **Priority:** P1
- **Claim:** 1.5 — a failing tier 1 skips tiers 2 and 3 for that version (`skipped: "tier 1 failed"`)
- **Location:** `src/run.ts:248-261` (`if (!tier1Pass) { ... results.push(skippedForTier1(...)); continue; }`)
- **Proof:** in `$AUDIT_TMP/wt`, one-line never-skip sabotage, then from wt root:
```bash
# sabotage: `if (!tier1Pass) {` → `if (!tier1Pass && tier1Pass) {` (biome+tsc clean)
bun run check
OPENCODE_BIN=$AUDIT_TMP/oc-2.0.26/bin/opencode TMPDIR=/dev/shm/ocz bun test ./test/e2e/cli.test.ts --timeout 600000
```
- **Raw output:**
```
Ran 213 tests ... 0 fail (exit 0)
cli.test.ts: 4 pass, 0 fail (the `run in throws exits 1` case still exits 1 via required load failure — never inspects results.json for skipped entries)
```
- **Why it matters:** If the cascade regresses, a tier-1 root cause is buried under N tier-2/3 failures; worse, live scenarios would burn real `live.budgetUSD` on doomed attempts after a tier-1 failure.
- **Remediation:** extract the cascade into a pure `skippedAfterTier1(...)` helper asserting entries + `continue` semantics, plus extend `test/e2e/cli.test.ts` "run in throws" to assert `results.json` contains `throws-smoke` with `skipped: "tier 1 failed"`.
- **Verify the fix:** re-run the sabotage → `bun run check` must go red.
- **Cross-examination:** Beta challenged (re-ran S4c in wt — biome-clean, 213 pass; read `test/e2e/cli.test.ts:52-55` — asserts only exit code; `grep -rn "tier 1 failed" src test` → only definition in `src/run.ts:130-139`). Verdict: STANDS P1.

### OCI-6.4-unpublished: package never published — README `bunx` path and `$schema` URLs both 404
- **Priority:** P1
- **Claim:** 6.4 (npm packaging / `bunx @heretek-ai/opencode-plugin-ci` distribution path); also README `$schema` URLs and 7.2 quickstart reproducibility
- **Location:** `package.json:1-2` (name/version 0.1.0, unpublished), `README.md:36,48,66,161`
- **Proof:** from repo root:
```bash
npm view @heretek-ai/opencode-plugin-ci versions --json
curl -sL -o /dev/null -w "HTTP:%{http_code}\n" https://unpkg.com/@heretek-ai/opencode-plugin-ci/schema/config.json
```
- **Raw output:**
```
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@heretek-ai%2fopencode-plugin-ci - Not found
HTTP:404 ... Package not found: @heretek-ai/opencode-plugin-ci
```
- **Why it matters:** The documented primary install path (`bunx @heretek-ai/opencode-plugin-ci init --force`, README:36,:48) fails verbatim for every user today; the `$schema` comment README tells users to paste (README:66) resolves to a 404 so editor schema assistance is dead.
- **Remediation:** publish 0.1.0 (or prerelease tag) and re-run verify; until then README quickstart must show the source-substitution form (`bun <checkout>/bin/opencode-plugin-ci.ts`) instead of `bunx`.
- **Verify the fix:**
```bash
npm view @heretek-ai/opencode-plugin-ci version | grep -q 0.1.0 && diff <(curl -sL https://unpkg.com/@heretek-ai/opencode-plugin-ci/schema/config.json) schema/config.json && echo PUBLISHED-IN-SYNC
```
- **Cross-examination:** Gamma challenged (re-ran E404 + unpkg 404; stronger ground: `docs/NOTES.md:270` admits "requires the package to be published, which it is not yet", and `grep -rn "npm publish" .github/ package.json` is empty so no publish automation exists; Beta's E403/E401 disambiguator is wrong — npm returns 404 for inaccessible private scopes too — but immaterial). Verdict: STANDS P1.

### OCI-6.3-action-guard: zero-interpolation invariant in action.yml has no automated guard
- **Priority:** P1
- **Claim:** 6.3 ("zero actions-expression interpolation of inputs inside any action.yml `run:` script")
- **Location:** `action.yml:40-51` (env block `IN_TIERS`/`IN_VERSIONS`/`ACTION_PATH` + `run:` script using only `$IN_*`/`$ACTION_PATH`/`$GITHUB_OUTPUT`)
- **Proof:** in `$AUDIT_TMP/wt`, sabotage `IN_TIERS: ${{ inputs.tiers }}` passthrough dropped + `# ${{ inputs.tiers }}` injected into `run:` script, then from wt root:
```bash
bun run check
rg -ln "action.yml" test/
grep -c actionlint .github/workflows/ci.yml || true
```
- **Raw output:**
```
213 pass / 0 fail (exit 0)
rg: no test file references action.yml; ci.yml has no actionlint step
```
- **Why it matters:** The no-interpolation property is the Action's command-injection boundary; a future edit interpolating `${{ inputs.tiers }}` into the script would be a silent security regression with no red test. The file itself is currently clean — the guard is what's missing.
- **Remediation:** add a unit test reading `action.yml`, extracting every `run:` block, asserting it contains no `${{ inputs.` / `${{ github.` expression (allow-listing `${{ github.action_path }}` only in `working-directory:`/`env:` properties, never in `run:`); or add an actionlint + expression-grep step to `ci.yml`.
- **Verify the fix:** re-apply the sabotage edit → new test/step must fail; `bun run check` green on fixed tree.
- **Cross-examination:** Gamma challenged (re-read action.yml:27-62 — `${{ }}` appears only in `working-directory:`/`env:`/`with:`/`if:` standard safe positions; `run:` body uses only shell vars; sabotage was two edits not one-line and comment-position injection is bash-inert without newline breakout — proves guard-absence not exploitability). Verdict: STANDS P1 (security-boundary invariant with zero guard).

### OCI-6.4-files-guard: published `files` list (notably `probe/`) has no automated guard
- **Priority:** P1
- **Claim:** 6.4 ("npm packaging ships exactly `bin, src, probe, schema, examples, README.md, LICENSE, NOTICE`")
- **Location:** `package.json:17-26` (`files` array)
- **Proof:** in `$AUDIT_TMP/wt`, remove `"probe"` from `files`, then from wt root:
```bash
bun run check
npm pack --dry-run 2>&1 | grep -c "probe/core.js" || true
```
- **Raw output:**
```
213 pass / 0 fail
sabotaged tree ships 0 probe/core.js (vs intact tree ships probe/core.js + probe/pre/server.js)
```
- **Why it matters:** `probe/` is load-bearing at runtime (sandbox `plugins` array points at it); dropping it from `files` produces a published tarball that fails every tier with a confusing plugin-load error, caught by no test. Same for `bin`/`schema`.
- **Remediation:** extend `test/unit/schema-sync.test.ts` (or new `packaging.test.ts`) to assert `package.json` `files` deep-equals the documented set and `bin` maps `opencode-plugin-ci`, and/or run `npm pack --dry-run` in CI asserting the tarball contains `probe/core.js`, `probe/pre/server.js`, `probe/post/server.js`, `schema/config.json`, `bin/opencode-plugin-ci.ts`.
- **Verify the fix:** re-drop `"probe"` from `files` → new test must fail; `npm pack --dry-run | grep probe/core.js` must succeed on fixed tree.
- **Cross-examination:** Gamma challenged (re-ran drop-`probe` → 0 `probe/core.js` shipped; verified intact tree ships 45 files incl. probe; verified `probePluginDirs()` in `src/probe/read.ts:164-168` feeds sandbox plugins in `src/tiers/load.ts:83-91`; verified no unit asserts `files`/`bin`). Verdict: STANDS P1.

### OCI-7.3-redact-untested: probe SECRET_KEY regex has zero test coverage
- **Priority:** P1 (downgraded from P0 by cross-examination; fact stands, severity corrected)
- **Claim:** 7.3 (probe redacts `/KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE/i`)
- **Location:** `probe/core.js:3`
- **Proof:** in `$AUDIT_TMP/wt`:
```bash
cd /tmp/opencode-v2-plugin-teser-audit-psbwq9/wt
# replace SECRET_KEY with /KEY|TOKEN|SECRET|PASSWORD/i, then with /KEY/i
bun run check 2>&1 | tail -5
bun test ./test/unit 2>&1 | tail -8
git checkout -- probe/core.js
rg -n 'probe/core|redactEnv|SECRET_KEY' test/unit test/e2e
```
- **Raw output:**
```
# narrow to spec-four:
213 pass, 0 fail, 1 snapshots, 469 expect() calls — suite GREEN (should be red)
# break to /KEY/ only:
213 pass, 0 fail — suite GREEN (should be red)
# coverage check:
(no output — zero references to probe/core.js, redactEnv, or SECRET_KEY in test/)
```
- **Why it matters:** The redact regex is the single security boundary between live keys (shell env + model headers) and persisted/uploaded evidence. An accidental narrowing or typo ships silently; AUTH/COOKIE bearer tokens then persist in `probe.jsonl` artifacts.
- **Remediation:** add a unit test importing `probe/core.js:makeProbe`, feeding env/headers with every alternative (`KEY, TOKEN, SECRET, PASSWORD, AUTH, COOKIE`, mixed case) plus canary values, asserting `[redacted]` in output and absence of canaries. Fail-closed: assert each alternative individually, not just one.
- **Verify the fix:** re-apply the narrow sabotage; the new test must fail (suite red); restore and suite green.
- **Cross-examination:** Alpha challenged (re-ran narrowing to `/KEY/i` → 213 pass; confirmed zero `test/` references; confirmed Gamma's own logs prove the boundary FUNCTIONS including AUTH/COOKIE; priority definitions reserve P0 for a bypassable boundary and assign sabotage-survived to P1; SPEC 3.3 promises only four alternatives so narrowing to spec-four would not even violate SPEC). Verdict: fact STANDS, DOWNGRADED P0→P1.

### OCI-7.3-evidence-leaks: only env/headers are redacted — prompt/tool I/O/system/stub/events/report embed secrets verbatim
- **Priority:** P1
- **Claim:** 7.3 ("noEvents evidence (`events.jsonl`, `probe.jsonl`, `stub-requests.jsonl`, `stderr.log`) never embeds secrets")
- **Location:** `probe/core.js:69-145` (only `shell.before.env` via `redactEnv` and `session.model.request.headers` via `redactEnv`; no redaction on `tool.before.input`, `tool.after.result`, `session.prompt.prompt`, `session.context.system/tools`), `src/stub/stub.ts:279-282` (recordFile writes full `body`), `src/opencode/events.ts` (no redaction), `src/assert/matchers.ts:show()` (failure `got` includes secret, truncated only), `src/report/markdown.ts` + `appendStepSummary`
- **Proof:** from repo root:
```bash
bun -e 'import { makeProbe } from "./probe/core.js"; /* feed env canaries + tool input/output + prompt; read probe.jsonl */'
bun -e 'import { startStub } from "./src/stub/stub.ts"; /* POST body with "system sk-test-SYSTEM-SECRET"; cat recordFile */'
rg -n 'redact|SECRET|KEY|TOKEN' src/report/*.ts src/opencode/*.ts src/tiers/*.ts src/assert/*.ts
```
- **Raw output:**
```
{"env":{"API_KEY":"[redacted]","MY_TOKEN":"[redacted]","MY_SECRET":"[redacted]","MY_PASSWORD":"[redacted]","MY_AUTH":"[redacted]","MY_COOKIE":"[redacted]",...},"phase":"post",...,"kind":"shell.before"}
{"headers":{"Authorization":"[redacted]",...},"kind":"session.model.request"}
{"tool":"shell","callID":"1","input":{"command":"cat .env sk-test-API_KEY-123"},...,"kind":"tool.before"}
{"tool":"shell","callID":"1",...,"result":{"content":"sk-test-output-secret"},...,"kind":"tool.after"}
{"prompt":"print sk-test-prompt-secret",...,"kind":"session.prompt"}
sk-test-output-secret LEAKED (probe does NOT redact tool I/O)
sk-test-prompt-secret LEAKED (probe does NOT redact prompt)
{"kind":"primary",...,"body":{"messages":[{"content":"system sk-test-SYSTEM-SECRET"},...]}} 
sk-test-SYSTEM-SECRET LEAKED in stub-requests (no redaction)
```
- **Why it matters:** Any scenario whose prompt/workspace/tool output contains a real secret (easy mistake: `cat .env`) persists it into `probe.jsonl`, `stub-requests.jsonl`, `events.jsonl`, and via assertion failures into `report.md` + `$GITHUB_STEP_SUMMARY`, all uploaded as `opencode-plugin-ci-results` artifacts.
- **Remediation:** narrow claim 7.3 to "env/header values redacted; all other evidence surfaces MUST NOT contain secrets (author responsibility)" AND either (a) add value-side scrubbing of live key values in `report.md`/failures/`stub-requests` writes, or (b) fail validation when `expect.*` matchers contain `sk-`-like literals and warn when workspace/prompt contains live key values.
- **Verify the fix:** re-run corpus with dummy canaries in prompt/tool output; after fix canaries must be absent from `probe.jsonl`/`stub-requests.jsonl`/events tail/`report.md`, while env/header tests still pass.
- **Cross-examination:** Alpha challenged (scope overreach — README:328-330 already assigns non-env surfaces to author responsibility; challenge FAILS because audited claim text as written says "never embeds secrets" which is false, and automatic artifact upload converts an author slip into secret distribution). Verdict: STANDS P1.

### OCI-4.4-workspace-escape: scenario workspace writes escape projectDir AND sandbox root
- **Priority:** P1
- **Claim:** sandbox isolation (SPEC 3.1, workspace is "files written into the project dir") + 7.3 "treat workspace files as untrusted input"; prompt task 4 (confirm rejection or containment)
- **Location:** `src/sandbox/sandbox.ts:108-112`
```ts
for (const [rel, content] of Object.entries(opts.workspace ?? {})) {
  const dest = join(this.project, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}
```
- **Proof:** from repo root:
```bash
bun -e 'import { Sandbox } from "./src/sandbox/sandbox.ts"; const s = new Sandbox({ opencodeBin: "/nonexistent/opencode", workspace: { "../escape.txt": "pwned", "sub/../../escape2.txt": "pwn2" } });'
bun -e 'import { Sandbox } from "./src/sandbox/sandbox.ts"; const s = new Sandbox({ opencodeBin: "/nonexistent/opencode", workspace: { ["../../gamma-escape-"+Date.now()+".txt"]: "PWNED-OUTSIDE-SANDBOX" } });'
rg -n 'resolve|startsWith|escapes|sep' src/sandbox/sandbox.ts
```
- **Raw output:**
```
project /tmp/opencode-plugin-ci-.../project
project listing: [ ".git", "ok.txt", "tmp", "README.md" ]
parent listing has escape.txt? YES ESCAPED
root parent: [ "gitconfig", "escape2.txt", "escape.txt", ... ]
dest /tmp/gamma-escape-....txt
/tmp marker exists? YES ESCAPED SANDBOX ROOT: PWNED-OUTSIDE-SANDBOX
rg: no containment check
```
- **Why it matters:** Workspace comes from `.opencode-ci/scenarios/*` in the PR checkout — attacker-controlled in the fork-PR threat model. A malicious scenario can write outside its project dir into the sandbox root and shared `/tmp`, enabling cross-scenario poisoning and runner pollution. `files:` assertions ARE contained but writes are not — asymmetric.
- **Remediation:** mirror `evaluateFiles`: `const dest=resolve(project, rel); if (dest!==project && !dest.startsWith(project+sep)) throw ConfigError(...)` before mkdir/write. Reject absolute paths explicitly.
- **Verify the fix:** re-run escape corpus; `../` and `../../` entries must throw/exit 2, `ok.txt` still written, suite green.
- **Cross-examination:** Alpha challenged (`join` contains absolutes by accident so no absolute escape; attacker already has code exec via install/build/setup so escape adds nothing; challenge FAILS on `..` — `join(project,"../escape.txt")` genuinely escapes, zero containment checks vs `evaluateFiles` which HAS them, task 4 explicitly in scope, fail-open is P1 per definitions). Verdict: STANDS P1.

### OCI-3.3-meta: probe metadata-last ordering untested (merged Gamma duplicate)
- **Priority:** P2 (downgraded from P1 by cross-examination; Gamma OCI-probe-spoof-untested merged here)
- **Claim:** 3.3 — the probe writes metadata LAST (`{ ...clip(snapshot(data), 0, max), phase, seq, t, kind }`) after a deep-copy snapshot, so a payload field can never overwrite `kind`/`phase`
- **Location:** `probe/core.js:61-65`
- **Proof:** in `$AUDIT_TMP/wt`, swap to payload-wins `{ phase, seq, t, kind, ...clip(snapshot(data)) }`, then from wt root:
```bash
bun run check
bun test ./test/e2e/tier2.test.ts --timeout 600000
```
- **Raw output:**
```
check 0 fail (213 tests); tier2 e2e green
No test crafts a payload with colliding kind/phase keys
Gamma re-run: `bun test ./test/unit` → 213 pass, 0 fail (GREEN, should be red)
```
- **Why it matters:** Today no call site passes colliding top-level keys, so blast radius is defense-in-depth only; but the [S] invariant ("a payload field can never overwrite kind/phase") is asserted by nothing — a future probe record with a `kind` field would silently corrupt the evidence stream.
- **Remediation:** unit test importing `probe/core.js` `makeProbe` writing a record whose data contains `{kind:"forged",phase:"forged",seq:999}` and asserting the parsed line keeps `kind`/`phase`/`seq` from metadata.
- **Verify the fix:** re-run swap sabotage → new test goes red.
- **Cross-examination:** Beta challenged (enumerated all 9 `write()` call sites — data keys never include `kind`/`phase`/`seq`/`t`; collision unreachable by construction; ordering is hardening with zero current blast radius). Alpha confirmed (all 8 `write()` sites use fixed top-level keys; attacker-influenced values are always NESTED; identical top-level under either spread order). Verdict: fact STANDS, DOWNGRADED P1→P2; Gamma duplicate merged here.

### OCI-4.3-order: `load.ts` plugin order unpinned
- **Priority:** P2 (downgraded from P1 by cross-examination)
- **Claim:** 4.3 — every sandbox is `[pre, shimmed plugin, post]` and hooks fire in config-`plugins` array order
- **Location:** `src/tiers/load.ts:88-92`
- **Proof:** in `$AUDIT_TMP/wt`, swap to `[post, shim, pre]`, then from wt root:
```bash
bun run check
bun test ./test/e2e/probe.test.ts --timeout 600000
```
- **Raw output:**
```
check 0 fail; probe.test.ts green (0 fail, 18 expect() calls) — builds its OWN [pre,plugin,post] sandbox, never exercises runLoad's order
```
- **Why it matters:** A load-order regression silently inverts pre/post attribution for tier-1 evidence; the scripted copy IS pinned (`hook-mutate-pass` e2e), only the load copy is free-floating — the two can drift apart unnoticed. Tier-1 verdicts consume only inventory+logs, so no verdict changes today.
- **Remediation:** extend `test/e2e/tier1.test.ts` (or probe.test.ts) with a `runLoad`-level hook-order assertion, e.g. run tier 1 on `hook-mutate` and assert `probe.jsonl` pre/post `tool.before` inputs differ as expected.
- **Verify the fix:** re-run swap sabotage → e2e goes red.
- **Cross-examination:** Beta challenged (tier-1 verdicts consume only inventory+logs in `src/tiers/load.ts:119-175`; nothing in tier 1 reads hook pre/post records, so swapped load order changes no verdict; verdict-affecting scripted copy IS pinned). Verdict: STANDS, DOWNGRADED P1→P2.

### OCI-2.5-noerrors: `noErrors` default-true unpinned
- **Priority:** P2 (downgraded from P1 by cross-examination)
- **Claim:** 2.5 — `noErrors` defaults to `true` (any `error` event fails the scenario)
- **Location:** `src/assert/expect.ts:381` (`expect.noErrors ?? true`)
- **Proof:** in `$AUDIT_TMP/wt`, `?? true` → `?? false`, then from wt root:
```bash
bun run check
bun test ./test/e2e/tier2.test.ts --timeout 600000
```
- **Raw output:**
```
check 0 fail (all unit noErrors cases set it explicitly); tier2 e2e green (no fixture emits error events on a passing path)
```
- **Why it matters:** If the fallback regresses, scenarios that SHOULD fail on opencode `error` events while `tool_use` assertions still match would silently pass. User-facing default is schema-pinned; only the redundant fallback is unpinned.
- **Remediation:** unit test: `evaluate({}, evidence-with-error-event)` must contain `error event`; plus one scripted e2e fixture whose script forces an `error` event with `noErrors` unset.
- **Verify the fix:** re-run sabotage → check goes red.
- **Cross-examination:** Beta challenged (production `scenario.expect` always passes through `ScenarioSchema` defaulting `noErrors: true` in `src/config/schema.ts:197` — proved via `ScenarioSchema.safeParse` → `expect.noErrors = true`; that default IS pinned by `test/unit/config-schema.test.ts:248`; `?? true` is unreachable dead fallback on prod path). Verdict: STANDS, DOWNGRADED P1→P2.

### OCI-1.4-cap: probe 200-item array cap truncates the tier-1 inventory
- **Priority:** P2
- **Claim:** 1.4 — every `expect` entry is found in the probe inventory
- **Location:** `probe/core.js:15-17` (`value.slice(0, 200)` inside `clip`, applied to ALL arrays incl. inventory)
- **Proof:** polluted-vs-clean pair from OCI-4.4-ancestor (same commands); direct unit confirmation via `clip` on a 201-element array.
```bash
# polluted run analysis: N tools: 200, HAS echo_tool: False; clean: 63 tools, echo_tool present
```
- **Raw output:**
```
N tools: 200, HAS echo_tool: False
tier 1: expected tool "echo_tool" not in inventory tools [...]
```
- **Why it matters:** False tier-1 failures (and silently dropped hook records) whenever the tool list exceeds 200 — an artifact of evidence clipping, not of the plugin under test. Any heavy MCP/plugin union over 200 tools hits it even in a clean env.
- **Remediation:** bypass array-capping for the `inventory` record (dedicated path that clips strings but not list membership), or raise the cap with a `…[+N more]` marker AND make tier-1 matching cap-aware (prefer the former).
- **Verify the fix:** re-run polluted fixture (or a 201-tool synthetic inventory through `readProbe`+`runLoad` matching) → `echo_tool` found.
- **Cross-examination:** Beta challenged (re-proven by same polluted-vs-clean pair; code confirmed; adversarial note accepted — in this instance triggered via ancestor pollution but defect is independent; requires unusual tool counts and cap is intentional bounding → P2 proportionate). Verdict: STANDS P2.

### OCI-1.4-providers: `expect.providers/models` accepted but silently ignored
- **Priority:** P2
- **Claim:** 1.4 (tier-1 inventory expectations) vs README config surface
- **Location:** `src/tiers/load.ts:20-26,160-166` (`LoadTierExpected` has no providers/models; groups loop covers tools/commands/agents/skills/mcp only); `src/config/schema.ts:41-42` (fields exist, defaulted); `README.md:82-83` (`providers: []  # for provider plugins (tier 1)`)
- **Proof:** from repo root with scratch copy of `tool-basic` adding `expect: {tools:[echo_tool], providers:[nope-provider], models:[nope-model]}`:
```bash
bun bin/opencode-plugin-ci.ts run --tier load --scenario provign --opencode 2.0.26 --out $AUDIT_TMP/provign-out
```
- **Raw output:**
```
[('load', True, None)] for bogus provider+model names (tier 1 PASSED)
```
- **Why it matters:** Documentation contradicts behavior: a provider-plugin author asserting `providers: [mine]` gets a vacuous green tier 1 — the exact "tests pass while the check is inert" class the audit hunts.
- **Remediation:** either implement (`ctx.provider`/`ctx.model` lists + match in `runLoad`, SPEC 6.4) or fail validation when non-empty (fail-closed; document as unsupported). Don't leave accepted-but-inert.
- **Verify the fix:** re-run the Proof config → tier 1 fails naming the missing provider (or `validate` rejects the fields).
- **Cross-examination:** Beta challenged (re-proved structurally: scratch config parses cleanly while `grep -n "providers\|models" src/tiers/load.ts` returns NOTHING; README advertises with no warning; `docs/NOTES.md:304` admits ignored but NOTES is internal, README is what authors read). Verdict: STANDS P2.

### OCI-6.1-allowed-wiring: required-vs-allowed version wiring has no automated guard
- **Priority:** P2 (downgraded from P1 by cross-examination)
- **Claim:** 6.1 ("Results for `opencode.versions[0]` are required while later versions are allowed failures (`allowedVersions` passed to the report renderer — the M10 bug class)")
- **Location:** `src/run.ts:191-192` (`const required = versions[0]; const allowedVersions = versions.slice(1);`) wired to `renderMarkdown(resultsFile, { allowedVersions })` at `src/run.ts:443`
- **Proof:** in `$AUDIT_TMP/wt`, one-line `const allowedVersions = versions.slice(1);` → `const allowedVersions: string[] = [];`, then from wt root:
```bash
bun run check
rg -ln "allowed|versions\[0\]" test/e2e/
```
- **Raw output:**
```
sabotage applied: src/run.ts
213 pass / 0 fail (exit 0)
rg: no e2e file mentions allowed versions
```
- **Why it matters:** The renderer is tested; the call site is not. If someone drops the `allowedVersions` argument, allowed-leg labels render wrong. Impact is report headers only — fail-closed direction (renders allowed leg as required = false alarm, never silent pass).
- **Remediation:** extract `partitionVersions(versions)` (`{required, allowedVersions}`) into a pure function, assert `partitionVersions(["2.0.26","latest"]) === {required:"2.0.26", allowedVersions:["latest"]}`, and call it from `runCi`.
- **Verify the fix:** re-run the sabotage → new test must fail; `bun run check` green on fixed tree.
- **Cross-examination:** Gamma challenged (re-ran sabotage → 213 pass; BUT exit-code logic in `src/run.ts:468-492` filters exclusively on `r.opencode === required` and never reads `allowedVersions` — only `renderMarkdown` consumes it, i.e. headers only; sabotage direction renders false alarm not silent pass; M10 re-render path IS guarded by `test/unit/report.test.ts:131` `deriveAllowedVersions mirrors run.ts versions.slice(1)`). Verdict: fact STANDS, DOWNGRADED P1→P2.

### OCI-5.6-inert-window: `gate.window`/`gate.threshold` are accepted but inert
- **Priority:** P2
- **Claim:** 5.6 (absent-acks default + custom window/threshold)
- **Location:** `src/config/schema.ts:60-61` (accepted, defaults 5/0.9), `src/gate/gate.ts:294-311` (tally re-implements `samples >= 5 && passes/samples >= 0.9` literally), `src/gate/verdict.ts:135` (verbatim upstream)
- **Proof:** from repo root:
```bash
rg -n 'window|threshold' src/gate/gate.ts src/config/schema.ts
rg -n '\.window|\.threshold|gate\.window' src/ | grep -v test || true
# executed: scratch tool-basic copy with gate: {window: 50, threshold: 0.5, bootstrap: allow} → validate exit 0, no warning
```
- **Raw output:**
```
const stable = [...tally]
  .filter(([, cell]) => cell.samples >= 5 && cell.passes / cell.samples >= 0.9)
# zero reads of .window/.threshold outside schema defaults
```
- **Why it matters:** A user who sets `gate: {window: 10, threshold: 0.5}` per README gets silently different-from-expected gating — the "tests pass, behavior wrong" class. NOTES documents it, README does not.
- **Remediation:** README + schema descriptions gain `deprecated — inert, upstream verdict hard-codes 5/0.9` notes and `validate` warns when non-default values are set.
- **Verify the fix:** set non-default window/threshold → `validate`/run emits `gate.window is accepted but inert (upstream verdict uses >= 5 samples, >= 90%)` warning naming the config file.
- **Cross-examination:** Gamma challenged (executed live `validate` with absurd window/threshold accepted silently; README:92-93 documents both with no inert warning; schema descriptions carry no inert note). Verdict: STANDS P2.

### OCI-2.5-files-symlink: `files:` assertion follows symlinks outside projectDir
- **Priority:** P2
- **Claim:** 2.5 (`files:` rejects any `..` escaping the project dir)
- **Location:** `src/assert/expect.ts:318-370` (resolve+startsWith on lexical path only; `existsSync`/`readFileSync` follow symlinks)
- **Proof:** from repo root:
```bash
bun -e 'import { evaluate } from "./src/assert/expect.ts"; /* symlink /etc -> $proj/linketc; evaluate({files:[{path:"linketc/passwd",exists:true}]}) */'
```
- **Raw output:**
```
"linketc/passwd" => PASS (allowed) while "../evil.txt", "sub/../../evil.txt", "/etc/passwd" all correctly FAIL: path escapes the project dir.
```
- **Why it matters:** Plugin under test runs inside the sandbox and can create symlinks (`linketc -> /etc`). A scenario asserting on that path then reads outside content into `got` failure strings → `report.md`/SUMMARY exfiltration channel for host files. Requires plugin+scenario collusion but breaks stated containment.
- **Remediation:** after lexical check, `realpath` the parent (or file if present) and re-check containment; or `lstat` + reject symlinks. Fail closed on `realpath` error.
- **Verify the fix:** `linketc/passwd` must yield `path escapes the project dir` (or symlink rejection), legit `sub/../ok.txt` still passes.
- **Cross-examination:** Alpha challenged (scope overreach — claim promises only `..` rejection which WORKS; challenge FAILS to move severity because lexical-only containment with a real collusion-gated host-file channel fits P2). Verdict: STANDS P2.

### OCI-6.4-action-pins: three GitHub Actions float on superseded v4 majors while v6/v7 exist
- **Priority:** P2
- **Claim:** 6.4 (packaging/CI pins) and 7.2 (CI definition); audit task "pins vs head"
- **Location:** `action.yml:30-31,58`, `.github/workflows/ci.yml:9-10,16-18`
- **Proof:** from repo root:
```bash
rg -n '(oven-sh/setup-bun|actions/(setup-node|upload-artifact|checkout))@v[0-9]+' action.yml .github/workflows/ci.yml
git ls-remote https://github.com/actions/checkout.git HEAD
```
- **Raw output:**
```
checkout: df4cb1c... v6.0.3 / d23441a... v6.1.0 / 3d3c42e... v7–v7.0.1; setup-node: ... v7–v7.1.0; upload-artifact: ... v7–v7.0.2; setup-bun: ... v2.2.0 == HEAD
v4 tags still published, no deprecation notice; setup-bun@v2 == HEAD (no lag)
```
- **Why it matters:** Non-fatal lag (v4 still maintained, CI green), but floating majors mean CI semantics can shift without a repo diff; checkout v4 lacks v5+ hardening notes users may assume.
- **Remediation:** bump `actions/checkout@v4`→`@v7` (or pinned SHA), `actions/setup-node@v4`→`@v7`, `actions/upload-artifact@v4`→`@v7` in both files after one green CI run; or document why v4 is held with a review date.
- **Verify the fix:** `rg '(checkout|setup-node|upload-artifact)@v[0-9]' action.yml .github/workflows/ci.yml` shows only v7; `bun run check` + CI e2e green.
- **Cross-examination:** Gamma challenged (verified v7 tags exist, v4 not deprecated/archived, v7.0.x brand-new so holding v4 short-term is defensible — exactly why P2 not P1 is correct). Verdict: STANDS P2.

### OCI-7.1-no-line: validation errors name file + field, not line
- **Priority:** P3
- **Claim:** 7.1 (fail validation with file path + line)
- **Location:** `src/config/load.ts:31-39` (`formatIssues`: `${file}: validation failed:\n  - at "${path}": ${message}`)
- **Proof:** from repo root with six scratch configs:
```bash
bun bin/opencode-plugin-ci.ts validate --config $AUDIT_TMP/cfg-tests/case-strict/.opencode-ci/config.yaml
```
- **Raw output:**
```
Configuration error: /tmp/.../case-strict/.opencode-ci/scenarios/bad.yaml: validation failed:
  - at "expect": Unrecognized key: "tool"
(exit 2 in all six cases; file + dotted field path, no line number; yamlLineHint serves parse errors only)
```
- **Why it matters:** Minor — editors/CI must map field path back to a line by hand; the claim text should say "file path + field path".
- **Remediation:** one-word doc fix in audit claim + README ("unknown keys fail validation naming the file and field"); optionally attach `linePos` via YAML AST mapping (not required).
- **Verify the fix:** re-run the six scratch validates → messages unchanged (file+field); claim text corrected.
- **Cross-examination:** Gamma challenged (executed typo'd `expect.tool` → file+dotted field, no line; trivially re-runnable in `$AUDIT_TMP/cross-f7`). Verdict: STANDS P3.

### OCI-registry-drift: pinned 2.0.26 is 6 releases behind head 2.0.32; plugin-API drift purely additive
- **Priority:** P3
- **Claim:** Beta task 1/2 (registry truth, upstream drift); touches 6.1's `latest` leg and 4.4's binary resolution
- **Location:** `src/opencode/binary.ts:79` (`version === "latest" ? await npmViewVersion() : version` — resolved live per run)
- **Proof:** from repo root:
```bash
npm view @opencode/cli versions --json | jq 'length'
npm view @opencode/cli@2.0.26 version
npm view @opencode/cli version
curl -s -X POST https://api.osv.dev/v1/query -d '{"package":{"name":"zod","ecosystem":"npm"},"version":"4.1.0"}'
git -C review/opencode show v2.0.26:packages/core/src/codemode/catalog.ts | diff - logs/catalog-head.ts || true
```
- **Raw output:**
```
1141 versions, contains 2.0.26, head 2.0.32 (also @opencode/plugin: 1109 versions, contains 2.0.26, head 2.0.32; neither deprecated/yanked)
yaml: 105 versions, 2.9.1 == dist-tag latest; zod: 1013 versions, 4.1.0 present, head 4.6.7
OSV yaml@2.9.1, zod@4.1.0, @opencode/cli@2.0.26 + latest counterparts: 0 vulns each
API diffs pinned→head: tool.ts IDENTICAL, shell.ts IDENTICAL, catalog.ts IDENTICAL, hooks.ts IDENTICAL, policy.ts IDENTICAL, agent.ts cosmetic-only, session.ts +1 union member, permission.ts +assert method
```
- **Why it matters:** The default `opencode.versions: ["2.0.26","latest"]` leg floats to a different binary on every run (today 2.0.32); drift so far is additive-only, so the allowed-failure leg is low-risk — but nothing re-verifies this automatically.
- **Remediation:** none required now; add a scheduled/CI head-leg e2e and consider a policy note on how far `latest` may drift before re-pinning.
- **Verify the fix:** re-run the four `diff pinned vs HEAD` comparisons after each re-pin; `npm view @opencode/cli version` for the float value.
- **Cross-examination:** Gamma challenged (re-verified head 2.0.32 vs pinned, no deprecated/yanked, OSV `{}` for all six package-versions, spot-check catalog diff identical, pinned tag SHA `9b4ec571` matches). Verdict: STANDS P3 (observation).

### OCI-6.3-working-dir: working-directory/artifact path unconstrained
- **Priority:** P3 (downgraded from P2 by cross-examination)
- **Claim:** 6.3 (Action inputs travel via env, working-directory safe)
- **Location:** `action.yml:39`, `action.yml:61`
- **Proof:** from repo root:
```bash
rg -n '\$\{\{' action.yml
sed -n '37,56p' action.yml
```
- **Raw output:**
```
run: scripts use only $IN_TIERS/$IN_VERSIONS/$ACTION_PATH (quoted) — no shell injection
But working-directory: ${{ inputs.working-directory }} and path: ${{ inputs.working-directory }}/.opencode-ci/out are runner-evaluated paths with no validation; ../ resolves outside GITHUB_WORKSPACE
```
- **Why it matters:** Low exploitability today (inputs are workflow-author controlled, not PR metadata). A reusable action documenting `working-directory` as "plugin repo directory" should not silently honor `/tmp` or `../../` — hardening, not a live vuln.
- **Remediation:** docs: "working-directory must be inside GITHUB_WORKSPACE; `..` and absolute paths are unsupported" + optional guard step via env passthrough (keep zero-interpolation pattern): `case "$IN_WD" in /*|*..*) echo "working-directory must be inside the workspace" >&2; exit 2;; esac`.
- **Verify the fix:** `working-directory: ../` fails exit 2 with message; `.` still works.
- **Cross-examination:** Alpha challenged (traversal requires WORKFLOW AUTHOR to pass `../`; author already has arbitrary code exec; PR metadata cannot reach field unless author wires it; runner behavior never executed live). Verdict: DOWNGRADED P2→P3.

### OCI-7.2-floating-majors: unpinned @v2/@v4 actions float (supply-chain drift hygiene)
- **Priority:** P3 (downgraded from P2 by cross-examination; overlaps OCI-6.4-action-pins — retained as hygiene entry)
- **Claim:** 7.2 / 6.3 (modern, supported, production-grade pins)
- **Location:** `action.yml:30-31,58`, `.github/workflows/ci.yml:9-10,16-18` (`oven-sh/setup-bun@v2`, `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`)
- **Proof:** from repo root:
```bash
rg -n '(oven-sh/setup-bun|actions/(setup-node|upload-artifact|checkout))@v[0-9]+' action.yml .github/workflows/ci.yml
git ls-remote https://github.com/oven-sh/setup-bun HEAD
git ls-remote https://github.com/actions/checkout HEAD
```
- **Raw output:**
```
oven-sh/setup-bun@v2 (HEAD 0c5077e... == v2.2.0, no lag); actions/*@v4 (heads move; majors float)
```
- **Why it matters:** Floating majors can silently change runner behavior between audits; `@v2`/`@v4` are GitHub-endorsed consumption (official READMEs advertise major tags) and satisfy "modern, supported" — SHA-pinning is hygiene, not a medium defect. Overlaps OCI-6.4-action-pins version-lag entry.
- **Remediation:** pin each `uses:` to `major-tag@sha` + Dependabot; or record upstream SHAs in NOTES.
- **Verify the fix:** `rg` shows 40-char SHAs; `git ls-remote` matches pinned SHAs at audit time.
- **Cross-examination:** Alpha challenged (floating majors are endorsed norm, no CVE/drift demonstrated, `bun.lock` + `--frozen-lockfile` cover npm side; elevating ecosystem default to P2 misprices it). Verdict: DOWNGRADED P2→P3.

### OCI-6.2-artifact-poisoning: default artifact name shared across matrix legs
- **Priority:** P3 (downgraded from P2 by cross-examination)
- **Claim:** 6.2 (matrix legs use distinct artifact names mirrored in gate.artifact)
- **Location:** `action.yml:17-18` (default `opencode-plugin-ci-results`), `src/config/schema.ts:67` (default match), `src/gate/history.ts:104-206` (filters by artifact+workflow+branch+requiredVersion+live-only, newest-first)
- **Proof:** from repo root:
```bash
rg -n 'artifact' action.yml src/config/schema.ts src/gate/history.ts README.md
```
- **Raw output:**
```
defaults match (opencode-plugin-ci-results both sides — good); history fetch is --workflow <file> --branch <branch> --name <artifact> then keeps only tier==="live" && opencode===requiredVersion && skipped===undefined rows
Two matrix legs (2.0.26 required + latest allowed) uploading the same default name in the same workflow run collide (upload-artifact@v4 merges/overwrites by name)
```
- **Why it matters:** Misconfigured matrix (the default!) yields flaky-gate history poisoning: allowed `latest` results can mask required-leg verdicts. Docs warn, but the default is the trap. No live workflow dispatched (no GitHub writes allowed) — inferred hazard.
- **Remediation:** fail validation when `gate.artifact` equals the default AND more than one opencode version is configured, with message pointing at README matrix section; or namespace downloads by version explicitly.
- **Verify the fix:** matrix config with `versions: ["2.0.26","latest"]` + default artifact → validation error naming file+field; per-leg distinct artifacts pass.
- **Cross-examination:** Alpha challenged (repo ALREADY documents requirement twice — README:275-292 with YAML example + action.yml:18 input description; default single-leg use safe; failure requires ignoring docs; inferred user-misconfiguration hazard is P3 enhancement). Verdict: DOWNGRADED P2→P3.

## Claim Ledger

| Claim | Status | Evidence |
|---|---|---|
| 1.1 tier-1 boots real binary, asserts code/timeout/no-errors | VERIFIED | `src/sandbox/sandbox.ts:159-174`, `src/tiers/load.ts:119-132`; clean fixture runs code 0 + durationMs; fake-argv log |
| 1.2 plugin identity via probe inventory | VERIFIED | `src/tiers/load.ts:139-151`; throws `failed` path names `fixture boom`; S13 sabotage caught by e2e |
| 1.3 logfmt plugin-log problems | VERIFIED | `src/opencode/logs.ts:6-76,87-113`; throws second failure verbatim |
| 1.4 expect tools/commands/agents/skills/mcp + TUI static | VERIFIED+findings | tier-1 pass + negatives (`nope-cmd` fails naming inventory); `tui-only` pass / `tui-broken` fail; gaps OCI-1.4-cap, OCI-1.4-providers |
| 1.5 tier-1-fail skips tiers 2-3 | VERIFIED+gap | throws/tui-broken full runs show `skipped: "tier 1 failed"`; skip unpinned → OCI-1.5-skip |
| 2.1 tools before/after pairing, count default | VERIFIED | `src/probe/read.ts:106-135`, `src/assert/expect.ts:154-191`; tool-basic/direct pass; S7+S11 sabotages caught |
| 2.2 output text + truncated got | VERIFIED | `src/assert/expect.ts:28-78`, `src/assert/matchers.ts:87-205`; S8b caught |
| 2.3 hooks pre/post + phase default post | VERIFIED | hook-mutate/shell-env/promptfix e2e + swap experiments both directions @2.0.26+2.0.32 |
| 2.4 request nth/system/tools catalog paths | VERIFIED | system-inject + tool-direct + catreq e2e; negatives name got values |
| 2.5 noErrors default, exitCode default, files `..` | PARTIAL | exitCode + files `..` VERIFIED; `noErrors` default fallback unpinned → OCI-2.5-noerrors (P2); symlink bypass → OCI-2.5-files-symlink |
| 3.1 stub auto-wrap via findCatalogPath | VERIFIED | `src/stub/stub.ts:243-268`; tool-basic vs tool-direct e2e; S1 caught |
| 3.2 request classification + exhausted script | VERIFIED | `src/stub/stub.ts:224-233`; pure + live-stub exhausted proof |
| 3.3 probe metadata-last after snapshot | PARTIAL | behavior implication proven via hook-order divergence; ordering untested → OCI-3.3-meta (P2, merged) |
| 3.4 system parts clipped at SYSTEM_MAX | VERIFIED | `probe/core.js:120-136`; system-inject survives @both versions |
| 4.1 shim file-URL re-export | VERIFIED | `src/plugin/shim.ts:19-24`; spaces e2e `%20`; S6 caught |
| 4.2 resolveEntries order + no-entry exit 2 | VERIFIED | `src/plugin/entry.ts:164-220`; 8/8 pure order checks; no-entry exit 2 |
| 4.3 plugin order [pre,plugin,post] | VERIFIED+gap | default + swapped proofs @2.0.26+2.0.32; load copy unpinned → OCI-4.3-order (P2) |
| 4.4 binary resolution + sandbox env | VERIFIED+findings | OPENCODE_BIN + latest-install + 7 env assertions green; ancestor leak → OCI-4.4-ancestor (P1); cap → OCI-1.4-cap |
| 4.5 install/build once, fail exit 2 | VERIFIED | `src/plugin/install.ts:12-58`; install exit-3 → exit 2, no tier ran |
| 5.1 live k-of-n + budget accounting | PARTIAL | defaults + cross-field + usage/budget with fake binary VERIFIED; real-model counting UNVERIFIABLE (no key, refusal boundary) |
| 5.2 pre-attempt budget skip + no-key skip | VERIFIED | no-key exit 0 + spent>=limit zero-spawn; S9b caught |
| 5.3 judge isolation + strict boolean + sentinel | VERIFIED | argv + tool-less @both versions + parseVerdict matrix; S5 caught |
| 5.4 judge tokens count + cross-field rules | VERIFIED | costUSD 0.3 = 0.25+0.05 accounting; 6 cross-field shapes exit 2 |
| 5.5 flake gate verbatim constants | VERIFIED | byte-diff vs IUMBTEMS (5-line header only); sabotage `>=500` caught |
| 5.6 absent-acks default + inert window/threshold | PARTIAL | absent default VERIFIED + sabotage caught; window/threshold inert → OCI-5.6-inert-window (P2) |
| 6.1 required[0]/allowed-rest + exit codes | PARTIAL | structure VERIFIED; wiring unpinned → OCI-6.1-allowed-wiring (P2) |
| 6.2 gate history via gh artifacts | VERIFIED | `src/gate/history.ts` gh list/download; defaults match; zero cache usage |
| 6.3 Action env-passthrough + lockfile + outputs | PARTIAL | passthrough VERIFIED by inspection; invariant unguarded → OCI-6.3-action-guard (P1); working-dir → OCI-6.3-working-dir (P3) |
| 6.4 npm packaging + engines + schema sync | PARTIAL | tarball + probe hygiene + schemas-in-sync VERIFIED; unpublished → OCI-6.4-unpublished (P1); files unguarded → OCI-6.4-files-guard (P1); pins → OCI-6.4-action-pins (P2) |
| 7.1 strict schemas + (?i) + cross-field | PARTIAL | 19/19 `.strict()` + 6 cross-field + `(?i)` executed VERIFIED; sabotage caught; line-number overpromise → OCI-7.1-no-line (P3) |
| 7.2 CI reproduces tiers | PARTIAL | `bun install` + `bun run check` 213 pass + pins VERIFIED; full e2e deferred to Alpha; floating majors → OCI-7.2-floating-majors (P3); drift → OCI-registry-drift (P3) |
| 7.3 probe redaction + noEvents + PRT prohibition | PARTIAL | env/header redaction VERIFIED incl. AUTH/COOKIE; redact untested → OCI-7.3-redact-untested (P1); other surfaces leak → OCI-7.3-evidence-leaks (P1) |

## Sabotage Results

Suite = `bun run check` (typecheck + biome + 213 unit tests) unless e2e noted. All in `$AUDIT_TMP/wt`, restored after each. Duplicates noted.

| Invariant | One-line sabotage (file:line, before → after) | Suite result | Caught? |
|---|---|---|---|
| [3.1] auto-wrap `src/stub/stub.ts:256` `findCatalogPath(...)` → `undefined` | Alpha S1 | check: 2 unit FAIL + tier2 e2e FAIL | YES |
| [3.3] metadata-last `probe/core.js:64` metadata spread first, payload spread last | Alpha S2 = Gamma metadata-last (DUPLICATE) | check 0 fail (213); e2e tier2 green; `bun test ./test/unit` 213 pass | NO → OCI-3.3-meta |
| [4.3] load order `src/tiers/load.ts:89` `[pre,shim,post]` → `[post,shim,pre]` | Alpha S3b | check 0 fail; `probe.test.ts` green (own order) | NO → OCI-4.3-order |
| [1.2] identity `src/tiers/load.ts:140` `=== shimServerJs` → `!==` | Alpha S13 | check green; e2e tier1 FAIL (throws flips to pass) | YES (e2e) |
| [2.1] count default `src/assert/expect.ts:163` `?? {gte:1}` → `?? {gte:0}` | Alpha S7 | check: unit FAIL | YES |
| [2.1] callID pairing `src/probe/read.ts:113` `befores.get(record.callID)` → `befores.get(record.tool)` | Alpha S11 | check: unit FAILs + e2e tier2 FAIL | YES |
| [2.2] truncate `src/assert/matchers.ts:11` drop `truncate()` in `show()` | Alpha S8b | check: unit FAIL | YES |
| [2.5] noErrors `src/assert/expect.ts:381` `?? true` → `?? false` | Alpha S10b | check 0 fail; e2e tier2 green | NO → OCI-2.5-noerrors |
| [2.5] files `..` `src/assert/expect.ts:324` neuter rejection | Alpha S12c2 = Gamma files `..` (DUPLICATE) | check: unit FAIL `escaping paths are rejected` | YES |
| [5.2] budget `src/tiers/live.ts:308` `>=` → `>` / `if (false)` | Alpha S9b = Gamma budget (DUPLICATE) | check: unit FAIL `exhausted budget skips without spawning` | YES |
| [5.3] judge `src/tiers/judge.ts:127` `=== "boolean"` → truthy | Alpha S5 = Gamma judge (DUPLICATE) | check: unit FAIL `pass as a string is rejected` | YES |
| [4.1] shim `src/plugin/shim.ts:22` file-URL → raw path | Alpha S6 | check: unit FAIL `exact re-export` | YES |
| [1.5] cascade `src/run.ts:248` `if (!tier1Pass)` → `if (!tier1Pass && tier1Pass)` | Alpha S4c | check 0 fail (213); `cli.test.ts` green | NO → OCI-1.5-skip |
| [5.5] verbatim `src/gate/verdict.ts:135` `samples >= 5` → `samples >= 500` | Beta 5.5 | red (gate-verdict sticky-red tests fail) | YES |
| [5.6] absent-acks `src/gate/gate.ts:92` default → `throw` | Beta 5.6 | red (`readAcknowledgments > absent defaults` + 4 runGate fails) | YES |
| [6.1] allowed wiring `src/run.ts:192` `slice(1)` → `[]` | Beta 6.1 | GREEN (213 pass) | NO → OCI-6.1-allowed-wiring |
| [6.3] no-interpolation `action.yml:43,48` drop passthrough + inject `# ${{ inputs.tiers }}` | Beta 6.3 | GREEN (213 pass) | NO → OCI-6.3-action-guard |
| [6.4] files `package.json:17-26` remove `"probe"` | Beta 6.4 | GREEN (213 pass) | NO → OCI-6.4-files-guard |
| [7.1] strictness naive `src/config/schema.ts` delete `.strict()` | Beta 7.1-naive | red via biome FORMAT (incidental, not semantic) | INCIDENTAL |
| [7.1] strictness stable `src/config/schema.ts` `.strict()` → `.strip()` | Beta 7.1-stable = Gamma strict (DUPLICATE) | red (`expect.tool typo fails` + `loadConfig names file+field` fail) | YES |
| [7.3] redact superset `probe/core.js:3` drop AUTH/COOKIE | Gamma redact-superset | `bun run check`: 213 pass GREEN | NO → OCI-7.3-redact-untested |
| [7.3] redact break `probe/core.js:3` → `/KEY/i` | Gamma redact-break | `bun test ./test/unit`: 213 pass GREEN | NO → OCI-7.3-redact-untested |

Caught 15/20 unique invariants (counting 5 duplicates once). Uncaught 5 unique → 4 Alpha P1→(1 P1 + 3 P2 after cross) + Beta 3 (1 P2 + 2 P1) + Gamma 2 unique (redact P1, metadata duplicate). Final findings 22 (8 P1, 9 P2, 5 P3) after severity corrections and merges.

## Regression Ledger

| Previous finding ID | Previous priority | Status now: FIXED / STILL OPEN / REGRESSED / NO LONGER APPLICABLE | Evidence |
|---|---|---|---|
| (none — First run) | n/a | n/a | No previous `AUDIT_REPORT_FINDINGS.md` existed at audit start; nothing to re-verify. Next run must list all 22 OCI-* IDs above with re-verification from scratch. |

## Not Audited / Unverifiable

- Live tier against a REAL model (5.1 k-of-n counting, judge quality, real spend): no API key in this environment; refusal boundary respected (only skip-path + stub-judge paths with throwaway dummy key, loopback stub only). Needs a human-supplied key in an isolated account with a tight budget to check.
- `opencode models` bare-id/default resolution against a live key-widened list: unit-covered + passthrough proven; live-list behavior not observable here.
- Windows/macOS specifics (`pathToFileURL` shim with `C:\` paths, `cmd /c` install path, drive-letter handling): Linux host; space handling proven (`space%20dir` e2e), `C:\`-style untestable here. Needs a Windows runner to check.
- `assistant`/`event-file`-style timing races (double `inventory` records observed — hook-mutate clean run 2 identical active inventories; polluted run failed-then-active; `readProbe` last-wins): no flake proven, noted as robustness observation. Needs timing-instrumented runs to check.
- Full `bun run test:e2e --timeout 600000` (24 tests) in one shot in Gamma/Beta scope: not run there by design (Alpha's runtime domain); equivalent fixture-by-fixture CLI coverage achieved via fresh binaries. Next run should still attempt the full suite once in a clean-TMPDIR host.
- Gate real history path (`gh run list`/`run download`, denial/fallback on `gh` failure, token scope beyond code-read): covered only by injected-`fetchHistoryFn` unit tests, never against real `gh`/API here. Needs a scratch repo with staged artifacts and a scoped token to check.
- `bunx` resolution post-publish: untestable until OCI-6.4-unpublished is remediated (package does not exist on the registry).
- Action injection detonation in a real runner (malicious `tiers`/`versions` payloads, `working-directory: ../` runner-side, same-name matrix artifact overwrite): static verification only (zero `${{ }}` in `run:` scripts, quoted env, `takeValue` rejection); no GitHub writes allowed. Needs a disposable test repo + workflow dispatch to check.
- `pull_request_target` with live secrets: deliberately never tested with a real key. PoC with throwaway `sk-test-*` dummy proves the exfil channel (evil plugin `setup` read env + wrote `/tmp/gamma-evil-exfil.txt`); live-key impact is inferred. Do not test with a real key in an audit.
- Upstream head drift beyond static API diffs (Beta) + Alpha's 10-fixture matrix (runtime): local `review/opencode` clone (2026-10-10) is 8 days behind remote HEAD `c38d83c0`; remote-HEAD API diffs rely on Beta's logs. Needs a fresh clone at each re-run to check. Note: prompt's "fork, not sst/opencode" premise is outdated — `sst/opencode` 301-redirects to `anomalyco/opencode`, both remotes return identical SHA `c38d83c0c4f92466ff9c8e12b8a741698e811012`; anomalyco IS canonical.
- Symlink/absolute workspace edge cases on non-Linux filesystems and concurrent-leg `/tmp` cross-talk under load: inferred from `join`/`resolve` proofs, not executed under contention. Needs a loaded multi-leg run to check.
