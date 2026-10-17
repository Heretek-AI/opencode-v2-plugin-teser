// Write the shim directory that makes opencode load the real plugin file.
//
// opencode only loads <dir>/server.{ts,js} from a local plugin directory
// and ignores package.json, so a plugin whose entry lives elsewhere (e.g.
// src/server.ts via exports) would be silently skipped. The shim is a fresh
// directory containing only server.js with:
//   export { default } from "<file:// URL of the real entry>"
// opencode loads the real module, and the real file's own node_modules
// still resolve because the file itself never moves.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Create `<root>/plugin-under-test/server.js` re-exporting `serverEntry`
 * and return the shim directory. `pathToFileURL` keeps spaces and Windows
 * paths safe.
 */
export function writeShim(root: string, serverEntry: string): string {
	const dir = join(root, "plugin-under-test");
	mkdirSync(dir, { recursive: true });
	const content = `export { default } from "${pathToFileURL(serverEntry).href}";`;
	writeFileSync(join(dir, "server.js"), content);
	return dir;
}
