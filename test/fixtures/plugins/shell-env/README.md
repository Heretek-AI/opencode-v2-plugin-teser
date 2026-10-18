# fixture-shell-env

Proves a plugin can inject environment variables via
`shell.hook("create.before")`: every spawned shell sees `FIXTURE_ON=1`.

- `pass.yaml` asserts the post probe's `shell.before` record has
  `FIXTURE_ON equals 1` and that running `echo FIXTURE_ON=$FIXTURE_ON`
  outputs `FIXTURE_ON=1`.
