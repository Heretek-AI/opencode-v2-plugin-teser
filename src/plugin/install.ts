// Run a plugin's install/build shell step before any tier runs.
import { type ChildProcess, spawn } from "node:child_process";

/** A plugin install/build command failed: the plugin's failure (exit 1), not a config error. */
export class StepError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StepError";
	}
}

/**
 * Run `command` in `cwd` via the platform shell (bash -lc on POSIX,
 * cmd /c on Windows) with async spawn, streaming the child's output to
 * our own stdout/stderr. Never sync-spawn: the stub model server lives in
 * this process during tier runs. Throws StepError (exit 1 upstream) when
 * the command fails.
 */
export function runStep(
	name: string,
	command: string,
	cwd: string,
): Promise<void> {
	const shell = process.platform === "win32" ? "cmd" : "bash";
	const args =
		process.platform === "win32" ? ["/c", command] : ["-lc", command];
	return new Promise((resolvePromise, reject) => {
		let child: ChildProcess;
		try {
			child = spawn(shell, args, {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			reject(
				new StepError(
					`${name} step failed to start (${command}): ${String(error)}`,
				),
			);
			return;
		}
		child.stdout?.on("data", (chunk: Buffer) => {
			process.stdout.write(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			process.stderr.write(chunk);
		});
		child.on("error", (error) => {
			reject(
				new StepError(`${name} step failed to start (${command}): ${error}`),
			);
		});
		child.on("close", (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			const detail =
				signal !== null && signal !== undefined
					? `signal ${signal}`
					: `exit code ${code ?? "unknown"}`;
			reject(new StepError(`${name} step failed (${command}): ${detail}.`));
		});
	});
}
