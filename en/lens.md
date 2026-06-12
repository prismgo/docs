# Prismgo Lens

- [Overview](#overview)
- [Installation](#installation)
  - [Quick Install](#quick-install)
  - [Interactive Install Wizard](#interactive-install-wizard)
  - [Non-Interactive Install](#non-interactive-install)
  - [Configuration Files](#configuration-files)
- [Supported Agents](#supported-agents)
- [Command Reference](#command-reference)
  - [install](#install)
  - [update](#update)
  - [doctor](#doctor)
  - [mcp](#mcp)
  - [execute-tool](#execute-tool)
  - [browser-proxy](#browser-proxy)
  - [list-skills](#list-skills)
  - [add-skill](#add-skill)
- [MCP Tools](#mcp-tools)
  - [application-info](#application-info)
  - [search-docs](#search-docs)
  - [database-connections](#database-connections)
  - [database-schema](#database-schema)
  - [database-query](#database-query)
  - [run-diagnostic](#run-diagnostic)
  - [get-config](#get-config)
  - [list-available-config-keys](#list-available-config-keys)
  - [list-routes](#list-routes)
  - [list-console-commands](#list-console-commands)
  - [get-absolute-url](#get-absolute-url)
  - [get-env](#get-env)
  - [read-log-entries](#read-log-entries)
  - [last-error](#last-error)
  - [browser-logs](#browser-logs)
- [MCP Resources](#mcp-resources)
- [MCP Prompts](#mcp-prompts)
- [Skill System](#skill-system)
  - [Built-in Skills](#built-in-skills)
  - [Installing Skills](#installing-skills)
  - [Skill Auditing](#skill-auditing)
- [Package Assets](#package-assets)
- [Safety Boundaries](#safety-boundaries)

---

Prismgo Lens is a **development-only helper** for PrismGo projects. It provides AI coding agents (Claude Code, Cursor, GitHub Copilot, Codex, etc.) with project context awareness — the ability to read configuration, routes, database schema, logs, and more at runtime, so the agent can make precise, informed development decisions.

> **Important**: Prismgo Lens is purely a dev tool. It is not imported into production builds and has zero impact on production performance.

---

## Installation

### Quick Install

Install the Prismgo Lens CLI:

```bash
go install github.com/prismgo/lens/cmd/prismgo-lens@latest
```

Run from a PrismGo project root:

```bash
prismgo-lens install
```

This command automatically:
1. Detects Agent configs present in the project (e.g. `.claude/skills`, `.cursor/rules`)
2. Writes `.prismgo-lens.json` (team-shareable config) and `.prismgo-lens.local.json` (machine-local state)
3. Installs guidelines to `.ai/guidelines`
4. Installs skills to `.ai/skills` and syncs to each Agent's skills directory
5. Merges MCP server config into each Agent's MCP configuration file
6. Adds the Lens binary directory to the user PATH when needed

### Interactive Install Wizard

```bash
prismgo-lens install --interactive
```

The wizard walks you through:
- Which Agents to configure
- Which features to enable (guidelines, skills, MCP, browser-logs, GitHub docs provider)
- Whether to enforce tests
- Which third-party package AI assets to select

### Non-Interactive Install

```bash
# Install guidelines and MCP for Codex only
prismgo-lens install --no-interaction \
  --agent codex --guidelines --mcp

# Install everything for a specific Agent
prismgo-lens install --no-interaction \
  --agent claude_code --guidelines --skills --mcp --browser-logs

# Install with a third-party module's AI assets
prismgo-lens install --no-interaction \
  --agent cursor --package-module github.com/prismgo/framework
```

### Dry Run (Preview Without Writing)

```bash
prismgo-lens install --dry-run --no-interaction
```

Example output:
```
Dry run: true
Project: /www/wwwroot/work/workorder
Agents: claude_code, codex
Features: guidelines, skills, mcp, browser-logs
PATH fix: enabled
Enforce tests: true
Will write:
  - .prismgo-lens.json
  - .prismgo-lens.local.json
  - .ai guidelines
  - .ai/skills and selected Agent skills directories
  - Agent MCP config
```

### Configuration Files

| File | Purpose | Commit? |
|------|---------|---------|
| `.prismgo-lens.json` | Team-shareable config: features, Agents, MCP filters, selected package modules | Yes |
| `.prismgo-lens.local.json` | Machine-local state: absolute project root, detected agents | No (`.gitignore`) |

Example `.prismgo-lens.json`:
```json
{
  "version": 1,
  "agents": ["claude_code", "cursor"],
  "features": {
    "guidelines": true,
    "skills": true,
    "mcp": true,
    "browser_logs": true,
    "github_docs_provider": false
  },
  "selected_package_modules": ["github.com/prismgo/framework"],
  "enforce_tests": true,
  "mcp": {
    "tools": {
      "exclude": ["browser-logs"]
    }
  },
  "updated_at": "2026-06-05T10:00:00Z"
}
```

---

## Supported Agents

Prismgo Lens auto-detects and adapts to the following Agents' config formats:

| Agent | Identifier | Guidelines Path | Skills Path | MCP Config File |
|-------|-----------|-----------------|-------------|-----------------|
| Codex | `codex` | `AGENTS.md` | `.agents/skills` | `.codex/config.toml` |
| Claude Code | `claude_code` | `CLAUDE.md` | `.claude/skills` | `.mcp.json` |
| Cursor | `cursor` | `.cursor/rules/prismgo-lens.md` | `.cursor/skills` | `.cursor/mcp.json` |
| GitHub Copilot | `copilot` | `.github/copilot-instructions.md` | `.github/skills` | `.vscode/mcp.json` |
| OpenCode | `opencode` | `AGENTS.md` | `.opencode/skills` | `.opencode.json` |
| Kiro | `kiro` | `.kiro/steering/prismgo-lens.md` | `.kiro/skills` | `.kiro/settings/mcp.json` |
| Junie | `junie` | `.junie/guidelines.md` | `.junie/skills` | `.junie/mcp.json` |

**Custom Agents**: Register custom Agent paths and strategies in `.prismgo-lens.json` under `custom_agents`.

---

## Command Reference

### install

Install guidelines, skills, and MCP config into the project and configured Agents.

```bash
# Interactive install (recommended first time)
prismgo-lens install --interactive

# Specify Agents and features
prismgo-lens install --no-interaction \
  --agent claude_code --guidelines --skills --mcp

# Preview without writing files
prismgo-lens install --dry-run
```

**Available options:**

| Option | Description |
|--------|-------------|
| `--project PATH` | Specify the project root directory |
| `--agent NAME` | Specify an Agent (repeatable) |
| `--guidelines` | Enable guidelines |
| `--skills` | Enable skills |
| `--mcp` | Enable MCP config |
| `--browser-logs` | Enable browser logs |
| `--github-docs-provider` | Enable GitHub docs provider |
| `--package-module MODULE` | Select a third-party package module (repeatable) |
| `--enforce-tests` / `--no-enforce-tests` | Whether to enforce tests |
| `--no-fix-path` | Do not update the user PATH during install |
| `--mcp-command auto\|name\|absolute` | Choose how Agent MCP config launches Prismgo Lens |
| `--interactive` | Launch the interactive wizard |
| `--no-interaction` | Skip interactive prompts |
| `--dry-run` | Preview only, write no files |

### update

Resync all installed content from `.prismgo-lens.json`.

```bash
# Resync everything
prismgo-lens update

# Preview update, exclude skills
prismgo-lens update --dry-run --ignore-skills

# Update and show discovered package assets
prismgo-lens update --discover
```

### doctor

Report the detected project root, executable command, current PATH status, and installation warnings.

```bash
prismgo-lens doctor
```

### mcp

Start the stdio MCP server for Agent consumption.

```bash
prismgo-lens mcp
```

Normally invoked automatically by the Agent's MCP config — no manual execution needed.

### execute-tool

Execute a single MCP tool in an isolated subprocess with base64-encoded JSON arguments.

```bash
# Execute application-info (e30= is base64 for {})
prismgo-lens execute-tool application-info e30=

# Execute get-config for app.name
# {"key":"app.name"} base64-encoded is eyJrZXkiOiJhcHAubmFtZSJ9
prismgo-lens execute-tool get-config eyJrZXkiOiJhcHAubmFtZSJ9
```

### browser-proxy

Start a dev-only reverse proxy that injects a browser logger into HTML responses.

```bash
# Proxy to local app, access via port 8052
prismgo-lens browser-proxy \
  --target http://127.0.0.1:8051 --listen 127.0.0.1:8052
```

When browsing via `http://127.0.0.1:8052`:
- All `console.log`, `console.error`, etc. output is captured
- JavaScript errors and unhandled Promise rejections are recorded
- Logs are written to `storage/logs/browser.log`
- Non-HTML responses (API JSON, static assets, etc.) are passed through unchanged

### list-skills

List installed skills in `.ai/skills`.

```bash
prismgo-lens list-skills
```

### add-skill

Audit and install a skill from a local directory or a GitHub repository.

```bash
# Install from a local directory
prismgo-lens add-skill /path/to/local/skill

# Install from GitHub (auto-audited)
prismgo-lens add-skill owner/repo/path/to/skill

# List all available skills in the repository
prismgo-lens add-skill owner/repo --list

# Install a specific skill
prismgo-lens add-skill owner/repo --skill skill-name

# Install all discovered skills
prismgo-lens add-skill owner/repo --all

# Skip audit (requires --force)
prismgo-lens add-skill owner/repo --skill skill-name --force --skip-audit
```

---

## MCP Tools

All tools exposed to AI Agents via the MCP protocol are **read-only**, ensuring the agent cannot accidentally mutate data.

### application-info

Returns a project runtime overview: Go version, module dependencies, PrismGo framework feature signals, frontend packages, and more.

**Use case**: The agent fetches project context before starting any work.

**Example:**
```
Agent calls → application-info()

Returns:
{
  "go_version": "go1.22.5",
  "root_module": "workorder",
  "go_directive": "1.22",
  "app_env": "local",
  "app_debug": "true",
  "database_engine": "mysql",
  "framework_module": "github.com/prismgo/framework",
  "features": {
    "cache": true,
    "console": true,
    "database": true,
    "queue": true,
    "horizon": true,
    "route": true,
    "vue-vite": true
  },
  "packages": [...],
  "frontend_packages": [...]
}
```

### search-docs

Search local PrismGo docs, project docs, and Agent guidelines.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | A single search query |
| `queries` | []string | Multiple search queries |
| `packages` | []string | Filter by package name, e.g. `prismgo`, `lens`, `project` |
| `token_limit` | int | Maximum response token budget, default 4000, max 1,000,000 |

**Examples:**
```
# Search cache-related docs
Agent calls → search-docs(queries=["cache remember", "cache lock"], packages=["prismgo"])

# Search project rules
Agent calls → search-docs(queries=["permission", "tenant"], packages=["project"])
```

**Returns:**
```json
{
  "results": [
    {
      "path": "github.com/prismgo/docs/en/cache.md",
      "snippet": "The cache system uses a Manager to coordinate multiple stores...",
      "source": "local",
      "package": "prismgo",
      "language": "en"
    }
  ],
  "source": "local",
  "truncated": false
}
```

> **GitHub Docs Provider**: When `features.github_docs_provider` is enabled in `.prismgo-lens.json` and the `PRISMGO_LENS_GITHUB_DOCS_URL` environment variable is set, `search-docs` also queries a remote pre-built docs index. Remote failures return local results with a warning — never a hard error.

### database-connections

List all configured database connections with sensitive values redacted.

**Example:**
```
Agent calls → database-connections()

Returns:
{
  "default": "mysql",
  "connections": [
    {
      "name": "mysql",
      "driver": "mysql",
      "host": "127.0.0.1",
      "port": "3306",
      "database": "workorder",
      "username": "root",
      "password": "[redacted]"
    }
  ]
}
```

### database-schema

Return database table structure metadata. Supports MySQL, PostgreSQL, and SQLite.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `connection` | string | Connection name; defaults to the configured default |
| `mode` | string | `summary` (lightweight) or `full` (includes columns, indexes, foreign keys) |
| `filter` | string | Filter tables by name substring |
| `include_column_details` | bool | Include column details even in summary mode |

**Examples:**
```
# Get all table summaries
Agent calls → database-schema(mode="summary")

# Get full table details
Agent calls → database-schema(mode="full")

# Only tables containing "order"
Agent calls → database-schema(mode="summary", filter="order")
```

### database-query

Execute read-only SQL queries. MySQL only; all write and DDL operations are rejected.

**Safety constraints:**
- Only `SELECT`, `SHOW`, `EXPLAIN`, `DESCRIBE`, `DESC`, and `WITH` queries whose final statement is `SELECT` are allowed
- Rejects `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `TRUNCATE`, `CREATE`, `REPLACE`, `RENAME`
- Rejects multiple statements (interior semicolons)
- Rejects locking statements (`FOR UPDATE`, `LOCK IN SHARE MODE`)
- Rejects file-writing statements (`INTO OUTFILE`)
- Default row limit: 100 (max 500)
- Default byte limit: 256KB (max 1MB)
- Secret-like column names are automatically redacted

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sql` | string | Read-only SQL statement (required) |
| `connection` | string | Connection name |
| `max_rows` | int | Maximum rows to return, default 100, max 500 |
| `max_bytes` | int | Maximum encoded response bytes, default 262144 |

**Examples:**
```
# Query first 10 workorders
Agent calls → database-query(sql="SELECT id, title, status FROM workorders LIMIT 10")

# Describe table structure
Agent calls → database-query(sql="DESCRIBE workorders")

# Show indexes
Agent calls → database-query(sql="SHOW INDEX FROM workorders")
```

### run-diagnostic

Run a pre-registered read-only diagnostic. This is Prismgo Lens' safe substitute for Laravel Boost's `tinker`.

**Built-in diagnostics:**

| Diagnostic | Description |
|------------|-------------|
| `current-config-summary` | List config keys and database connection names |
| `route-match-dry-run` | Filter routes by method and path |
| `console-command-metadata` | Return console command metadata |
| `database-connection-ping` | Ping the database connection |
| `queue-connection-summary` | Summarize queue-related config keys |
| `horizon-store-health-summary` | Check Horizon storage and log availability |

**Examples:**
```
# Test database connectivity
Agent calls → run-diagnostic(name="database-connection-ping")

# Get config overview
Agent calls → run-diagnostic(name="current-config-summary")
```

### get-config

Read a config value by dot-path. Secret values are automatically redacted.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | string | Config dot-path, e.g. `app.name`, `database.default` |

**Examples:**
```
Agent calls → get-config(key="database.default")
Returns: {"key": "database.default", "value": "mysql", "found": true}

Agent calls → get-config(key="app.secret")
Returns: {"key": "app.secret", "value": "[redacted]", "found": true}
```

### list-available-config-keys

List all config keys discovered from `config/*.go` files.

**Example:**
```
Agent calls → list-available-config-keys()

Returns:
{
  "keys": [
    "app.debug",
    "app.name",
    "app.url",
    "cache.default",
    "cache.stores.redis.driver",
    "database.default",
    ...
  ]
}
```

### list-routes

List PrismGo route declarations with optional filters.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `method` | string | Filter by HTTP method |
| `path` | string | Filter by path substring |
| `name` | string | Filter by route name substring |

**Examples:**
```
# List all GET routes
Agent calls → list-routes(method="GET")

# Find routes containing "workorder"
Agent calls → list-routes(path="workorder")

# Find routes with "api" in the name
Agent calls → list-routes(name="api")
```

### list-console-commands

List all PrismGo console command definitions.

**Example:**
```
Agent calls → list-console-commands()

Returns:
{
  "commands": [
    {"name": "migrate", "description": "Run database migrations"},
    {"name": "seed", "description": "Seed the database"},
    {"name": "queue", "description": "Start queue worker"},
    ...
  ]
}
```

### get-absolute-url

Build an absolute URL from `APP_URL` and a path or route name.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | URL path |
| `name` | string | Route name (resolved from route list) |

**Examples:**
```
Agent calls → get-absolute-url(path="/api/workorders")
Returns: {"url": "http://127.0.0.1:8051/api/workorders"}

Agent calls → get-absolute-url(name="workorder.show")
Returns: {"url": "http://127.0.0.1:8051/api/workorders/123"}
```

### get-env

Read a non-secret environment variable.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | string | Environment variable name (keys containing secret/token/password/key are refused) |

**Examples:**
```
Agent calls → get-env(key="APP_ENV")
Returns: {"key": "APP_ENV", "value": "local"}

Agent calls → get-env(key="DB_PASSWORD")
Returns: error "get-env: secret-like keys are refused"
```

### read-log-entries

Read tail entries from `storage/logs`.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `entries` | int | Number of entries, default 50, max 200 |
| `channel` | string | Log channel filename (without `.log`), default `app` |
| `path` | string | Relative path under `storage/logs`, overrides channel |

**Examples:**
```
# Read last 20 app log entries
Agent calls → read-log-entries(entries=20)

# Read queue log
Agent calls → read-log-entries(channel="queue")

# Read a specific log file
Agent calls → read-log-entries(path="horizon.log")
```

### last-error

Return the most recent error-like entry from the app log.

**Example:**
```
Agent calls → last-error()

Returns:
{
  "entry": "2026-06-05 10:00:00 ERROR: database connection timeout..."
}
```

### browser-logs

Read development browser log entries.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `entries` | int | Number of entries, default 50, max 200 |

**Example:**
```
# Read last 30 browser log entries
Agent calls → browser-logs(entries=30)
```

---

## MCP Resources

| Resource URI | Description |
|--------------|-------------|
| `file://instructions/application-info.md` | Project runtime, package, and PrismGo feature context |

---

## MCP Prompts

| Prompt Name | Description |
|-------------|-------------|
| `prismgo-code-simplifier` | Simplify recent Go/PrismGo changes while preserving behavior |

---

## Skill System

Prismgo Lens provides skill management so Agents can access framework best practices and debugging guidance.

### Built-in Skills

| Skill | Description |
|-------|-------------|
| `prismgo-debug` | Debug PrismGo apps with MCP tools before changing code — reproduce first, edit later |
| `prismgo-best-practices` | PrismGo framework best practices (architecture, providers, facades, routing, database, queue, cache, etc.) |

`prismgo-best-practices` includes the following rule files:
- `architecture.md` — Package boundaries, framework/application separation, and Lens isolation
- `provider-facade.md` — Service providers, facades, contracts, and deferrable providers
- `command-console.md` — Command definitions, input/output, and runtime listing
- `routing.md` — Route registration, groups, middleware, names, and runtime discovery
- `database-schema.md` — Schema builder, metadata inspection, and read-only database tooling
- `migrations.md` — Migration generation, foreign keys, and immutable deployed migrations
- `db-performance.md` — Eager loading, column selection, batching, indexes, and query placement
- `queue-jobs.md` — Jobs, dispatch options, middleware, batches, failures, and queue diagnostics
- `horizon.md` — Horizon configuration, supervisors, observability, and process safety
- `scheduling.md` — Scheduler overlap locks, multi-server coordination, and timeouts
- `caching.md` — Cache repositories, typed reads, stores, locks, tags, and stampede control
- `config-env.md` — Config registration, env boundaries, helpers, and secret redaction
- `error-handling.md` — Boundary errors, exception handling, panic recovery, and diagnostic failures
- `logging.md` — Channels, stacks, structured fields, context fields, and secret-safe logs
- `events-notifications.md` — Events, listeners, subscribers, queued listeners, and side-effect isolation
- `filesystem.md` — Disks, logical keys, uploads, URLs, temporary URLs, and custom drivers
- `rate-limiting.md` — Named limiters, middleware, manual counters, and key design
- `translation.md` — Translation keys, namespaces, locale resolution, and pluralization
- `session-cookie.md` — Session middleware, request stores, flash data, cookie queue, signing, and encryption
- `validation.md` — Gin request binding, boundary validation, and validation tests
- `frontend-vue-vite.md` — Vue/Vite conventions for PrismGo-served frontend assets
- `testing-coverage.md` — Package-focused tests, Lens tests, and coverage expectations
- `security.md` — Read-only SQL, diagnostics, browser logs, secrets, and generated AI assets
- `style.md` — Local Go style, comments, public APIs, and small focused changes

### Installing Skills

```bash
# Install from a local directory
prismgo-lens add-skill ./my-custom-skill

# Install from GitHub
prismgo-lens add-skill github.com/owner/repo/skills/my-skill

# See which skills are available in the repository
prismgo-lens add-skill github.com/owner/repo --list
```

After installation, skills are automatically synced to all configured Agent skill directories.

### Skill Auditing

When installing a skill, Lens performs a static risk audit:

| Risk Level | Behavior |
|------------|----------|
| `low` | Installed normally |
| `medium` | Installed normally, findings logged |
| `high` | Requires `--force` to proceed |
| `critical` | Requires explicit `--force --skip-audit` bypass after manual review |

Audit rules include:
- `rm -rf` recursive deletion (critical)
- `sudo` privilege escalation (high)
- Remote script execution (critical)
- `git reset --hard` destructive reset (high)
- `DROP TABLE` destructive database statement (critical)
- `../` path traversal fragments (medium)
- Absolute path writes (high)
- Undeclared shell/process execution (high)
- Hidden files / large hidden files (medium/high)
- Executable files (high)
- Symlinks (high)

---

## Package Assets

Third-party Go modules can distribute AI assets under `resources/prismgo-lens/`:

```
some-module/
  resources/
    prismgo-lens/
      guidelines/
        some-feature.md      # guideline file
      skills/
        some-skill/
          SKILL.md           # skill directory
```

**Discovery and installation:**

```bash
# Discover AI assets from all Go module dependencies
prismgo-lens update --discover

# Enable a specific module in .prismgo-lens.json
# "selected_package_modules": ["github.com/prismgo/framework"]

# Or specify during install
prismgo-lens install \
  --package-module github.com/prismgo/framework
```

For enabled modules:
- `guidelines/*.md` → copied to `.ai/guidelines/packages/{module}/`
- `skills/{name}/SKILL.md` → audited and copied to `.ai/skills/{name}/`

---

## Safety Boundaries

- **Module path**: `github.com/prismgo/lens`
- **Tool allowlist**: MCP calls can only reach registered tools
- **Isolated execution**: MCP `tools/call` runs via a subprocess with timeout and output limits
- **SQL safety**: `database-query` only allows read-only SQL; writes, DDL, and multi-statement are rejected
- **Secret protection**: `get-config`, `get-env`, `database-connections` auto-redact sensitive values
- **Path constraints**: `read-log-entries` can only read within `storage/logs`
- **Skill audit**: Remote skill installations trigger automatic static risk scanning

---
