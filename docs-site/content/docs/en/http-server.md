---
title: "HTTP Server"
---

# HTTP Server

- [Introduction](#introduction)
- [Starting the Server](#starting-the-server)
- [Listen Address](#listen-address)
- [Timeouts and Request Limits](#timeouts-and-request-limits)
- [Proxies and Client IPs](#proxies-and-client-ips)
- [Middleware Toggles](#middleware-toggles)
- [Process Control](#process-control)

## Introduction

PrismGo starts its HTTP server with `go run . serve`. During startup, the application runs `bootstrap.NewApplication()`, loads providers, routes, middleware, and exception handling, then builds a `net/http.Server`.

New projects register routes in `bootstrap/app.go`:

```go
foundation.Configure(basePath...).
    WithRouting(func(r *foundation.Routing) {
        r.Routes(apphttp.RegisterRoutes)
    }).
    Create()
```

## Starting the Server

```bash
go run . serve
```

Specify a port:

```bash
go run . serve --port=8000
```

`--port` only affects the current command. It does not edit `.env` or `config/app.go`.

## Listen Address

The default config lives under `app.server` in `config/app.go`:

```go
"server": map[string]interface{}{
    "host": Env("SERVER_HOST", ""),
    "port": Env("SERVER_PORT", 8080),
}
```

The matching `.env` values are:

```dotenv
SERVER_HOST=127.0.0.1
SERVER_PORT=8080
```

| Config Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `app.server.host` | `SERVER_HOST` | `""` | Listen host. An empty value lets Go listen on all addresses |
| `app.server.port` | `SERVER_PORT` | `8080` | Listen port |

## Timeouts and Request Limits

| Config Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `app.server.timeout` | `SERVER_TIMEOUT` | `15` | Legacy request timeout used as a fallback |
| `app.server.read_timeout` | `SERVER_READ_TIMEOUT` | `15s` | Timeout for reading the full request |
| `app.server.read_header_timeout` | `SERVER_READ_HEADER_TIMEOUT` | `5s` | Timeout for reading request headers |
| `app.server.write_timeout` | `SERVER_WRITE_TIMEOUT` | `30s` | Response write timeout |
| `app.server.idle_timeout` | `SERVER_IDLE_TIMEOUT` | `60s` | Keep-alive idle timeout |
| `app.server.shutdown_timeout` | `SERVER_SHUTDOWN_TIMEOUT` | `15s` | Graceful shutdown timeout |
| `app.server.max_header_bytes` | `SERVER_MAX_HEADER_BYTES` | `1048576` | Maximum request header bytes |
| `app.server.max_multipart_memory` | `SERVER_MAX_MULTIPART_MEMORY` | `33554432` | Multipart form memory limit |

Duration fields accept Go duration strings such as `15s`, `1m`, and `1m30s`. Plain numbers are treated as seconds.

## Proxies and Client IPs

| Config Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `app.server.trusted_proxies` | `SERVER_TRUSTED_PROXIES` | `""` | Comma-separated trusted proxy list |
| `app.server.client_ip_headers` | `SERVER_CLIENT_IP_HEADERS` | `X-Forwarded-For,X-Real-IP` | Headers used to resolve the client IP |

When production traffic passes through a reverse proxy, set trusted proxies explicitly so application code does not trust spoofed client IP headers.

## Middleware Toggles

| Config Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `app.server.access_log` | `SERVER_ACCESS_LOG` | `true` | Enable Gin access logging |
| `app.server.exception_handler` | `SERVER_EXCEPTION_HANDLER` | `true` | Mount the unified HTTP exception handler middleware |

`app.debug` / `APP_DEBUG` controls whether exception responses expose internal details. It must be `false` in production.

## Process Control

`serve` keeps a port-specific PID file. Control commands read the PID for the selected port:

| Command | Behavior |
| --- | --- |
| `go run . serve --stop` | Gracefully stop the server on the current port |
| `go run . serve --kill` | Force stop the server on the current port |
| `go run . serve --reload` | Start a new process and gracefully stop the old process |
| `go run . serve --restart` | Kill the old process and start a new process |

If the server was not started with `serve`, or if the PID file is missing, control commands report that the PID file cannot be read.

