---
title: "Config Usage Guide"
---

# Config Usage Guide

- [Quick Start](#quick-start)
- [What It Is For](#what-it-is-for)
- [Loading Flow](#loading-flow)
- [Environment Variable Function](#environment-variable-function)
- [Registering Configuration](#registering-configuration)
- [Reading Configuration](#reading-configuration)
- [Application Configuration Reference](#application-configuration-reference)
- [Standalone Instances](#standalone-instances)
- [Facade Entry Points](#facade-entry-points)
- [Recommendations](#recommendations)

`github.com/prismgo/framework/config` provides a Laravel-style runtime configuration repository. Configuration files are registered as namespaces with `Add`, `.env` and system environment variables are read with `Env`, and application code reads values through dot paths.

Application code usually imports `github.com/prismgo/framework/config` directly and registers its own configuration namespaces from `config/*.go`.

## Quick Start

Define a configuration namespace:

```go
package config

func init() {
    Add("mail", func() map[string]interface{} {
        return map[string]interface{}{
            "host": Env("MAIL_HOST", "127.0.0.1"),
            "port": Env("MAIL_PORT", 1025),
            "from": map[string]interface{}{
                "address": Env("MAIL_FROM_ADDRESS", "noreply@example.com"),
                "name":    Env("MAIL_FROM_NAME", "prismgo"),
            },
        }
    })
}
```

Read configuration:

```go
package service

import (
    "strconv"

    "github.com/prismgo/framework/config"
)

func mailEndpoint() string {
    host := config.GetString("mail.host", "127.0.0.1")
    port := config.GetInt("mail.port", 1025)
    return host + ":" + strconv.Itoa(port)
}
```

Example local `.env`:

```dotenv
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_FROM_ADDRESS=notice@example.com
```

## What It Is For

`github.com/prismgo/framework/config` mainly solves four problems:

| Capability | Purpose |
| --- | --- |
| Configuration registration | Register namespaces such as `app`, `database`, and `cache` with `Add(name, fn)` |
| Environment variable access | Read `.env` or system environment variables with `Env` inside registration functions |
| Runtime reads | Read nested configuration with dot paths such as `GetString("app.name")` |
| Facade management | Use `Resolve` for lazy loading through the application container; tests can explicitly bind configuration instances |

The configuration repository is only responsible for loading static runtime configuration. Mutable tenant settings, system parameter tables, and other business data should not be stored in this package.

## Loading Flow

During application startup, `github.com/prismgo/framework/foundation` registers the configuration factory:

```text
main.go
  -> bootstrap.NewApplication()
  -> foundation.NewApplication()
  -> registerConfigResource()
  -> first config.Resolve / config.GetString
  -> read .env, execute all Add registration functions, build the runtime repository
```

Configuration functions are executed when the repository is built, not when the package is initialized. Therefore `config/*.go` should preferably contain declarative structures only:

```go
Add("app", func() map[string]interface{} {
    return map[string]interface{}{
        "name":  Env("APP_NAME", "prismgo"),
        "debug": Env("APP_DEBUG", false),
    }
})
```

If the `.env` file does not exist, no error is raised. The repository continues with system environment variables and default values. When `.env` and system environment variables are both present, explicitly provided values override defaults.

## Environment Variable Function

### Env

Reads one environment variable and returns the default value when the variable is missing or blank:

```go
debug := config.Env("APP_DEBUG", false)
name := config.Env("APP_NAME", "prismgo")
```

The return value is converted according to the default value where possible. Defaults of type `bool`, `int`, `int64`, `uint`, `float64`, and `string` return the corresponding type.

## Registering Configuration

`Add(name, fn)` registers a namespace in the global configuration registry. The namespace becomes the first segment of dot paths:

```go
config.Add("audit", func() map[string]interface{} {
    return map[string]interface{}{
        "enabled": config.Env("AUDIT_ENABLED", true),
        "rules": map[string]interface{}{
            "prismgo": config.Env("AUDIT_PRISMGO", true),
        },
    }
})
```

Read it with:

```go
enabled := config.GetBool("audit.enabled", true)
prismgo := config.GetBool("audit.rules.prismgo", true)
```

Nested maps returned by registration functions are normalized to `map[string]any`, so both `map[string]interface{}` and `map[string]any` are supported.

## Reading Configuration

Common read functions:

| Function | Return type | Purpose |
| --- | --- | --- |
| `Get` / `GetString` | `string` | String configuration |
| `GetInt` | `int` | Ports, counts, seconds, and similar values |
| `GetInt64` | `int64` | 64-bit integer configuration |
| `GetUint` | `uint` | Unsigned integer configuration |
| `GetFloat64` | `float64` | Floating-point configuration |
| `GetBool` | `bool` | Feature flags and switches |
| `GetStringMap` | `map[string]any` | Nested configuration blocks |
| `GetStringMapString` | `map[string]string` | String maps |

Missing values can receive defaults:

```go
appName := config.GetString("app.name", "prismgo")
debug := config.GetBool("app.debug", false)
timeout := config.GetInt("app.server.timeout", 15)
```

Read nested configuration:

```go
server := config.GetStringMap("app.server")
channels := config.GetStringMap("logging.channels")
labels := config.GetStringMapString("map.labels")
```

If the path does not exist, map read functions return an empty map instead of `nil`.

## Application Configuration Reference

New applications register application-level configuration in `config/app.go` with `config.Add("app", ...)`. `APP_*` and `SERVER_*` values from `.env` override the defaults.

### Base Application Configuration

| Config Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `app.name` | `APP_NAME` | `Prismgo` | Application name used when the framework displays or references the app |
| `app.env` | `APP_ENV` | `production` | Current environment; high-risk commands use this to decide whether `--force` is required |
| `app.key` | `APP_KEY` | `""` | Application encryption key; see [Encryption](encryption.md) |
| `app.debug` | `APP_DEBUG` | `false` | Debug mode; must be `false` in production |
| `app.url` | `APP_URL` | `http://localhost:8080` | Base URL used from CLI and other non-HTTP contexts |
| `app.timezone` | `APP_TIMEZONE` | `UTC` | Application timezone |
| `app.locale` | `APP_LOCALE` | `en` | Default locale for translations |
| `app.fallback_locale` | `APP_FALLBACK_LOCALE` | `en` | Fallback locale when a translation is missing |
| `app.cipher` | `APP_CIPHER` | `AES-256-GCM` | Encryption cipher; currently `AES-256-GCM` |
| `app.previous_keys` | `APP_PREVIOUS_KEYS` | `""` | Comma-separated old application keys for key rotation |

### HTTP Server Configuration

| Config Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `app.server.host` | `SERVER_HOST` | `""` | Listen host |
| `app.server.port` | `SERVER_PORT` | `8080` | Listen port |
| `app.server.timeout` | `SERVER_TIMEOUT` | `15` | Legacy request timeout fallback |
| `app.server.read_timeout` | `SERVER_READ_TIMEOUT` | `15s` | Timeout for reading full requests |
| `app.server.read_header_timeout` | `SERVER_READ_HEADER_TIMEOUT` | `5s` | Timeout for reading request headers |
| `app.server.write_timeout` | `SERVER_WRITE_TIMEOUT` | `30s` | Response write timeout |
| `app.server.idle_timeout` | `SERVER_IDLE_TIMEOUT` | `60s` | Keep-alive idle timeout |
| `app.server.shutdown_timeout` | `SERVER_SHUTDOWN_TIMEOUT` | `15s` | Graceful shutdown timeout |
| `app.server.max_header_bytes` | `SERVER_MAX_HEADER_BYTES` | `1048576` | Maximum request header bytes |
| `app.server.max_multipart_memory` | `SERVER_MAX_MULTIPART_MEMORY` | `33554432` | Multipart form memory limit |
| `app.server.trusted_proxies` | `SERVER_TRUSTED_PROXIES` | `""` | Comma-separated trusted proxies |
| `app.server.client_ip_headers` | `SERVER_CLIENT_IP_HEADERS` | `X-Forwarded-For,X-Real-IP` | Headers used to resolve client IP |
| `app.server.access_log` | `SERVER_ACCESS_LOG` | `true` | Enable access logging |
| `app.server.exception_handler` | `SERVER_EXCEPTION_HANDLER` | `true` | Mount the unified exception handler middleware |

For more HTTP server details, see [HTTP Server](http-server.md).

## Standalone Instances

Besides the global facade, you can create standalone `Config` instances. Tests, scripts, and temporary tools should prefer standalone instances to avoid polluting global configuration:

```go
cfg, err := config.NewFromFile("testdata/.env")
if err != nil {
    return err
}

name := cfg.GetString("app.name", "prismgo")
debug := cfg.GetBool("app.debug", false)
```

Clone the current configuration:

```go
clone := config.Clone()
```

`Clone` returns an isolated repository. Later `Reload` calls do not affect the clone and original repository together.

## Facade Entry Points

The global default configuration of `github.com/prismgo/framework/config` is managed by `github.com/prismgo/framework/facade`.

| Function | Purpose |
| --- | --- |
| `Resolve()` | Resolve the configuration repository from the current Application container |
| `Clone()` | Copy the current configuration repository and return an isolated clone |
| `Reload()` | Reload the current configuration object from the default `.env` |
| `Empty()` | Check whether the current configuration repository is empty |

Common test pattern:

```go
func TestWithConfig(t *testing.T) {
    cfg, err := config.NewFromFile("testdata/.env")
    if err != nil {
        t.Fatal(err)
    }
    bindConfigForTest(t, cfg)

    got := config.GetString("app.name", "")
    if got == "" {
        t.Fatal("missing app name")
    }
}
```

## Recommendations

- Application code should import `github.com/prismgo/framework/config` first; do not repeatedly wrap environment variable reads in the business layer.
- Use lowercase English names for configuration namespaces, such as `app`, `database`, and `wechat`.
- New configuration items should be placed in `config/*.go`; avoid direct `os.Getenv` calls in services.
- Environment variable names should settle on the current names. Do not add compatibility entries for old names from pre-release phases.
- Provide reasonable defaults for missing values, especially ports, timeouts, and feature flags.
- Put mutable business configuration in business tables or dedicated repositories, not in the runtime configuration repository.
