// OCI-6.3-action-guard: the zero-interpolation invariant for action.yml —
// no `run:` block may contain a `${{ inputs.* }}` or `${{ github.* }}`
// expression. Inputs travel through `env:` only, so a future edit that
// interpolates an input into a script fails here instead of silently
// becoming a command-injection boundary.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as YAML from "yaml";

const REPO_ROOT = join(import.meta.dir, "..", "..");

interface ActionStep {
	run?: unknown;
}

function parseAction(text: string): unknown {
	return YAML.parse(text) as unknown;
}

/** Every `run:` script in the composite action, in step order. */
export function runBlocks(action: unknown): string[] {
	const steps = (action as { runs?: { steps?: ActionStep[] } })?.runs?.steps;
	if (!Array.isArray(steps)) {
		throw new Error("action.yml has no runs.steps array.");
	}
	return steps
		.map((step) => step.run)
		.filter((run): run is string => typeof run === "string");
}

const FORBIDDEN_IN_RUN = /\$\{\{\s*(inputs|github)\./;

/** True when a `run:` script keeps the zero-interpolation invariant. */
export function runBlockIsClean(script: string): boolean {
	return !FORBIDDEN_IN_RUN.test(script);
}

describe("action.yml zero-interpolation guard", () => {
	const action = parseAction(
		readFileSync(join(REPO_ROOT, "action.yml"), "utf8"),
	);

	test("the action has run: blocks to guard (fail closed on shape drift)", () => {
		expect(runBlocks(action).length).toBeGreaterThan(0);
	});

	test("no run: block interpolates inputs or github context", () => {
		// Filtered form: a failure prints the offending script(s).
		expect(
			runBlocks(action).filter((script) => !runBlockIsClean(script)),
		).toEqual([]);
	});

	test("injected inputs/github expressions are caught", () => {
		expect(runBlockIsClean('echo "tiers are ${{ inputs.tiers }}"')).toBe(false);
		// A comment line still interpolates on the runner, so it must fail too.
		expect(runBlockIsClean("# ${{ inputs.tiers }}")).toBe(false);
		expect(runBlockIsClean("tag: ${{ github.action_path }}/x")).toBe(false);
		expect(runBlockIsClean('args+=(--tier "$t")')).toBe(true);
	});

	test("`${{ github.action_path }}` stays out of run: blocks", () => {
		for (const script of runBlocks(action)) {
			expect(script).not.toContain("github.action_path");
		}
	});
});
