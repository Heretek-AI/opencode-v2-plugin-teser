// rows(): normalize `[]` or `{ data: [] }` to an array. Probe inventory
// lists and opencode client lists come back in either shape depending on
// the domain, so every consumer normalizes through here instead of
// assuming one form.
export function rows<T>(json: unknown): T[] {
	if (Array.isArray(json)) {
		return json as T[];
	}
	if (json !== null && typeof json === "object") {
		const data = (json as { data?: unknown }).data;
		if (Array.isArray(data)) {
			return data as T[];
		}
	}
	return [];
}
