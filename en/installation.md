# Installation

- [Server Requirements](#server-requirements)
- [Installing the PrismGo Installer](#installing-the-prismgo-installer)
- [Creating an Application](#creating-an-application)
- [Project Creation Options](#project-creation-options)
- [Initial Configuration](#initial-configuration)
- [Upgrading from Built-in Horizon](#upgrading-from-built-in-horizon)
- [Next Steps](#next-steps)

## Server Requirements

PrismGo applications require:

| Tool | Requirement | Purpose |
| --- | --- | --- |
| Go | 1.25+ | Install the installer, compile the app, run `go mod tidy`, and run tests |
| Git | Available | Fetch the official application skeleton from `github.com/prismgo/prismgo` |
| Network | GitHub access | Required while creating a new application |

## Installing the PrismGo Installer

Install with the Go toolchain:

```bash
go install github.com/prismgo/installer/cmd/prismgo@latest
```

Or use the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/prismgo/installer/main/scripts/install.sh | sh
```

Make sure the `bin` directory under `go env GOPATH`, or `go env GOBIN`, is on your `PATH`. Verify the install:

```bash
prismgo --help
```

## Creating an Application

Create an application with a short name:

```bash
prismgo new myapp
cd myapp
```

The generated directory is `myapp`, and `go.mod` uses:

```go
module myapp
```

Create an application with a full Go module path:

```bash
prismgo new github.com/acme/myapp
cd myapp
```

The generated directory is still `myapp`, and `go.mod` uses:

```go
module github.com/acme/myapp
```

After creation, the installer copies `.env.example` to `.env` and runs:

```bash
go mod tidy
go test ./...
```

Start the built-in HTTP server:

```bash
go run . serve
```

Visit:

```text
http://localhost:8080/api
http://localhost:8080/api/health
```

## Project Creation Options

| Command | Description |
| --- | --- |
| `prismgo new myapp --module github.com/acme/service` | Explicitly set the `go.mod` module |
| `prismgo new myapp --no-install` | Skip `go mod tidy` and `go test ./...` |
| `prismgo new myapp --git` | Initialize a local Git repository |
| `prismgo new myapp --git --branch develop` | Initialize Git with a specific initial branch |
| `prismgo new myapp --force` | Reuse an existing empty directory |

`--no-install` only skips dependency tidy and tests. It does not skip fetching the application skeleton, so Git and GitHub access are still required.

`--force` only works with an empty directory. It does not delete or overwrite a non-empty directory.

## Initial Configuration

A new application receives its `.env` from `.env.example`. The first values to review are usually:

```dotenv
APP_NAME=Prismgo
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_URL=http://localhost:8080

SERVER_HOST=127.0.0.1
SERVER_PORT=8080
```

If the application uses encryption, encrypted queue payloads, encrypted sessions, or temporary signed URLs, generate an application key first:

```bash
go run . key:generate
```

Production environments must disable debug mode:

```dotenv
APP_ENV=production
APP_DEBUG=false
```

## Upgrading from Built-in Horizon

Horizon has moved to an independent module. For an existing application that uses Horizon:

1. Run `go get github.com/prismgo/horizon@latest`.
2. Replace `github.com/prismgo/framework/horizon` and `github.com/prismgo/framework/horizon/cmd` imports with `github.com/prismgo/horizon` and `github.com/prismgo/horizon/cmd` respectively.
3. Register the extension through `WithExtensionProviders(horizon.ServiceProvider{})` on the Application Builder.
4. Run `go mod tidy` and your application tests.

There is no compatibility shim for the old import paths. Command names, `horizon.*` configuration, Dashboard/API behavior, and the `horizon.manager` container key remain unchanged. See [Horizon](horizon.md#installation) for the complete installation and provider responsibilities.

## Next Steps

- Read [Getting Started](starter.md) to build your first HTTP endpoint.
- Read [Configuration](config.md) to understand `config/*.go` and `.env` loading.
- Read [Commands](commands.md) for `serve`, `make:*`, `migrate:*`, and `queue:*`.
- Read [HTTP Server](http-server.md) for ports, timeouts, proxies, and process control.

