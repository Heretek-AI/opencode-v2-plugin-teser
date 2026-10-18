// Fixture: subscribes to session events in a background loop (never awaited
// in setup, or setup would never return) and appends a line to
// .fixture/events.log in the project directory on every session.tool.called.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export default {
	id: "fixture-event-file",
	setup: async (ctx) => {
		const directory = ctx.location.directory;
		void (async () => {
			try {
				for await (const event of ctx.event.subscribe()) {
					if (event?.type === "session.tool.called") {
						mkdirSync(join(directory, ".fixture"), { recursive: true });
						appendFileSync(
							join(directory, ".fixture", "events.log"),
							`${JSON.stringify({ type: event.type, at: Date.now() })}\n`,
						);
					}
				}
			} catch {
				// The event stream ends when the run ends; nothing to do.
			}
		})();
	},
};
