# fixture-system-inject

Proves a plugin can extend the system prompt via `session.hook("context")`:
the hook pushes a `{ type: "text", text: "FIXTURE-SYSTEM" }` part.

- `pass.yaml` asserts the first primary stub request's system text contains
  `FIXTURE-SYSTEM` (stub-recorded, so no model is needed).
