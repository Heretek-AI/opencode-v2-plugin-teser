// OCI-6.4-action-pins: `actions/checkout`, `actions/setup-node` and
// `actions/upload-artifact` floated on superseded v4 majors. They are pinned
// to v7 in both `action.yml` and `.github/workflows/ci.yml`
// (`oven-sh/setup-bun@v2` is already at HEAD). A revert to v4 — or any other
// single-digit major — goes red here.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

function usesOf(file: string): string[] {
	const text = readFileSync(join(REPO_ROOT, file), "utf8");
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- uses:") || line.startsWith("uses:"))
		.map((line) => line.replace(/^[-\s]*uses:\s*/, ""));
}

describe("action pins", () => {
	test("action.yml pins checkout/setup-node/upload-artifact to v7", () => {
		const uses = usesOf("action.yml");
		expect(uses).toContain("actions/setup-node@v7");
		expect(uses).toContain("actions/upload-artifact@v7");
		for (const u of uses.filter((entry) =>
			entry.startsWith("actions/checkout@"),
		)) {
			expect(u).toBe("actions/checkout@v7");
		}
		// No actions/* entry may float on an older major (setup-bun@v2 is
		// covered by the test below and is already at HEAD).
		const stale = uses.filter((u) => /actions\/[^@]+@v[1-6]\b/.test(u));
		expect(stale).toEqual([]);
	});

	test("ci.yml pins checkout/setup-node to v7", () => {
		const uses = usesOf(".github/workflows/ci.yml");
		expect(uses).toContain("actions/checkout@v7");
		expect(uses).toContain("actions/setup-node@v7");
		const stale = uses.filter((u) => /actions\/[^@]+@v[1-6]\b/.test(u));
		expect(stale).toEqual([]);
	});

	test("setup-bun stays on v2 (already at HEAD)", () => {
		for (const file of ["action.yml", ".github/workflows/ci.yml"]) {
			expect(usesOf(file)).toContain("oven-sh/setup-bun@v2");
		}
	});
});
