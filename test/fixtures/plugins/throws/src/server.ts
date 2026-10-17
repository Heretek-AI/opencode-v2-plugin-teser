// Fixture: setup throws, so tier 1 must fail with "fixture boom" in the
// failure text (the probe inventory reports the plugin as failed).
export default {
	id: "fixture-throws",
	setup: async () => {
		throw new Error("fixture boom");
	},
};
