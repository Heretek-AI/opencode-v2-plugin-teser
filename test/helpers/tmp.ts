// Temp dirs for tests. Call cleanupTempDirs() from an afterAll so a test run
// leaves nothing behind in the OS temp dir.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made: string[] = [];

/** mkdtemp under the OS temp dir; removed by the next cleanupTempDirs(). */
export function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	made.push(dir);
	return dir;
}

export function cleanupTempDirs(): void {
	for (const dir of made.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
}
