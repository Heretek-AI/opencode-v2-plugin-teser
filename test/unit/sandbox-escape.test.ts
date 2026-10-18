// OCI-4.4-workspace-escape: scenario workspace writes must stay inside the
// project dir. `../`, `sub/../../` and absolute paths throw ConfigError
// (exit 2 upstream) instead of escaping; a legit file still writes.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "../../src/config/load.ts";
import { Sandbox } from "../../src/sandbox/sandbox.ts";
import { cleanupTempDirs, tempDir } from "../helpers/tmp.ts";

const savedTmpdir = process.env.TMPDIR;

beforeEach(() => {
	// Contain the sandbox roots (including residue from throwing
	// constructors) so cleanupTempDirs() removes everything.
	process.env.TMPDIR = tempDir("sandbox-escape-");
});

afterEach(() => {
	if (savedTmpdir === undefined) {
		delete process.env.TMPDIR;
	} else {
		process.env.TMPDIR = savedTmpdir;
	}
	cleanupTempDirs();
});

function makeSandbox(workspace: Record<string, string>): Sandbox {
	return new Sandbox({
		opencodeBin: "/nonexistent/opencode",
		plugins: [],
		workspace,
	});
}

describe("sandbox workspace containment", () => {
	test("a legit workspace file still writes", async () => {
		const sandbox = makeSandbox({
			"ok.txt": "ok",
			"sub/nested.txt": "nested",
		});
		expect(readFileSync(join(sandbox.project, "ok.txt"), "utf8")).toBe("ok");
		expect(readFileSync(join(sandbox.project, "sub/nested.txt"), "utf8")).toBe(
			"nested",
		);
		await sandbox.dispose();
	});

	for (const rel of [
		"../escape.txt",
		"sub/../../escape2.txt",
		"../../sandbox-root-escape.txt",
		"/tmp/absolute-escape.txt",
	]) {
		test(`workspace path "${rel}" throws instead of escaping`, () => {
			expect(() => makeSandbox({ [rel]: "pwned" })).toThrow(ConfigError);
			expect(() => makeSandbox({ [rel]: "pwned" })).toThrow(
				/must be relative and stay inside the project dir/,
			);
		});
	}
});
