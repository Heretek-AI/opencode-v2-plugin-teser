// Isolated opencode installation: fresh temp HOME/XDG dirs, a git-initialized
// project dir, and a generated opencode.jsonc. Ported from the
// claude-4-opencode e2e sandbox, minus everything c4o-specific.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseEvents, type RunEvent } from "../opencode/events.ts";

export interface SandboxPlugin {
	package: string;
	options?: Record<string, unknown>;
}

export interface SandboxOptions {
	opencodeBin: string;
	stubUrl?: string;
	liveModel?: string;
	plugins: SandboxPlugin[];
	agents?: Record<string, unknown>;
	workspace?: Record<string, string>;
	env?: Record<string, string>;
	logLevel?: "info" | "all";
	keep?: boolean;
}

export interface RunOutput {
	code: number;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	events: RunEvent[];
	durationMs: number;
}

export interface SandboxRunOptions {
	agent?: string;
	timeoutMs?: number;
	auto?: boolean;
}

function stubProvider(baseURL: string): Record<string, unknown> {
	return {
		stub: {
			name: "Stub",
			package: "@ai-sdk/openai-compatible",
			settings: { baseURL, apiKey: "stub" },
			models: {
				scripted: {
					name: "Scripted",
					capabilities: { tools: true },
					limit: { context: 200000, output: 8000 },
				},
			},
		},
	};
}

function runGitInit(
	project: string,
	env: Record<string, string>,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child: ChildProcess = spawn("git", ["init", "-q"], {
			cwd: project,
			stdio: ["ignore", "pipe", "pipe"],
			env,
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`git init -q exited ${code ?? "unknown"}`));
			}
		});
	});
}

export class Sandbox {
	readonly root: string;
	readonly project: string;
	readonly env: Record<string, string>;
	readonly probeFile: string;
	private readonly opencodeBin: string;
	private readonly logLevel: "info" | "all";
	private readonly keep: boolean;
	private readonly ready: Promise<void>;

	constructor(opts: SandboxOptions) {
		this.root = join(
			tmpdir(),
			`opencode-plugin-ci-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
		);
		this.project = join(this.root, "project");
		const configHome = join(this.root, "config");
		const home = join(this.root, "home");

		mkdirSync(this.project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(join(configHome, "opencode"), { recursive: true });
		mkdirSync(join(this.root, "data"), { recursive: true });
		mkdirSync(join(this.root, "cache"), { recursive: true });
		mkdirSync(join(this.root, "state"), { recursive: true });

		writeFileSync(join(this.project, "README.md"), "# Sandbox project\n");
		for (const [rel, content] of Object.entries(opts.workspace ?? {})) {
			const dest = join(this.project, rel);
			mkdirSync(dirname(dest), { recursive: true });
			writeFileSync(dest, content);
		}

		const gitconfig = join(this.root, "gitconfig");
		writeFileSync(gitconfig, "");

		const config: Record<string, unknown> = {
			model: opts.liveModel ?? "stub/scripted",
			update: "disable",
			share: "disabled",
			plugins: opts.plugins,
		};
		if (opts.stubUrl !== undefined) {
			config["providers"] = stubProvider(opts.stubUrl);
		}
		if (opts.agents !== undefined) {
			config["agents"] = opts.agents;
		}
		writeFileSync(
			join(configHome, "opencode", "opencode.jsonc"),
			JSON.stringify(config, null, 2),
		);

		this.env = {
			PATH: process.env.PATH ?? "",
			TERM: "dumb",
			HOME: home,
			XDG_CONFIG_HOME: configHome,
			XDG_DATA_HOME: join(this.root, "data"),
			XDG_CACHE_HOME: join(this.root, "cache"),
			XDG_STATE_HOME: join(this.root, "state"),
			GIT_CONFIG_GLOBAL: gitconfig,
			OPENCODE_DISABLE_AUTOUPDATE: "1",
			OPENCODE_DISABLE_MODELS_FETCH: "1",
			...opts.env,
		};

		this.opencodeBin = opts.opencodeBin;
		this.logLevel = opts.logLevel ?? "info";
		this.keep = opts.keep ?? false;
		this.probeFile = join(this.root, "probe.jsonl");

		this.ready = runGitInit(this.project, this.env);
	}

	async run(prompt: string, opts?: SandboxRunOptions): Promise<RunOutput> {
		await this.ready;
		const started = Date.now();
		const args = ["run", "--standalone"];
		if (opts?.auto !== false) {
			args.push("--auto");
		}
		args.push("--format", "json", "--print-logs", "--log-level", this.logLevel);
		if (opts?.agent !== undefined) {
			args.push("--agent", opts.agent);
		}
		args.push(prompt);

		const timeoutMs = opts?.timeoutMs ?? 120_000;
		const child: ChildProcess = spawn(this.opencodeBin, args, {
			cwd: this.project,
			stdio: ["ignore", "pipe", "pipe"],
			env: this.env,
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
		}, timeoutMs);

		const code: number = await new Promise((resolve) => {
			child.on("error", () => resolve(-1));
			child.on("close", (exitCode) => resolve(exitCode ?? -1));
		});
		clearTimeout(timer);

		return {
			code,
			timedOut,
			stdout,
			stderr,
			events: parseEvents(stdout),
			durationMs: Date.now() - started,
		};
	}

	async dispose(): Promise<void> {
		if (this.keep || process.env.OPENCODE_PLUGIN_CI_KEEP === "1") {
			return;
		}
		await rm(this.root, { recursive: true, force: true });
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.dispose();
	}
}
