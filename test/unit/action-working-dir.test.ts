// OCI-6.3-working-dir: `working-directory` is runner-evaluated and would
// otherwise honor `../` or absolute paths escaping GITHUB_WORKSPACE. The
// action guards it via env passthrough (`IN_WD`, keeping the
// zero-interpolation invariant): `..` and absolute values fail before any
// tier runs. These tests pin the guard script and its wiring.
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

/** The guard each `run:` script must carry (kept in sync with action.yml). */
export function workingDirGuardFails(input: string): boolean {
	return input.startsWith("/") || input.includes("..");
}

describe("working-directory guard", () => {
	test("working-directory is documented as workspace-bound", () => {
		const description =
			action().inputs?.["working-directory"]?.description ?? "";
		expect(description).toMatch(/GITHUB_WORKSPACE/);
		expect(description).toMatch(/\.\./);
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

	test("the run: script rejects absolute and dot-dot paths up front", () => {
		const run = (action().runs?.steps ?? []).find(
			(step) => typeof step.run === "string" && step.run.includes("IN_WD"),
		)?.run as string;
		expect(run).toContain('case "$IN_WD"');
		expect(run).toContain("/*|*..*");
		expect(run).toContain("exit 2");
	});

	test("guard predicate rejects escapes and accepts normal dirs", () => {
		expect(workingDirGuardFails("/tmp/evil")).toBe(true);
		expect(workingDirGuardFails("../escape")).toBe(true);
		expect(workingDirGuardFails("a/../../b")).toBe(true);
		expect(workingDirGuardFails(".")).toBe(false);
		expect(workingDirGuardFails("test/fixtures/plugins/tool-basic")).toBe(
			false,
		);
	});
});
