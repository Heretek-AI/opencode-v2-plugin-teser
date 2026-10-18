// CLI acceptance (e2e, needs OPENCODE_BIN or the dev install at
// review/oc): `run` in tool-basic passes with --scenario filtering and
// writes report.md, `run` in throws exits 1, `validate` in no-entry exits 2.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../bin/opencode-plugin-ci.ts");
const FIXTURES = resolve(import.meta.dir, "../fixtures/plugins");

function opencodeBin(): string {
	return (
		process.env.OPENCODE_BIN ??
		resolve(import.meta.dir, "../../review/oc/node_modules/.bin/opencode")
	);
}

interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
}

async function runCli(args: string[], cwd: string): Promise<CliResult> {
	const proc = Bun.spawn(["bun", CLI, ...args], {
		cwd,
		env: { ...process.env, OPENCODE_BIN: opencodeBin() },
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout as ReadableStream).text(),
		new Response(proc.stderr as ReadableStream).text(),
	]);
	return { code: await proc.exited, stdout, stderr };
}

describe("cli e2e", () => {
	test("run in tool-basic passes and writes report.md", async () => {
		const dir = join(FIXTURES, "tool-basic");
		const { code, stdout, stderr } = await runCli(
			["run", "--scenario", "tool-basic-pass"],
			dir,
		);
		expect(`${stdout}\n${stderr}`).toContain("report.md");
		expect(code).toBe(0);
		expect(existsSync(join(dir, ".opencode-ci/out/results.json"))).toBe(true);
		expect(existsSync(join(dir, ".opencode-ci/out/report.md"))).toBe(true);
	}, 600_000);

	test("run in throws exits 1", async () => {
		const { code } = await runCli(["run"], join(FIXTURES, "throws"));
		expect(code).toBe(1);
	}, 600_000);

	test("validate in no-entry exits 2", async () => {
		const { code, stdout, stderr } = await runCli(
			["validate"],
			join(FIXTURES, "no-entry"),
		);
		expect(code).toBe(2);
		expect(`${stdout}\n${stderr}`).toMatch(/no server entry/i);
	}, 120_000);

	test("validate in tool-basic exits 0", async () => {
		const { code, stdout } = await runCli(
			["validate"],
			join(FIXTURES, "tool-basic"),
		);
		expect(code).toBe(0);
		expect(stdout).toContain("scenarios: 2");
	}, 120_000);
});
