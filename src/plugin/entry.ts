// Resolve the server/TUI entry files of an opencode plugin directory.
//
// Server order (first existing file wins):
//  1. `explicit` (joined to pluginPath),
//  2. package.json exports["./server"], then exports["."],
//  3. package.json main,
//  4. server.ts/js/mjs,
//  5. index.ts/js/mjs.
// TUI order: exports["./tui"], then tui.ts/js/mjs.
//
// opencode itself only loads server.*/index.* from a directory and ignores
// package.json, so steps 2-3 exist only so the shim can point at the real
// file (e.g. fixtures keep their entry under src/ via exports).
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { ConfigError } from "../config/load.ts";

export interface Entries {
	server?: string;
	tui?: string;
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * Pick a file target out of an exports entry. The entry may be a plain
 * string or a conditions object; conditions are tried in the order
 * `import ?? default ?? bun ?? node`. Nested objects (e.g. a value of
 * `{ ".": { import: "./x.js" } }`) are searched recursively.
 */
export function pickExportTarget(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	for (const key of ["import", "default", "bun", "node"]) {
		const candidate = record[key];
		if (typeof candidate === "string") {
			return candidate;
		}
	}
	// Nested condition maps, e.g. { ".": { import: "./x.js" } }.
	// Prefer the "." subpath, then fall back to any nested value.
	if ("." in record) {
		const nested = pickExportTarget(record["."]);
		if (nested !== undefined) {
			return nested;
		}
	}
	for (const candidate of Object.values(record)) {
		const nested = pickExportTarget(candidate);
		if (nested !== undefined) {
			return nested;
		}
	}
	return undefined;
}

interface PackageJson {
	exports?: unknown;
	main?: unknown;
}

function readPackageJson(pluginPath: string): PackageJson | undefined {
	const file = join(pluginPath, "package.json");
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object") {
			return undefined;
		}
		return parsed as PackageJson;
	} catch {
		// Invalid package.json: skip to the plain file checks below.
		return undefined;
	}
}

/** Join a package.json target to the plugin dir (absolute targets pass through). */
function joinTarget(pluginPath: string, target: string): string {
	if (isAbsolute(target)) {
		return target;
	}
	return resolve(pluginPath, target);
}

function firstExisting(candidates: string[]): string | undefined {
	for (const candidate of candidates) {
		if (isFile(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function exportsOf(pkg: PackageJson | undefined): Record<string, unknown> {
	if (pkg?.exports === null || typeof pkg?.exports !== "object") {
		return {};
	}
	if (Array.isArray(pkg.exports)) {
		return {};
	}
	return pkg.exports as Record<string, unknown>;
}

function serverFromExports(pkg: PackageJson | undefined): string | undefined {
	const exports = exportsOf(pkg);
	// exports["./server"] wins over exports["."]. A bare-string exports map
	// (e.g. { ".": "./index.js" }) and conditions objects both work via
	// pickExportTarget, which also accepts a top-level string.
	for (const key of ["./server", "."]) {
		if (key in exports) {
			const target = pickExportTarget(exports[key]);
			if (target !== undefined) {
				return target;
			}
		}
	}
	if (typeof pkg?.exports === "string") {
		return pkg.exports;
	}
	return undefined;
}

function tuiFromExports(pkg: PackageJson | undefined): string | undefined {
	const exports = exportsOf(pkg);
	if ("./tui" in exports) {
		return pickExportTarget(exports["./tui"]);
	}
	return undefined;
}

const SERVER_FILES = [
	"server.ts",
	"server.js",
	"server.mjs",
	"index.ts",
	"index.js",
	"index.mjs",
];

const TUI_FILES = ["tui.ts", "tui.js", "tui.mjs"];

/**
 * Resolve absolute server/tui entry paths. An explicit entry is joined to
 * pluginPath; when it names an existing file it wins, otherwise resolution
 * falls through to the default order (so a typo surfaces as "no entry"
 * instead of a crash). Paths that resolve to nothing are left undefined.
 */
export function resolveEntries(pluginPath: string, explicit?: string): Entries {
	const entries: Entries = {};
	const abs = (p: string): string =>
		isAbsolute(p) ? p : resolve(pluginPath, p);

	if (explicit !== undefined && explicit.length > 0) {
		const candidate = abs(explicit);
		if (isFile(candidate)) {
			entries.server = candidate;
			return entries;
		}
		// Fall through: the explicit path names nothing, so keep looking
		// and let the caller report "no server entry" with full context.
	}

	const pkg = readPackageJson(pluginPath);

	const serverTarget = serverFromExports(pkg);
	if (serverTarget !== undefined) {
		const candidate = joinTarget(pluginPath, serverTarget);
		if (isFile(candidate)) {
			entries.server = candidate;
		}
	}
	if (entries.server === undefined && typeof pkg?.main === "string") {
		const candidate = joinTarget(pluginPath, pkg.main);
		if (isFile(candidate)) {
			entries.server = candidate;
		}
	}
	if (entries.server === undefined) {
		const found = firstExisting(
			SERVER_FILES.map((name) => join(pluginPath, name)),
		);
		if (found !== undefined) {
			entries.server = resolve(pluginPath, found);
		}
	}

	const tuiTarget = tuiFromExports(pkg);
	if (tuiTarget !== undefined) {
		const candidate = joinTarget(pluginPath, tuiTarget);
		if (isFile(candidate)) {
			entries.tui = candidate;
		}
	}
	if (entries.tui === undefined) {
		const found = firstExisting(
			TUI_FILES.map((name) => join(pluginPath, name)),
		);
		if (found !== undefined) {
			entries.tui = resolve(pluginPath, found);
		}
	}

	return entries;
}

/**
 * Resolve entries and fail closed: when neither a server nor a TUI entry
 * exists, throw ConfigError (the CLI maps it to exit 2).
 */
export function ensureEntriesOrThrow(
	pluginPath: string,
	explicit?: string,
): Entries {
	const entries = resolveEntries(pluginPath, explicit);
	if (entries.server === undefined && entries.tui === undefined) {
		const hint =
			explicit !== undefined
				? ` (explicit entry ${JSON.stringify(explicit)} names no file)`
				: "";
		throw new ConfigError(
			`No server entry (and no TUI entry) found under ${pluginPath}${hint}: ` +
				`looked for package.json exports["./server"]/["."], main, ` +
				`then server.{ts,js,mjs} and index.{ts,js,mjs} for the server, ` +
				`and exports["./tui"] then tui.{ts,js,mjs} for the TUI.`,
		);
	}
	return entries;
}
