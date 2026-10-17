// Tier 1 for TUI-only plugins: statically import the TUI entry in a child
// process and check the default export looks like a plugin
// ({ id: string, setup: function }). No opencode run is involved.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError } from "../config/load.ts";
import { resolveEntries } from "../plugin/entry.ts";
import type { CaseResult } from "../report/results.ts";

export interface RunUiStaticOptions {
	pluginPath: string;
	outDir: string;
	version: string;
}

interface StaticVerdict {
	ok: boolean;
	id?: string;
	error?: string;
}

/**
 * Import the TUI entry with `bun -e` (cwd = the plugin path, so the
 * plugin's own node_modules resolve) and verify the default export has a
 * string id and a setup function. 30 s timeout; anything else is a failure.
 */
export async function runUiStatic(
	opts: RunUiStaticOptions,
): Promise<CaseResult> {
	const started = Date.now();
	const pluginPath = resolve(opts.pluginPath);
	const entries = resolveEntries(pluginPath);
	if (entries.tui === undefined) {
		throw new ConfigError(
			`No TUI entry found under ${pluginPath}: looked for ` +
				`package.json exports["./tui"], then tui.{ts,js,mjs}.`,
		);
	}
	const target = JSON.stringify(pathToFileURL(entries.tui).href);
	const code = [
		`const m = await import(${target});`,
		`const d = m == null ? undefined : m.default;`,
		`const ok = typeof (d == null ? undefined : d.id) === "string" && typeof (d == null ? undefined : d.setup) === "function";`,
		`console.log(JSON.stringify({ ok, id: typeof (d == null ? undefined : d.id) === "string" ? d.id : undefined, error: ok ? undefined : "default export must be { id: string, setup: function }" }));`,
		`if (!ok) process.exitCode = 1;`,
	].join("\n");

	const evidenceDir = resolve(opts.outDir, opts.version, "load");
	mkdirSync(evidenceDir, { recursive: true });

	const child: ChildProcess = spawn("bun", ["-e", code], {
		cwd: pluginPath,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env },
	});
	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, 30_000);
	const exitCode: number = await new Promise((resolveExit) => {
		child.on("error", () => resolveExit(-1));
		child.on("close", (code) => resolveExit(code ?? -1));
	});
	clearTimeout(timer);

	writeFileSync(join(evidenceDir, "ui-static-stdout.log"), stdout);
	writeFileSync(join(evidenceDir, "ui-static-stderr.log"), stderr);

	const failures: string[] = [];
	if (timedOut) {
		failures.push("static TUI import timed out after 30s.");
	} else if (exitCode !== 0) {
		let verdict: StaticVerdict | undefined;
		for (const line of stdout.trim().split("\n").reverse()) {
			try {
				const parsed: unknown = JSON.parse(line.trim());
				if (parsed !== null && typeof parsed === "object") {
					verdict = parsed as StaticVerdict;
					break;
				}
			} catch {
				// Not JSON: keep scanning earlier lines.
			}
		}
		const detail =
			verdict?.error ??
			(stderr.trim().split("\n").slice(-3).join("\n") || "unknown error");
		failures.push(`static TUI import failed: ${detail}`);
	}

	return {
		id: "load",
		tier: "load",
		opencode: opts.version,
		pass: failures.length === 0,
		failures: failures.length > 0 ? failures : undefined,
		steps: 0,
		durationMs: Date.now() - started,
		textExcerpt: stdout.slice(0, 300),
		kept: evidenceDir,
	};
}
