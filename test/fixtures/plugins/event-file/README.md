# fixture-event-file

Proves a plugin can observe `ctx.event.subscribe()` and produce a side effect
on disk: on every `session.tool.called` event it appends to
`.fixture/events.log` in the project directory (`ctx.location.directory`).

- The subscription runs in a background loop; `setup` does not await it.
- `pass.yaml` runs one `shell` call and asserts the log file exists.
