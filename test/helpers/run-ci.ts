// Shared setup for tests that drive `runCi` with the fake opencode binary.
// Call isolateCiEnv() once at the top of a test file.
import { afterAll, afterEach, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FakeRun, makeFakeOpencode } from "./fake-opencode.ts";
import { cleanupTempDirs, tempDir } from "./tmp.ts";

/** The smallest plugin opencode will activate. */
export const PLUGIN_JS =
	'export default { id: "fixture-run", setup: async () => {} };\n';

/** Write a throwaway plugin repo; `files` maps relative paths to contents. */
export function makePlugin(files: Record<string, string>): string {
	const dir = tempDir("run-plugin-");
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}
	return dir;
}

/** Point OPENCODE_BIN at a fresh fake; returns the fake's directory. */
export function useFake(runs: FakeRun[]): string {
	const dir = tempDir("run-fake-");
	process.env.OPENCODE_BIN = makeFakeOpencode(dir, { runs });
	return dir;
}

const SAVED = [
	"OPENCODE_BIN",
	"OPENCODE_API_KEY",
	"GITHUB_ACTIONS",
	"GITHUB_STEP_SUMMARY",
] as const;

/**
 * Save and restore the env vars runCi reads, and clear the CI ones for each
 * test: with GITHUB_ACTIONS set the gate could run, and with
 * GITHUB_STEP_SUMMARY set the report would be appended to the real summary.
 */
export function isolateCiEnv(): void {
	let saved: Record<string, string | undefined> = {};
	beforeEach(() => {
		saved = Object.fromEntries(SAVED.map((name) => [name, process.env[name]]));
		delete process.env.GITHUB_ACTIONS;
		delete process.env.GITHUB_STEP_SUMMARY;
		delete process.env.OPENCODE_API_KEY;
	});
	afterEach(() => {
		for (const name of SAVED) {
			if (saved[name] === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = saved[name];
			}
		}
	});
	afterAll(cleanupTempDirs);
}
