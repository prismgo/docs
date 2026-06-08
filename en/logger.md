# Logging

- [Introduction](#introduction)
- [Configuration](#configuration)
  - [Config File](#config-file)
  - [Available Channel Drivers](#available-channel-drivers)
  - [Channel Prerequisites](#channel-prerequisites)
  - [Configuration Parameters](#configuration-parameters)
- [Building Log Stacks](#building-log-stacks)
  - [Log Levels](#log-levels)
- [Writing Log Messages](#writing-log-messages)
  - [Using the Facade](#using-the-facade)
  - [Contextual Information](#contextual-information)
  - [Writing to Specific Channels](#writing-to-specific-channels)
- [Customizing Channels](#customizing-channels)
  - [Custom Drivers](#custom-drivers)
  - [Custom Formatters](#custom-formatters)
- [Manager Lifecycle](#manager-lifecycle)

---

PrismGo's logging component provides a multi-channel logging system inspired by Laravel's logging architecture. It is built on top of [logrus](https://github.com/sirupsen/logrus), offering a clean facade, named channels, stack fan-out, structured fields, error context, file drivers, and configurable formatters.

---

## Introduction

PrismGo logging is based on "channels". Each channel represents a specific way of writing log information. For example, the `single` channel writes logs to a single file, the `daily` channel rotates log files by day, and the `stderr` channel writes to the process's standard error stream. Log messages can be written to multiple channels based on their severity.

Under the hood, PrismGo utilizes [logrus](https://github.com/sirupsen/logrus), a structured logger for Go. The `prismgo/logger` package provides a Laravel-like configuration layer on top of logrus, allowing you to mix and match drivers and formatters to customize your application's log handling.

Every PrismGo application ships with a pre-configured logging setup. The default configuration uses the `stack` channel, which aggregates multiple log channels into a single channel, giving you the flexibility to write logs to multiple destinations simultaneously.

## Configuration

All of the configuration options that control your application's logging behavior are defined in `config/logging.go`. This file allows you to configure your application's log channels.

By default, the `stack` channel is used when logging messages. The `stack` channel aggregates multiple log channels into a single channel.

### Config File

Logging configuration is registered in `config/logging.go`. You can override any parameter via environment variables:

```go
// config/logging.go
func init() {
    config.Add("logging", func() map[string]interface{} {
        return map[string]interface{}{
            "default": config.Env("LOG_CHANNEL", "stack"),

            "channels": map[string]interface{}{
                "stack": map[string]interface{}{
                    "driver":   "stack",
                    "channels": []string{"single", "error"},
                },
                "single": map[string]interface{}{
                    "driver":    "single",
                    "level":     config.Env("APP_LOGGER_LEVEL", "info"),
                    "formatter": config.Env("APP_LOGGER_FORMATTER", "line"),
                    "path":      config.Env("APP_LOGGER_FILE", "storage/logs/app.log"),
                },
                "daily": map[string]interface{}{
                    "driver":    "daily",
                    "level":     config.Env("APP_LOGGER_LEVEL", "info"),
                    "formatter": config.Env("APP_LOGGER_FORMATTER", "line"),
                    "path":      config.Env("APP_LOGGER_FILE", "storage/logs/app.log"),
                },
                "error": map[string]interface{}{
                    "driver":    config.Env("ERROR_LOGGER_DRIVER", "daily"),
                    "level":     config.Env("ERROR_LOGGER_LEVEL", "warn"),
                    "formatter": config.Env("ERROR_LOGGER_FORMATTER", "line"),
                    "path":      config.Env("ERROR_LOGGER_FILE", "storage/logs/error/error.log"),
                },
                "stderr": map[string]interface{}{
                    "driver":    "stderr",
                    "level":     config.Env("STDERR_LOGGER_LEVEL", "info"),
                    "formatter": config.Env("STDERR_LOGGER_FORMATTER", "line"),
                },
            },
        }
    })
}
```

### Available Channel Drivers

Each log channel is powered by a "driver". The driver determines how and where the log message is actually recorded. The following log channel drivers are available in every PrismGo application:

| Name | Description |
|---|---|
| `single` | Writes all logs to a single file. No log rotation. Suitable for development. |
| `daily` | Rotates log files daily. File names follow the `base-YYYY-MM-DD.log` pattern. |
| `stderr` | Writes to the process's standard error stream (`os.Stderr`). Ideal for containerized deployments. |
| `stack` | A wrapper that aggregates multiple channels into a single channel. Logs are fanned out to all child channels. |
| `null` | Discards all log messages. Useful for testing or temporarily disabling a channel. |

### Channel Prerequisites

#### Single and Daily Channels

Both the `single` and `daily` channels require the `path` configuration option, which specifies the log file path. The `daily` driver appends the current date to the file name automatically. If the directory does not exist, it will be created automatically (with `0755` permissions).

```go
"single": map[string]interface{}{
    "driver": "single",
    "level":  "info",
    "path":   "storage/logs/app.log",
},
"daily": map[string]interface{}{
    "driver": "daily",
    "level":  "info",
    "path":   "storage/logs/app.log",
},
```

For the `daily` driver, the file `storage/logs/app.log` will produce files like `storage/logs/app-2026-06-03.log`.

#### Stderr Channel

The `stderr` channel writes directly to `os.Stderr` and requires no path configuration. It is the preferred driver for Docker and Kubernetes deployments, where log collection is handled by the container runtime.

#### Null Channel

The `null` channel discards all log messages. It implements the `Driver` interface but performs no actual I/O. This is useful in test suites or when you want to suppress output from a specific channel while keeping the call chain intact.

### Configuration Parameters

#### Top-Level Configuration

| Parameter Path | Environment Variable | Default | Description |
|---|---|---|---|
| `logging.default` | `LOG_CHANNEL` | `"stack"` | Default channel name used when no channel is explicitly specified |

#### Channel Configuration

Each channel in `logging.channels` accepts the following fields:

| Field | Type | Description |
|---|---|---|
| `driver` | `string` | Driver name: `single`, `daily`, `stderr`, `stack`, or `null`. Determines the output destination. |
| `formatter` | `string` | Formatter name: `line` (default), `text`, or `json`. Determines how each log line is serialized. |
| `level` | `string` | Minimum log level for this channel: `debug`, `info`, `warn`, `error`, `fatal`, `panic`. Messages below this level are filtered out. |
| `path` | `string` | Output file path for file-based drivers (`single`, `daily`). The `daily` driver appends the date to the file name. |
| `channels` | `[]string` | List of child channel names (used only by the `stack` driver). Logs are broadcast to all child channels. |

#### Deployment Recommendations

| Scenario | Recommended Configuration | Notes |
|---|---|---|
| Local development | `LOG_CHANNEL=stack`, formatter: `line` | Easy to read log files directly |
| Traditional server | `stack` + `single` / `error` | Full logs in one file, warnings+ in another |
| Docker / Kubernetes | `LOG_CHANNEL=stderr`, formatter: `json` | Let the container runtime handle persistence |
| Automated tests | Custom `null` channel or manual `Manager` | Avoid file I/O side effects during tests |
| High-throughput paths | Raise level to `info` or `warn` | Reduce formatting and I/O overhead |

## Building Log Stacks

The `stack` driver allows you to combine multiple channels into a single log channel. This is the recommended approach for production applications, where you want to write full business logs to a file while simultaneously routing warnings and errors to a dedicated file.

Let's look at the default configuration:

```go
"stack": map[string]interface{}{
    "driver":   "stack",
    "channels": []string{"single", "error"},
},
"single": map[string]interface{}{
    "driver":    "single",
    "level":     "info",
    "formatter": "line",
    "path":      "storage/logs/app.log",
},
"error": map[string]interface{}{
    "driver":    "daily",
    "level":     "warn",
    "formatter": "line",
    "path":      "storage/logs/error/error.log",
},
```

In this configuration, the `stack` channel aggregates `single` and `error`. When a log message is written to the `stack` channel:

- The `single` channel writes all messages at `info` level and above to `app.log`.
- The `error` channel writes messages at `warn` level and above to the daily error log.

Each child channel retains its own log-level filtering and formatter. This means `logger.Info("...")` will reach `single` but not `error`, while `logger.Error("...")` will reach both.

### Log Levels

PrismGo supports the following log levels (in descending order of severity):

| Level | Description |
|---|---|
| `fatal` | A fatal error has occurred. The process will exit after logging. |
| `panic` | A panic has occurred. The process will exit after logging. |
| `error` | A runtime error that prevents a specific operation from completing. |
| `warn` | An unexpected event occurred, but the application can continue. |
| `info` | General operational information about application events. |
| `debug` | Detailed diagnostic information useful for debugging. |

Each channel's `level` option determines the minimum severity a message must have to be logged by that channel. For example, a channel configured with `level: "warn"` will log `warn`, `error`, `fatal`, and `panic` messages, but will filter out `info` and `debug`.

## Writing Log Messages

### Using the Facade

The `prismgo/logger` package provides a set of package-level functions that act as a facade to the default log channel. These are the primary way to write log messages in business code:

```go
import "github.com/prismgo/framework/logger"

func Notify(userID uint) {
    logger.Debug("debug detail")
    logger.Info("notification started")
    logger.Warn("provider slow")
    logger.Error("provider failed")
}
```

Formatted variants are also available:

```go
logger.Infof("queue processed jobs=%d failed=%d", 100, 2)
logger.Errorf("payment failed: order=%s reason=%v", orderID, err)
```

The `Fatal` and `Fatalf` methods log a message and then call `os.Exit(1)`. Use them sparingly:

```go
logger.Fatal("critical component failed to start")
```

### Contextual Information

You can attach structured context to your log messages using `WithField`, `WithFields`, `WithError`, and `WithContext`. These methods return a new `Logger` instance that carries the attached context, allowing you to chain additional calls.

#### Single Field

```go
logger.WithField("request_id", requestID).Info("request started")
```

#### Multiple Fields

```go
logger.WithFields(map[string]any{
    "tenant_id": tenantID,
    "user_id":   userID,
    "role":      "admin",
}).Info("permission checked")
```

#### Error Context

```go
if err != nil {
    logger.WithError(err).WithFields(map[string]any{
        "order_id": orderID,
        "job":      "SyncOrderJob",
    }).Error("job failed")
}
```

The error object is specially handled by the `line` formatter, which automatically appends a `[stacktrace]` section when an error with a stack trace is present.

#### Context Extraction

```go
logger.WithContext(ctx).Info("request finished")
```

`WithContext` uses the channel's configured `ContextExtractor` to extract fields (such as `request_id`, `trace_id`, `tenant_id`) from the `context.Context`. If no extractor is configured, `WithContext` is a safe no-op.

Context extractors are set at the `Manager` or channel level using `ContextExtractor`:

```go
type ContextExtractor func(context.Context) map[string]any
```

Example extractor that reads a request ID from context:

```go
manager, err := logger.NewManager(logger.Config{
    Default: "stack",
    ContextExtractor: func(ctx context.Context) map[string]any {
        if reqID, ok := ctx.Value("request_id").(string); ok {
            return map[string]any{"request_id": reqID}
        }
        return nil
    },
    Channels: map[string]logger.ChannelOptions{...},
})
```

### Writing to Specific Channels

Sometimes you need to write a log message to a specific channel other than the default. Use the `Channel` function to retrieve a named channel and log to it:

```go
logger.Channel("single").Info("business log")
logger.Channel("error").Warn("recoverable error")
logger.Channel("stderr").Info("container visible log")
```

If the requested channel name does not exist, the default channel is used as a fallback. This prevents configuration drift from causing panics in business code.

You can also chain context onto a specific channel:

```go
logger.Channel("error").
    WithField("order_id", orderID).
    WithError(err).
    Error("order sync failed")
```

#### Interface Reference

| Function / Method | Description |
|---|---|
| `logger.Debug(args ...any)` | Write a debug-level message to the default channel |
| `logger.Info(args ...any)` | Write an info-level message to the default channel |
| `logger.Warn(args ...any)` | Write a warning-level message to the default channel |
| `logger.Error(args ...any)` | Write an error-level message to the default channel |
| `logger.Fatal(args ...any)` | Write a fatal-level message and exit the process |
| `logger.Debugf/Infof/Warnf/Errorf/Fatalf` | Formatted variants of the above |
| `logger.Channel(name string) Logger` | Retrieve a named channel logger |
| `logger.WithField(key string, value any) Logger` | Attach a single contextual field |
| `logger.WithFields(fields map[string]any) Logger` | Attach multiple contextual fields |
| `logger.WithError(err error) Logger` | Attach an error object as context |
| `logger.WithContext(ctx context.Context) Logger` | Attach context-extracted fields |
| `logger.Resolve() *Manager` | Resolve the `Manager` from the application container |
| `logger.DefaultName() string` | Get the default channel name |
| `logger.Close() error` | Close the manager and release all driver resources |

## Customizing Channels

### Custom Drivers

If the built-in drivers (`single`, `daily`, `stderr`, `null`) do not meet your needs, you can register custom drivers using the `Extend` function. This is the equivalent of Laravel's custom channel via Monolog handler.

A custom driver must implement the `Driver` interface:

```go
type Driver interface {
    io.Writer
    Close() error
}
```

Example: registering a driver that writes to an external logging service:

```go
type syslogDriver struct {
    // ...
}

func (d *syslogDriver) Write(p []byte) (int, error) {
    // Send log bytes to the external service
    return len(p), nil
}

func (d *syslogDriver) Close() error {
    // Release network connections, etc.
    return nil
}

func init() {
    logger.Extend("syslog", func(opts logger.ChannelOptions) (logger.Driver, error) {
        return &syslogDriver{}, nil
    })
}
```

Once registered, you can reference the custom driver by name in your channel configuration:

```go
"channels": map[string]interface{}{
    "syslog": map[string]interface{}{
        "driver": "syslog",
        "level":  "warn",
    },
}
```

The `Extend` function accepts:
- A string `name` (the driver identifier used in channel configurations)
- A `factory` function that takes `ChannelOptions` and returns a `Driver` (or an error)

If a driver with the same name is registered again, the new factory overrides the previous one (last-registered-wins semantics, matching Laravel's `LogManager::extend` behavior).

### Custom Formatters

If the built-in formatters (`line`, `text`, `json`) do not meet your formatting requirements, you can register custom formatters using the `RegisterFormatter` function.

A formatter factory has the following signature:

```go
type FormatterFactory func(params map[string]any) (Formatter, error)
```

Where `Formatter` is an alias for `logrus.Formatter`:

```go
type Formatter = logrus.Formatter
```

Example: registering a plain text formatter:

```go
func init() {
    logger.RegisterFormatter("plain", func(params map[string]any) (logger.Formatter, error) {
        return &logrus.TextFormatter{
            DisableTimestamp: true,
            DisableColors:    true,
        }, nil
    })
}
```

Once registered, you can reference the custom formatter by name in channel configurations:

```go
"stderr": map[string]interface{}{
    "driver":    "stderr",
    "level":     "info",
    "formatter": "plain",
},
```

The `params` map passed to the factory includes the `"channel"` key (the channel name), plus any custom parameters from `FormatterParams` in `ChannelOptions`.

#### Built-in Formatters

| Name | Description |
|---|---|
| `line` | Default formatter. Produces output matching the Laravel `/Monolog LineFormatter` format: `[%datetime%] %channel%.%level_name%: %message% %context% [stacktrace]`. Supports auto-detection of error stack traces. |
| `text` | logrus native text format. Key=value style output, suitable for backward compatibility. |
| `json` | JSON-line formatter. Each log entry is a single JSON object. Ideal for log aggregation systems (ELK, Loki, etc.). |

## Manager Lifecycle

### Programmatic Initialization

In tests or standalone programs, you can create a `Manager` manually using `NewManager`:

```go
manager, err := logger.NewManager(logger.Config{
    Default: "stack",
    Channels: map[string]logger.ChannelOptions{
        "stack": {
            Driver:   "stack",
            Channels: []string{"app", "error"},
        },
        "app": {
            Driver:    "single",
            Level:     "info",
            Formatter: "text",
            Path:      "storage/logs/app.log",
        },
        "error": {
            Driver:    "daily",
            Level:     "warn",
            Formatter: "json",
            Path:      "storage/logs/error/error.log",
        },
    },
})
if err != nil {
    return err
}
defer manager.Close()
```

### Service Provider

In a standard PrismGo application, the `ServiceProvider` registers the log `Manager` as a singleton in the application container. The manager is constructed lazily — no files are opened and no channels are built until the first log write. This avoids I/O during the boot phase.

The `ServiceProvider` also registers a closer so that `Manager.Close()` is called when the application container is closed, ensuring all log files are properly flushed and file handles are released.

### Resource Cleanup

Calling `Manager.Close()` performs the following:

1. Acquires the internal lock to prevent concurrent writes during shutdown.
2. Iterates over all resolved channels and calls `Close()` on each channel's driver.
3. Marks the manager as closed. Subsequent log writes to a closed manager are silently discarded (returning `os.ErrClosed` for file drivers).

Always ensure `Close()` is called during application shutdown (typically handled automatically by the container lifecycle).

### Relationship with Global logrus

Application code should use the `logger.*` facade or inject a `*logger.Manager` directly. The global `logrus.StandardLogger()` is configured as a hook that routes calls to the default channel, ensuring backward compatibility for existing `logrus.*` calls during migration. New code should not expand the use of the global `logrus` logger.