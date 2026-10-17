// Deliberately NOT an entry point: there is no server.*/index.* at the
// plugin root and package.json has no exports or main, so the entry
// resolver must report "no server entry".
export function helper(): string {
	return "not an entry";
}
