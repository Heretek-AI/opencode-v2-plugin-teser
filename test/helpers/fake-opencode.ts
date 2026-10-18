// A stand-in for the `opencode` binary, for orchestration tests that must be
// fast and deterministic. `makeFakeOpencode(dir, plan)` writes the plan and a
// bash wrapper; point `opencodeBin` / OPENCODE_BIN at the wrapper.
//
// The sandbox passes only an allowlisted env to opencode, so the plan path
// travels as an argument baked into the wrapper, never as an env var.
//
// Each `run` invocation consumes the next entry of `plan.runs` (the last
// entry repeats). The number of `run` invocations so far is kept in
// `<plan>.count`, so tests can assert how many runs happened.
import {
	appendFileSync,
	chmodSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface FakeToolCall {
	tool: string;
	input?: unknown;
	result?: unknown;
	status?: "completed" | "error";
}

export interface FakeRun {
	/** Process exit code [0]. */
	exitCode?: number;
	/** Emitted as one `text` event when set. */
	text?: string;
	/** Emitted in one `step_finish` event [0]. */
	cost?: number;
	/** Emits one `error` event with this message when set. */
	error?: string;
	/** Written to stderr verbatim. */
	stderr?: string;
	/** Inventory status of the plugin under test ["active"]. */
	pluginStatus?: "active" | "failed" | "missing";
	/** Inventory tools [[]]. */
	inventoryTools?: string[];
	/** Written as tool.before/tool.after probe records, pre and post. */
	toolCalls?: FakeToolCall[];
}

export interface FakePlan {
	/** Reported by `--version` ["2.0.26"]. */
	version?: string;
	/** Printed one per line by `models` [["opencode/fake-model"]]. */
	models?: string[];
	runs: FakeRun[];
}

/** Write `<dir>/plan.json` and an executable `<dir>/opencode` wrapper; return the wrapper path. */
export function makeFakeOpencode(dir: string, plan: FakePlan): string {
	const planPath = join(dir, "plan.json");
	writeFileSync(planPath, JSON.stringify(plan));
	const wrapper = join(dir, "opencode");
	writeFileSync(
		wrapper,
		`#!/usr/bin/env bash\nexec bun '${import.meta.path}' '${planPath}' "$@"\n`,
	);
	chmodSync(wrapper, 0o755);
	return wrapper;
}

/** How many `run` invocations the fake has served for the plan in `dir`. */
export function fakeRunCount(dir: string): number {
	const file = join(dir, "plan.json.count");
	return existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;
}

function main(): number {
	const [planPath, command, ...rest] = process.argv.slice(2);
	if (planPath === undefined) {
		return 2;
	}
	const plan = JSON.parse(readFileSync(planPath, "utf8")) as FakePlan;
	if (command === "--version") {
		console.log(`opencode v${plan.version ?? "2.0.26"}`);
		return 0;
	}
	if (command === "models") {
		console.log((plan.models ?? ["opencode/fake-model"]).join("\n"));
		return 0;
	}
	if (command !== "run") {
		console.error(
			`fake opencode: unsupported command ${command} ${rest.join(" ")}`,
		);
		return 2;
	}

	const countFile = `${planPath}.count`;
	const n = existsSync(countFile) ? Number(readFileSync(countFile, "utf8")) : 0;
	writeFileSync(countFile, String(n + 1));
	const run = plan.runs[Math.min(n, plan.runs.length - 1)] ?? {};

	// The sandbox writes JSON (not JSONC) to this path, so JSON.parse works.
	const configFile = join(
		process.env.XDG_CONFIG_HOME ?? "",
		"opencode",
		"opencode.jsonc",
	);
	const config = JSON.parse(readFileSync(configFile, "utf8")) as {
		plugins?: { package: string; options?: Record<string, unknown> }[];
	};
	const plugins = config.plugins ?? [];
	const probeOut = plugins.find((p) => typeof p.options?.out === "string")
		?.options?.out as string | undefined;
	const underTest = plugins.find((p) =>
		p.package.endsWith("/plugin-under-test"),
	);

	if (probeOut !== undefined) {
		let seq = 0;
		const write = (record: Record<string, unknown>): void => {
			appendFileSync(
				probeOut,
				`${JSON.stringify({ ...record, seq: seq++, t: Date.now() })}\n`,
			);
		};

		(run.toolCalls ?? []).forEach((call, index) => {
			for (const phase of ["pre", "post"]) {
				write({
					kind: "tool.before",
					phase,
					tool: call.tool,
					callID: `call-${index}`,
					input: call.input ?? {},
				});
			}
			for (const phase of ["pre", "post"]) {
				write({
					kind: "tool.after",
					phase,
					tool: call.tool,
					callID: `call-${index}`,
					status: call.status ?? "completed",
					input: call.input ?? {},
					result: call.result ?? { content: "" },
				});
			}
		});
		const status = run.pluginStatus ?? "active";
		write({
			kind: "inventory",
			phase: "post",
			plugins:
				underTest === undefined || status === "missing"
					? []
					: [
							{
								id: "fixture-under-test",
								source: {
									type: "local",
									path: `${underTest.package}/server.js`,
								},
								status,
								error:
									status === "failed" ? "Error: fake setup failure" : undefined,
							},
						],
			tools: run.inventoryTools ?? [],
			commands: [],
			agents: [],
			skills: [],
			mcp: [],
		});
	}

	if (run.text !== undefined) {
		console.log(
			JSON.stringify({ type: "text", part: { type: "text", text: run.text } }),
		);
	}
	console.log(
		JSON.stringify({
			type: "step_finish",
			part: {
				type: "step-finish",
				reason: "stop",
				cost: run.cost ?? 0,
				tokens: {
					input: 10,
					output: 5,
					reasoning: 0,
					cache: { read: 0, write: 0 },
				},
			},
		}),
	);
	if (run.error !== undefined) {
		console.log(
			JSON.stringify({
				type: "error",
				error: { type: "fake", message: run.error },
			}),
		);
	}
	if (run.stderr !== undefined) {
		process.stderr.write(run.stderr);
	}
	return run.exitCode ?? 0;
}

if (import.meta.main) {
	process.exit(main());
}
