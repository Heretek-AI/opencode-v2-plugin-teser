// OCI-6.4-files-guard: the published tarball must ship every load-bearing
// file. `probe/` is required at runtime (the sandbox `plugins` array points
// at it), so dropping it from `files` would ship a tarball that fails every
// tier with a confusing plugin-load error. This pins `files`/`bin` and the
// packed contents; re-drop `"probe"` from `files` and this goes red.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const EXPECTED_FILES = [
	"bin",
	"src",
	"probe",
	"schema",
	"examples",
	"README.md",
	"LICENSE",
	"NOTICE",
];

const REQUIRED_TARBALL_FILES = [
	"probe/core.js",
	"probe/pre/server.js",
	"probe/post/server.js",
	"schema/config.json",
	"bin/opencode-plugin-ci.ts",
];

function packageJson(): {
	files?: unknown;
	bin?: unknown;
} {
	return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
		files?: unknown;
		bin?: unknown;
	};
}

describe("packaging guard", () => {
	test("package.json files is exactly the documented set", () => {
		expect(packageJson().files).toEqual(EXPECTED_FILES);
	});

	test("bin maps opencode-plugin-ci to the CLI script", () => {
		expect(packageJson().bin).toEqual({
			"opencode-plugin-ci": "bin/opencode-plugin-ci.ts",
		});
	});

	test("npm pack ships the load-bearing files", async () => {
		const proc = Bun.spawn(["npm", "pack", "--dry-run"], {
			cwd: REPO_ROOT,
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout as ReadableStream).text(),
			new Response(proc.stderr as ReadableStream).text(),
		]);
		const code = await proc.exited;
		expect(code).toBe(0);
		const output = `${stdout}\n${stderr}`;
		const missing = REQUIRED_TARBALL_FILES.filter(
			(file) => !output.includes(file),
		);
		expect(missing).toEqual([]);
	}, 120_000);
});
