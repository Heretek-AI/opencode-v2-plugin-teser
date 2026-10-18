// OCI-2.5-files-symlink: `files:` assertions resolved symlinks by following
// them, so `linketc -> /etc` made `linketc/passwd` read host files into
// `got` failure strings. After the lexical check, `evaluateFiles` resolves
// the real path and re-checks containment, failing closed on realpath
// errors. A legit `sub/../ok.txt` (lexically inside, really inside) still
// passes.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Evidence, evaluate } from "../../src/assert/expect.ts";
import type { ScenarioExpect } from "../../src/config/schema.ts";
import { ProbeLog } from "../../src/probe/read.ts";
import type { RunOutput } from "../../src/sandbox/sandbox.ts";
import { cleanupTempDirs, tempDir } from "../helpers/tmp.ts";

afterAll(cleanupTempDirs);

function evidence(projectDir: string): Evidence {
	return {
		run: {
			code: 0,
			timedOut: false,
			stdout: "",
			stderr: "",
			events: [],
			durationMs: 1,
		} as RunOutput,
		probe: new ProbeLog([]),
		stubRequests: [],
		projectDir,
		mode: "scripted",
	};
}

function filesExpect(files: ScenarioExpect["files"]): ScenarioExpect {
	return { exitCode: 0, noErrors: true, files };
}

describe("files symlink containment", () => {
	test("a symlink escaping the project dir is rejected", () => {
		const dir = tempDir("files-symlink-");
		symlinkSync("/etc", join(dir, "linketc"));
		const failures = evaluate(
			filesExpect([{ path: "linketc/passwd", exists: true }]),
			evidence(dir),
		);
		expect(failures.join("\n")).toMatch(/escapes the project dir/);
	});

	test("a symlink read for content is rejected, not exfiltrated", () => {
		const dir = tempDir("files-symlink-");
		symlinkSync("/etc", join(dir, "linketc"));
		const failures = evaluate(
			filesExpect([{ path: "linketc/hostname", contains: "x" }]),
			evidence(dir),
		);
		expect(failures.join("\n")).toMatch(/escapes the project dir/);
		expect(failures.join("\n")).not.toContain("no such file");
	});

	test("a legit sub/../ path inside the project still passes", () => {
		const dir = tempDir("files-symlink-");
		mkdirSync(join(dir, "sub"), { recursive: true });
		writeFileSync(join(dir, "ok.txt"), "hello");
		const failures = evaluate(
			filesExpect([{ path: "sub/../ok.txt", exists: true }]),
			evidence(dir),
		);
		expect(failures).toEqual([]);
	});

	test("a plain lexical escape is still rejected", () => {
		const dir = tempDir("files-symlink-");
		const failures = evaluate(
			filesExpect([{ path: "../evil.txt", exists: false }]),
			evidence(dir),
		);
		expect(failures.join("\n")).toMatch(/escapes the project dir/);
	});
});
