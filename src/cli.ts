const USAGE = `opencode-plugin-ci

Usage:
  opencode-plugin-ci --version
  opencode-plugin-ci --help
`;

async function readVersion(): Promise<string> {
	const pkgUrl = new URL("../package.json", import.meta.url);
	const file = Bun.file(pkgUrl);
	const pkg = (await file.json()) as { version?: string };
	if (typeof pkg.version !== "string" || pkg.version.length === 0) {
		throw new Error("package.json has no version");
	}
	return pkg.version;
}

export async function main(argv: string[]): Promise<number> {
	if (argv.includes("--version")) {
		console.log(await readVersion());
		return 0;
	}
	if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
		console.log(USAGE);
		return 0;
	}
	console.error(`Unknown arguments: ${argv.join(" ")}\n`);
	console.error(USAGE);
	return 2;
}
