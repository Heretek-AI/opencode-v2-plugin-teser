// Fixture: a TUI-only plugin (no server entry). Static tier 1 imports this
// module and checks the default export has a string id and a setup function;
// tiers 2 and 3 are reported skipped.
export default {
	id: "fixture-tui",
	setup() {},
};
