# Commands

- [Introduction](#introduction)
- [Listing Commands](#listing-commands)
- [HTTP Server Commands](#http-server-commands)
- [make Generators](#make-generators)
- [Database Migration Commands](#database-migration-commands)
- [Queue Commands](#queue-commands)
- [Scheduler Command](#scheduler-command)
- [Key and Stub Commands](#key-and-stub-commands)

## Introduction

A PrismGo application's `main.go` passes `os.Args` to `app.HandleCommand`. In the project root, commands are usually run with `go run .`:

```bash
go run . list
go run . serve
go run . migrate
```

If you use a compiled binary, replace `go run .` with your binary name.

## Listing Commands

| Command | Description |
| --- | --- |
| `go run . list` | List all available commands |
| `go run . list make` | Filter by namespace |
| `go run . list --format=json` | Output JSON |
| `go run . list --format=md` | Output Markdown |
| `go run . list --raw` | Print raw command names only |
| `go run . help migrate` | Show help for one command |

## HTTP Server Commands

`serve` starts or controls the built-in HTTP server. See [HTTP Server](http-server.md) for configuration.

| Command | Description |
| --- | --- |
| `go run . serve` | Start the HTTP server from `.env` / `config/app.go` |
| `go run . serve --port=8000` | Temporarily override the listen port |
| `go run . serve --reload` | Start a new process, then gracefully stop the old one |
| `go run . serve --restart` | Kill the old process, then start a new one |
| `go run . serve --stop` | Gracefully stop the server on the current port |
| `go run . serve --kill` | Force stop the server on the current port |

## make Generators

PrismGo provides Laravel-style `make:*` commands. All generators support:

| Option | Description |
| --- | --- |
| `{name}` | Artifact name, optionally nested, such as `Admin/UserController` |
| `--force` | Overwrite an existing file |
| `--fullpath` | Print an absolute path |

### Generator List

| Command | Default Directory | Description |
| --- | --- | --- |
| `make:command` | `app/cmd` | Create a Console command |
| `make:controller` | `app/http/controllers` | Create an HTTP controller |
| `make:event` | `app/events` | Create an event |
| `make:job` | `app/jobs` | Create a queued job |
| `make:listener` | `app/listeners` | Create an event listener |
| `make:middleware` | `app/http/middleware` | Create Gin middleware |
| `make:migration` | `database/migrations` | Create a migration |
| `make:model` | `app/models` | Create a GORM model |
| `make:provider` | `app/providers` | Create a service provider |
| `make:resource` | `app/http/resources` | Create an API resource transformer |
| `make:seeder` | `database/seeders` | Create a seeder |

### Common Examples

```bash
go run . make:controller UserController
go run . make:model User --migration --controller --resource
go run . make:job SendWelcomeEmail
go run . make:listener SendWelcomeEmail --queued --event=UserRegistered
go run . make:provider BillingServiceProvider
```

`make:model` can create related artifacts:

| Option | Description |
| --- | --- |
| `-m, --migration` | Also create a `create_<model>s_table` migration |
| `-c, --controller` | Also create a controller |
| `-r, --resource` | Also create an API resource |
| `-s, --seeder` / `--seed` | Also create a seeder |
| `--api` | Create an API controller; also creates a controller if `--controller` is not set |
| `--table=` | Pass a table-name hint into the generation flow |

`make:model` currently rejects `--factory`, `--policy`, `--requests`, `--all`, `--test`, `--pest`, `--pivot`, and `--morph-pivot`.

`make:controller` supports:

| Option | Description |
| --- | --- |
| `-m, --model=` | Add a model TODO to the generated file; imports are not inferred |
| `--api` | Generate an API-style controller |
| `-r, --resource` | Generate a resource-style controller |

`make:command` supports:

| Option | Description |
| --- | --- |
| `--command=` | Override the generated command signature |

Example:

```bash
go run . make:command Report/DailyReportCommand --command=report:daily
```

`make:listener` supports:

| Option | Description |
| --- | --- |
| `--queued` | Generate a queued listener |
| `--async` | Generate an async listener |
| `--event=` | Write an event hint into the generated file |

`--queued` and `--async` are mutually exclusive.

`make:migration` supports:

| Option | Description |
| --- | --- |
| `--create=` | Generate a create-table migration and set the table name |
| `--table=` | Generate an alter-table migration and set the table name |
| `--path=` | Use a custom migration directory |
| `--realpath` | Allow `--path` to be an absolute path |

```bash
go run . make:migration create_users_table --create=users
go run . make:migration add_avatar_to_users_table --table=users
```

When `--create` or `--table` is omitted, the generator infers intent from the migration name.

### Custom Generator Stubs

Publish the built-in stubs:

```bash
go run . stub:publish
```

Generators prefer project stubs under `stubs/*.stub`. Existing files are skipped by default; use `--force` to overwrite:

```bash
go run . stub:publish --force
```

## Database Migration Commands

Migration commands scan the migration paths registered in `bootstrap/app.go`. New applications import `database/migrations` by default.

| Command | Description |
| --- | --- |
| `go run . migrate` | Run pending migrations |
| `go run . migrate:install` | Create the migration metadata table |
| `go run . migrate:status` | Show migration status |
| `go run . migrate:rollback` | Roll back the latest batch |
| `go run . migrate:reset` | Roll back all migrations |
| `go run . migrate:refresh` | Roll back and re-run migrations |
| `go run . migrate:fresh` | Drop all tables and re-run migrations |
| `go run . db:seed` | Run a seeder |

Common options:

| Option | Commands | Description |
| --- | --- | --- |
| `--database=` | All migration commands, `db:seed` | Use a specific database connection |
| `--force` | Commands that modify data | Allow running in production |
| `--path=*` | Migration commands | Migration file directories; may be repeated |
| `--realpath` | Migration commands | Treat `--path` as an absolute path |
| `--pretend` | `migrate`, rollback/reset/refresh | Print operations without changing data |
| `--seed` | `migrate`, refresh/fresh | Run seeders after migrations |
| `--seeder=` | `migrate`, refresh/fresh | Root seeder class |
| `--step` | `migrate` | Put each migration in its own batch |
| `--step=` | rollback/refresh | Roll back a specific number of migrations |
| `--batch=` | rollback | Roll back a specific batch |
| `--drop-views` | fresh | Drop views |
| `--drop-types` | fresh | Drop Postgres enum/type objects |
| `--class=` | `db:seed` | Seeder class |

Production protection is driven by `app.env` / `APP_ENV`. In production, commands that modify data require `--force`.

SQLite requires the `github.com/prismgo/sqlite` extension to be installed and registered first. `migrate:fresh` delegates object removal to the active Dialector: for SQLite it drops views when `--drop-views` is supplied, drops all user tables, and then runs migrations. The command and its options are otherwise the same as for MySQL.

## Queue Commands

| Command | Description |
| --- | --- |
| `go run . queue` | Start a queue worker |
| `go run . queue:work` | Alias for `queue` |
| `go run . queue:failed` | List failed jobs |
| `go run . queue:retry <id...>` | Retry failed jobs |
| `go run . queue:forget <id>` | Delete one failed job |
| `go run . queue:flush` | Delete all failed jobs |
| `go run . queue:restart` | Ask workers to restart gracefully |

Worker options:

| Option | Default | Description |
| --- | --- | --- |
| `{connection?}` | `queue.default` | Queue connection |
| `--queue=` | `default` | Queue names, comma-separated |
| `--once` | `false` | Process one job |
| `--stop-when-empty` | `false` | Exit when queues are empty |
| `--sleep=` | `3` | Sleep seconds when queues are empty |
| `--timeout=` | `60` | Per-job timeout seconds |
| `--tries=` | `1` | Maximum attempts |
| `--backoff=` | `0` | Retry backoff seconds, comma-separated |
| `--max-jobs=` | `0` | Exit after N jobs; `0` means unlimited |
| `--max-time=` | `0` | Exit after N seconds; `0` means unlimited |
| `--retry-after=` | `90` | Redis reserved-job visibility timeout |

## Scheduler Command

```bash
go run . cron
```

`cron` registers the `r.Schedules(...)` callback from `bootstrap/app.go` and runs until the application context closes or the process receives `SIGINT` / `SIGTERM`.

## Key and Stub Commands

Generate an application key:

```bash
go run . key:generate
```

| Option | Description |
| --- | --- |
| `--show` | Print a new key without editing `.env` |
| `--force` | Overwrite an existing `APP_KEY` |

`key:generate` creates a `base64:` value containing 32 random bytes and writes it to the `APP_KEY=` line in `.env`. See [Encryption](encryption.md).

