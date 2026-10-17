# fixture-hook-mutate

Proves a plugin can mutate tool inputs in `execute.before`: the hook replaces
`secret` with `[x]` in `shell` commands.

- The `pre` probe records the original input (`contains: secret`); the `post`
  probe records the redacted input (`notContains: secret`).
