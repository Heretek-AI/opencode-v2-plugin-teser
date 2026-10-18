// OCI-6.3-working-dir: `working-directory` is runner-evaluated, so the
// action guards it via env passthrough (`IN_WD`, keeping the
// zero-interpolation invariant). The guard compares the resolved `$PWD`
// (the step has already changed into working-directory) against the
// resolved workspace root: absolute paths inside the workspace are fine,
// paths outside fail before any tier runs. These tests pin the guard
// script and its wiring.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as YAML from "yaml";

const REPO_ROOT = join(import.meta.dir, "..", "..");

interface ActionDoc {
	inputs?: Record<string, { description?: string }>;
	runs?: { steps?: Array<{ env?: Record<string, string>; run?: string }> };
}

function action(): ActionDoc {
	return YAML.parse(
		readFileSync(join(REPO_ROOT, "action.yml"), "utf8"),
	) as ActionDoc;
}

/**
 * Mirrors the guard in action.yml: the resolved working directory must be
 * the workspace root or beneath it. Accepts absolute paths inside the
 * workspace (including `sub/../sub`, already resolved by the runner);
 * rejects anything outside, including `ws/..` (which resolves outside).
 */
export function isOutsideWorkspace(pwd: string, workspace: string): boolean {
	const ws = workspace.endsWith("/") ? workspace : `${workspace}/`;
	const here = pwd.endsWith("/") ? pwd : `${pwd}/`;
	return !here.startsWith(ws);
}

describe("working-directory guard", () => {
	test("working-directory is documented as workspace-bound, absolute-inside allowed", () => {
		const description =
			action().inputs?.["working-directory"]?.description ?? "";
		expect(description).toMatch(/GITHUB_WORKSPACE/);
		expect(description).toMatch(/absolute/);
		expect(description).not.toMatch(/unsupported/);
	});

	test("the input travels via IN_WD env, never interpolated into run:", () => {
		// Built by concatenation (no literal `${{`) so this file stays lint-clean.
		const expr = "$" + "{{ inputs.working-directory }}";
		const steps = action().runs?.steps ?? [];
		const runStep = steps.find(
			(step) => typeof step.run === "string" && step.run.includes("IN_WD"),
		);
		expect(runStep?.env?.IN_WD).toBe(expr);
		expect(runStep?.run ?? "").not.toContain(expr);
	});

	test("the run: script pins the resolved-directory guard", () => {
		const run = (action().runs?.steps ?? []).find(
			(step) => typeof step.run === "string" && step.run.includes("IN_WD"),
		)?.run as string;
		expect(run).toContain('ws="$(cd "$GITHUB_WORKSPACE" && pwd -P)"');
		expect(run).toContain('case "$(pwd -P)/" in "$ws"/*)');
		expect(run).toContain('echo "result=fail" >> "$GITHUB_OUTPUT"');
		expect(run).toContain("exit 2");
		expect(run).not.toContain("/*|*..*");
	});

	test("guard helper accepts inside paths and rejects outside ones", () => {
		const ws = "/home/runner/work/repo/repo";
		expect(isOutsideWorkspace(ws, ws)).toBe(false);
		expect(isOutsideWorkspace(`${ws}/plugin`, ws)).toBe(false);
		expect(isOutsideWorkspace(`${ws}/sub/../sub`, ws)).toBe(false);
		expect(isOutsideWorkspace("/tmp/evil", ws)).toBe(true);
		expect(isOutsideWorkspace("/home/runner/work/other/other", ws)).toBe(true);
		expect(isOutsideWorkspace("/home/runner/work", ws)).toBe(true);
	});
});
