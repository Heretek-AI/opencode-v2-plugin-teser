import { homedir } from "node:os";
import { join } from "node:path";

export interface ResolvedOpencode {
	bin: string;
	version: string;
}

interface Captured {
	code: number;
	stdout: string;
	stderr: string;
}

// Always async: a sync spawn would block the event loop, which hangs opencode
// when the stub model server lives in the same process.
async function runCapture(
	bin: string,
	args: string[],
	cwd?: string,
): Promise<Captured> {
	const proc = Bun.spawn([bin, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout as ReadableStream).text(),
		new Response(proc.stderr as ReadableStream).text(),
	]);
	const code = await proc.exited;
	return { code, stdout, stderr };
}

async function npmViewVersion(): Promise<string> {
	const out = await runCapture("npm", ["view", "@opencode/cli", "version"]);
	if (out.code !== 0) {
		throw new Error(
			`failed to resolve @opencode/cli version: npm view exited ${out.code}: ${out.stderr.trim()}`,
		);
	}
	const resolved = out.stdout.trim();
	if (resolved.length === 0) {
		throw new Error(
			"failed to resolve @opencode/cli version: npm view printed nothing",
		);
	}
	return resolved;
}

async function npmInstall(dir: string, version: string): Promise<void> {
	const out = await runCapture("npm", [
		"install",
		"--no-save",
		"--no-audit",
		"--no-fund",
		"--prefix",
		dir,
		`@opencode/cli@${version}`,
	]);
	if (out.code !== 0) {
		throw new Error(
			`failed to install @opencode/cli@${version} into ${dir}: npm install exited ${out.code}: ${out.stderr.trim()}`,
		);
	}
}

export async function resolveOpencode(
	version: string,
): Promise<ResolvedOpencode> {
	const override = process.env.OPENCODE_BIN;
	if (override !== undefined && override.length > 0) {
		const out = await runCapture(override, ["--version"]);
		const reported = out.stdout.trim() || out.stderr.trim();
		return { bin: override, version: reported };
	}

	const resolved = version === "latest" ? await npmViewVersion() : version;

	const cacheBase = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
	const dir = join(cacheBase, "opencode-plugin-ci", "opencode", resolved);
	const bin = join(dir, "node_modules", ".bin", "opencode");

	if (!(await Bun.file(bin).exists())) {
		await npmInstall(dir, resolved);
	}

	const check = await runCapture(bin, ["--version"]);
	const combined = `${check.stdout}\n${check.stderr}`;
	if (!combined.includes(`v${resolved}`)) {
		throw new Error(
			`opencode binary at ${bin} failed verification: "--version" did not contain "v${resolved}", got: ${check.stdout.trim()}`,
		);
	}
	return { bin, version: resolved };
}
