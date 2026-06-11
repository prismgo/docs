# Exception

- [Introduction](#introduction)
- [Configuration](#configuration)
  - [Config File](#config-file)
  - [Configuration Parameters](#configuration-parameters)
- [Handling Exceptions](#handling-exceptions)
  - [Reporting Exceptions](#reporting-exceptions)
  - [Exception Log Levels](#exception-log-levels)
  - [Ignoring Exceptions](#ignoring-exceptions)
  - [Rendering Exceptions](#rendering-exceptions)
  - [Custom Problem JSON Rendering](#custom-problem-json-rendering)
  - [Custom Response Rendering](#custom-response-rendering)
- [HTTP Exceptions](#http-exceptions)
- [Problem Response Format](#problem-response-format)
- [Request Context Fields](#request-context-fields)
- [Handler Struct and Option Functions](#handler-struct-and-option-functions)
  - [Handler Fields](#handler-fields)
  - [Option Functions Reference](#option-functions-reference)
- [Facade Entry Points](#facade-entry-points)
- [Non-HTTP Context Usage](#non-http-context-usage)
- [Log Scrubbing](#log-scrubbing)
- [Replacing or Wrapping the Handler](#replacing-or-wrapping-the-handler)
- [Laravel Exception Handler Mapping](#laravel-exception-handler-mapping)

---

PrismGo's exception component provides a unified exception reporting and rendering mechanism, aligned with Laravel 13's `App\Exceptions\Handler` design philosophy. A single `Handler` serves both HTTP (Render + Report) and non-HTTP (Report only) contexts, with DontReport / Level / Reporter configurations fully shared across both.

---

## Introduction

The exception system centers on `exception.Handler`, which is responsible for panic recovery, safe HTTP response rendering, structured log writing, and custom extension callbacks. Business code configures exception handling behavior centrally through `foundation.WithExceptions` in `bootstrap/app.go`, aligned with Laravel's `withExceptions` closure usage.

All exception operations explicitly accept `context.Context`, log fields use `map[string]any`, and return values carry `error` (the Report path is void; errors are handled internally by the logging system).

## Configuration

### Config File

Exception-related configuration is registered in `config/app.go`, with environment variable overrides:

```go
// config/app.go
func init() {
    config.Add("app", func() map[string]interface{} {
        return map[string]interface{}{
            // ...
            "debug":             config.Env("APP_DEBUG", false),
            "server": map[string]interface{}{
                // exception_handler controls whether the unified HTTP exception handler is enabled,
                // covering error logging and panic recovery.
                "exception_handler": config.Env("SERVER_EXCEPTION_HANDLER", true),
            },
        }
    })
}
```

### Configuration Parameters

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `app.debug` | `APP_DEBUG` | `false` | Debug mode toggle. When `true`, 5xx responses expose exception type, source file, line number, and stack trace to the client; must be `false` in production |
| `app.server.exception_handler` | `SERVER_EXCEPTION_HANDLER` | `true` | Whether to mount the unified exception handler in the HTTP middleware chain. When `false`, the middleware is not mounted and panics will not be recovered by the default handler, but calling `httpkit.Fail` directly will still render error responses |

> **Note**: `APP_DEBUG` must always be `false` in production. Setting it to `true` risks exposing sensitive configuration values and internal implementation details to end users.

## Handling Exceptions

### Reporting Exceptions

Exception reporting is used to log exceptions or send them to an external service like [Sentry](https://github.com/getsentry/sentry-laravel) or [OpenTelemetry](https://opentelemetry.io/). By default, exceptions are written to `logger.Channel("error")` at the appropriate log level.

If you need to report different types of exceptions in different ways, you may register custom reporters via `WithExceptions` in `bootstrap/app.go`:

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.Report(func(ctx any, err error, fields map[string]any) {
            // Send the exception to an external monitoring service
            sentry.CaptureException(err)
        })
    })
```

`Reporter` callbacks execute after the built-in log write, making them suitable for integrating Sentry, OpenTelemetry, enterprise WeChat alerts, and other external systems. The `ctx` parameter is `*gin.Context` in HTTP contexts and `context.Context` in non-HTTP contexts.

#### Package-Level Convenience Reporting

In non-HTTP scenarios (such as CLI commands, queue jobs, event listeners), you can use the package-level `exception.Report` function to quickly report exceptions:

```go
exception.Report(ctx, err, map[string]any{
    "job_id": jobID,
    "queue":  queueName,
})
```

#### Global Log Context

If you want to attach business identity fields (such as `tenant_id`, `user_id`) to every exception log entry, you may use the `Context` method:

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.Context(func(c *gin.Context) map[string]any {
            fields := map[string]any{}
            if tenantID, ok := c.Get("tenant_id"); ok {
                fields["tenant_id"] = tenantID
            }
            if userID, ok := c.Get("user_id"); ok {
                fields["user_id"] = userID
            }
            return fields
        })
    })
```

Extracted fields are only attached to exception logs and are never rendered in client error responses.

### Exception Log Levels

When exceptions are written to logs, messages are written at a specified log level, which indicates the severity or importance of the message. The default rule is: 5xx → `error`, everything else → `warn`.

You may customize the log level for specific exceptions using the `Level` method:

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.Level(func(err error, status int) exception.Level {
            if status == http.StatusTooManyRequests {
                return exception.LevelInfo
            }
            if status >= http.StatusInternalServerError {
                return exception.LevelError
            }
            return exception.LevelWarn
        })
    })
```

`LevelResolver` receives the raw exception and HTTP status code (0 in non-HTTP contexts), and returns an `exception.Level`. Returning an empty string falls back to the default rule.

#### Log Level Constants

| Constant | Value | Usage |
| --- | --- | --- |
| `exception.LevelDebug` | `"debug"` | Debug level, for ignorable exceptions |
| `exception.LevelInfo` | `"info"` | Info level, for notable events that don't affect functionality |
| `exception.LevelWarn` | `"warn"` | Warning level, default for 4xx client errors |
| `exception.LevelError` | `"error"` | Error level, default for 5xx server errors |

### Ignoring Exceptions

When building your application, there will be some types of exceptions you never want to report. You may use the `DontReport` method to ignore these exceptions:

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.DontReport(func(err error) bool {
            var biz *errkit.BizError
            if !errors.As(err, &biz) || biz == nil {
                return false
            }
            // Ignore 404 and 401
            switch errkit.HTTPStatus(biz) {
            case http.StatusNotFound, http.StatusUnauthorized:
                return true
            default:
                return false
            }
        })
    })
```

When a `Predicate` returns `true`, the matching exception is skipped for both log writing and reporter invocation. Multiple `Predicate` functions are evaluated in registration order; any match causes a skip.

The framework already filters `context.Canceled` and `context.DeadlineExceeded` by default, preventing process lifecycle signals from being reported as exceptions. To remove this default behavior, clear `Handler.DontReport` after construction.

### Rendering Exceptions

By default, the exception handler converts exceptions into Problem Details (RFC 7807) style JSON responses. You may register custom rendering closures to change the rendering behavior for specific exceptions:

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.Render(func(c *gin.Context, err error) (exception.Problem, bool) {
            var biz *errkit.BizError
            if !errors.As(err, &biz) || biz == nil {
                return exception.Problem{}, false
            }
            if biz.Type == "tenant.subscription_expired" {
                return exception.Problem{
                    Type:    "tenant.subscription_expired",
                    Title:   http.StatusText(http.StatusPaymentRequired),
                    Status:  http.StatusPaymentRequired,
                    Code:    biz.Code,
                    Message: "Subscription expired, please renew to continue",
                }, true
            }
            return exception.Problem{}, false
        })
    })
```

Returning `(Problem, true)` indicates the exception has been handled and the framework will render this as JSON. Returning `(Problem{}, false)` indicates the exception was not handled, and the next renderer or the default fallback will be tried.

### Custom Problem JSON Rendering

Suitable when you still want to return JSON, but need to adjust `type`, `status`, or `message` for specific business errors. Register an `exception.Renderer`:

```go
e.Render(func(c *gin.Context, err error) (exception.Problem, bool) {
    if errors.Is(err, ErrPaymentFailed) {
        return exception.Problem{
            Type:    "payment_failed",
            Title:   "Payment Failed",
            Status:  http.StatusPaymentRequired,
            Message: "Payment failed, please check your payment method",
        }, true
    }
    return exception.Problem{}, false
})
```

### Custom Response Rendering

Suitable when you want to return HTML, plain text, files, redirects, or other non-default JSON responses based on the request. Register an `exception.ResponseRenderer`:

```go
e.Render(func(c *gin.Context, err error) bool {
    if !strings.Contains(c.GetHeader("Accept"), "text/html") {
        return false
    }
    if !errkit.IsBizError(err, errkit.CodeNotFound) {
        return false
    }
    c.Data(http.StatusNotFound, "text/html; charset=utf-8", []byte("<h1>Page Not Found</h1>"))
    return true
})
```

Returning `true` indicates the error has been handled. You may use any Gin response method such as `c.HTML`, `c.Data`, `c.JSON`, or `c.Redirect`. Returning `false` indicates the error was not handled, and the next renderer or the default JSON fallback will be tried.

## HTTP Exceptions

Exceptions during HTTP request processing are automatically captured by the unified exception handling middleware from `github.com/prismgo/framework/http/middleware`, which provides:

1. **Panic recovery**: Catches panics and renders a safe 500 response, logging the panic value and stack trace.
2. **c.Errors handling**: Collects errors accumulated in the Gin context and reports them.
3. **4xx/5xx status code reporting**: Automatically writes exception logs for non-successful status codes.

The middleware is mounted via `middleware.UseWithConfig(engine, serverConfig)` and is controlled by the `SERVER_EXCEPTION_HANDLER` configuration.

The request tracking ID is not generated by the exception handling middleware. If you need to correlate errors, events, and logs with the same request, mount the middleware explicitly:

```go
engine.Use(middleware.RequestID())
```

## Problem Response Format

Error responses use the Problem Details (RFC 7807) style by default, while preserving business error codes and messages:

```json
{
    "type": "invalid_input",
    "title": "Bad Request",
    "status": 400,
    "code": 40001,
    "message": "Invalid parameters",
    "request_id": "..."
}
```

The `request_id` field only appears when the application has explicitly mounted `middleware.RequestID()` or an equivalent middleware that writes to `gin.Context["request_id"]`; it is omitted by default when not enabled.

Field validation errors can additionally return an `errors` object:

```json
{
    "type": "invalid_input",
    "title": "Bad Request",
    "status": 400,
    "code": 40001,
    "message": "Invalid parameters",
    "request_id": "...",
    "errors": {
        "phone": ["Phone number is required"]
    }
}
```

### Problem Struct Fields

| Field | JSON Key | Type | Description |
| --- | --- | --- | --- |
| `Type` | `type` | `string` | Error type identifier (e.g., `"not_found"`, `"internal_error"`) |
| `Title` | `title` | `string` | Error title (HTTP status text) |
| `Status` | `status` | `int` | HTTP status code |
| `Detail` | `detail` | `string` | Detailed explanation (4xx uses PublicMessage, 5xx defaults to `"Internal Server Error"`) |
| `Instance` | `instance` | `string` | Instance identifier |
| `Code` | `code` | `int` | Business error code |
| `Message` | `message` | `string` | Message |
| `RequestID` | `request_id` | `string` | Request ID |
| `Errors` | `errors` | `map[string]any` | Field-level errors (from `PublicFields()` interface) |
| `Exception` | `exception` | `string` | Exception type name in debug mode |
| `File` | `file` | `string` | Source file in debug mode |
| `Line` | `line` | `int` | Line number in debug mode |
| `Trace` | `trace` | `[]string` | Full stack trace in debug mode |

### HTTPError Interface

`HTTPError` is the minimal HTTP error contract, exposing a safe status code and public message:

```go
type HTTPError interface {
    error
    StatusCode() int
    PublicMessage() string
}
```

Error types implementing `HTTPError` have their `StatusCode()` and `PublicMessage()` used to build the Problem response. 4xx errors return `PublicMessage()` as the `detail` to the client; 5xx errors default to `"Internal Server Error"` and only expose internal details when `APP_DEBUG=true`.

### Default Responses Never Expose

- SQL statements or database driver errors
- Raw panic stacks
- File paths and line numbers
- Internal third-party service error details
- Sensitive fields such as tokens, passwords, or ID numbers

## Request Context Fields

The default exception handler includes the following fields when writing to `logger.Channel("error")`:

| Field | Type | Description |
| --- | --- | --- |
| `status` | `int` | HTTP status code |
| `method` | `string` | Request method |
| `path` | `string` | Gin route template |
| `url` | `string` | Request path |
| `query` | `string` | Query string |
| `client_ip` | `string` | Client IP |
| `duration_ms` | `int64` | Request duration in milliseconds |
| `request_id` | `string` | Request ID; only included when explicitly injected by the application |
| `errors` | `string` | Errors collected from Gin context (`|` separated) |
| `panic` | `string` | Panic value when a panic is recovered |
| `stack` | `string` | Stack trace for panics or 5xx errors |
| `error_code` | `int` | Business error code (from `BusinessCode()` interface) |
| `error_type` | `string` | Business error type (from `ErrorType()` interface) |
| `error_context` | `map[string]any` | Structured context from `BizError.Context` |
| `field_errors` | `map[string]any` | Field errors (from `PublicFields()` interface) |

## Handler Struct and Option Functions

### Handler Fields

`exception.Handler` is the framework's unified exception handler. Public fields allow business code to override specific behaviors via struct embedding:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `DontReport` | `[]Predicate` | `[DefaultDontReport]` | Exception filter chain for non-reporting, aligned with Laravel `$dontReport` |
| `LevelResolver` | `LevelResolver` | `nil` (uses default rule) | Custom log level mapping |
| `Reporters` | `[]Reporter` | `nil` | Custom reporter chain |
| `RecoverPanics` | `bool` | `true` | Whether to recover panics in HTTP middleware |
| `LogErrors` | `bool` | `true` | Whether to write built-in exception logs |
| `LogClientErrors` | `bool` | `true` | Whether to log 4xx client errors |
| `PanicStack` | `bool` | `true` | Whether to attach full stack traces to exception logs |
| `DebugResolver` | `func() bool` | `DefaultDebugResolver` (returns `false`) | Reads the application debug toggle, defaults to reading `app.debug` |
| `ContextExtractor` | `ContextExtractor` | `nil` | Extracts identity fields from request context |
| `Renderers` | `[]rendererEntry` | `nil` | Custom renderer chain |

### Option Functions Reference

All `With*` functions return `Option`, applied via `New(opts...)` or `ApplyOptions(opts...)`. Option-style functional configuration avoids constructor parameter bloat and makes it easy to extend with new configuration items.

| Option Function | Parameter Type | Description | Laravel Equivalent |
| --- | --- | --- | --- |
| `WithDontReport(p)` | `Predicate` | Append a non-reporting predicate | `$exceptions->dontReport()` |
| `WithLevel(resolve)` | `LevelResolver` | Custom log level mapping | `$exceptions->level()` |
| `WithReporter(reporter)` | `Reporter` | Register a custom reporter | `$exceptions->report()` |
| `WithRecovery(enabled)` | `bool` | Control panic recovery | — |
| `WithLogging(enabled)` | `bool` | Control log writing | — |
| `WithClientErrorLogging(enabled)` | `bool` | Control 4xx logging | — |
| `WithPanicStack(enabled)` | `bool` | Control stack trace collection | — |
| `WithDebug(enabled)` | `bool` | Fixed debug toggle | `APP_DEBUG` |
| `WithDebugResolver(resolve)` | `func() bool` | Dynamic debug toggle | `APP_DEBUG` |
| `WithContext(extract)` | `ContextExtractor` | Request context field extraction | `$exceptions->context()` |
| `WithRenderer(renderer)` | `Renderer` | Register a Problem JSON renderer | `$exceptions->render()` (JSON path) |
| `WithResponseRenderer(renderer)` | `ResponseRenderer` | Register a custom response renderer | `$exceptions->render()` (custom response path) |

### Type Definitions

#### Predicate

```go
type Predicate func(error) bool
```

Exception filter predicate function. Returns `true` to indicate the exception should be skipped for logging and reporting. Multiple `Predicate` functions are evaluated in registration order; any match causes a skip.

#### LevelResolver

```go
type LevelResolver func(err error, status int) Level
```

Selects the log level based on the error and HTTP status code. `status` is 0 in non-HTTP contexts. Returning an empty string falls back to the default rule (5xx → `error`, everything else → `warn`).

#### Reporter

```go
type Reporter func(ctx any, err error, fields map[string]any)
```

Custom exception reporter. `ctx` is `*gin.Context` in HTTP contexts and `context.Context` in non-HTTP contexts. Executes after the built-in log write.

#### ContextExtractor

```go
type ContextExtractor func(c *gin.Context) map[string]any
```

Extracts identity fields from the request context. Fields are only attached to logs and never rendered to the client.

#### Renderer

```go
type Renderer func(c *gin.Context, err error) (Problem, bool)
```

Custom Problem JSON renderer. Returns `(Problem, true)` to indicate the exception has been handled; `(Problem{}, false)` to skip and try the next renderer.

#### ResponseRenderer

```go
type ResponseRenderer func(c *gin.Context, err error) bool
```

Custom full response renderer. Returns `true` to indicate the error has been handled. You may use any Gin response method such as `c.HTML`, `c.Data`, or `c.JSON`.

## Facade Entry Points

The `exception` package provides the following package-level convenience functions:

| Function | Signature | Description |
| --- | --- | --- |
| `Resolve` | `func Resolve() *Handler` | Resolves the exception handler from the Application container, registry key is `"exception.handler"` |
| `Report` | `func Report(ctx context.Context, err error, fields map[string]any)` | Package-level convenience reporting entry, reports exceptions through the current Handler |
| `Render` | `func Render(c *gin.Context, err error) int` | Package-level convenience rendering entry, renders HTTP error responses through the current Handler |
| `BuildAndRegister` | `func BuildAndRegister(opts []Option, factory func(*Handler) *Handler) *Handler` | Builds a Handler and returns the instance, for use by bootstrap |

### Handler Methods

| Method | Signature | Description |
| --- | --- | --- |
| `Report` | `func (h *Handler) Report(ctx context.Context, err error, fields map[string]any)` | Unified reporting entry (shared by HTTP and non-HTTP) |
| `Render` | `func (h *Handler) Render(c *gin.Context, err error) int` | Renders a safe HTTP response, returns the final status code |
| `ShouldReport` | `func (h *Handler) ShouldReport(err error, status int) bool` | Determines whether the exception should be reported: checks LogErrors, LogClientErrors, and the DontReport chain |
| `Level` | `func (h *Handler) Level(err error, status int) Level` | Returns the log level: checks LevelResolver first, falls back to default if empty |
| `Debug` | `func (h *Handler) Debug() bool` | Reads the debug toggle, determines whether to expose debug information to the client |
| `ApplyOptions` | `func (h *Handler) ApplyOptions(opts ...Option)` | Batch applies Options, used in the foundation assembly flow |

## Non-HTTP Context Usage

The following framework modules use `exception.Report()` to report exceptions in non-HTTP contexts:

| Module | Scenario |
| --- | --- |
| `github.com/prismgo/framework/kernel` | CLI command panic recovery and execution error reporting |
| `github.com/prismgo/framework/routine` | Safe goroutine panic recovery and error reporting |
| `github.com/prismgo/framework/queue` | Queue job final failure reporting |
| `github.com/prismgo/framework/horizon` | Supervisor/worker runtime error reporting |
| `github.com/prismgo/framework/event` | Event listener panic/error reporting |

In non-HTTP paths, `status` defaults to 500 and `fields` are provided by the caller.

## Log Scrubbing

The exception handler automatically scrubs log fields to prevent sensitive information from being written to logs:

- Sensitive key patterns: `password`, `secret`, `token`, `key`, `authorization`, `cookie`, `payload`, `raw_body`, `body_base64`
- Matching values are replaced with `"[redacted]"`
- Nested `map[string]any`, `map[string]string`, and `[]any` are processed recursively
- Exception: `service_key` is not scrubbed (it is a container binding identifier and does not contain credentials)

## Replacing or Wrapping the Handler

If fine-grained extensions are insufficient, you can completely replace or wrap the default Handler.

### Wrapping the Default Handler

Prefer wrapping to preserve the default safe responses, logging, panic recovery, and `WithExceptions` fine-grained configuration:

```go
type ObservedExceptionHandler struct {
    next httpkit.ExceptionHandlerDriver
}

func (h ObservedExceptionHandler) Middleware() gin.HandlerFunc {
    next := h.next.Middleware()
    return func(c *gin.Context) {
        start := time.Now()
        next(c)
        if c.Writer.Status() >= http.StatusInternalServerError {
            logger.Channel("error").WithFields(map[string]any{
                "path":        c.Request.URL.Path,
                "status":      c.Writer.Status(),
                "duration_ms": time.Since(start).Milliseconds(),
            }).Warn("observed server error")
        }
    }
}

func (h ObservedExceptionHandler) Render(c *gin.Context, err error) int {
    return h.next.Render(c, err)
}
```

Registration:

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.Handler(func(cfg httpkit.ServerConfig, next httpkit.ExceptionHandlerDriver) httpkit.ExceptionHandlerDriver {
            return ObservedExceptionHandler{next: next}
        })
    })
```

### Replacing the Handler

Only do this when you truly need to take over response rendering, logging, and panic recovery entirely:

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.Use(PlainTextExceptionHandler{})
    })
```

> **Note**: After a full replacement, the default `Problem` response, default error log fields, and default panic stack recording are all your responsibility. If you only need to add monitoring, adjust log fields, or customize a few responses, prefer wrapping the default Handler or using fine-grained extensions.

## Laravel Exception Handler Mapping

| Laravel Method | PrismGo Equivalent |
| --- | --- |
| `$exceptions->report(fn)` | `e.Report(func(ctx any, err error, fields map[string]any) { ... })` |
| `$exceptions->render(fn)` | `e.Render(func(c *gin.Context, err error) (exception.Problem, bool) { ... })` |
| `$exceptions->context(fn)` | `e.Context(func(c *gin.Context) map[string]any { ... })` |
| `$exceptions->level(Class, Level)` | `e.Level(func(err error, status int) exception.Level { ... })` |
| `$exceptions->dontReport([Class])` | `e.DontReport(func(err error) bool { ... })` |
| `$exceptions->dontReportWhen(fn)` | `e.DontReport(func(err error) bool { ... })` |
| `$exceptions->stopIgnoring(Class)` | Clear `Handler.DontReport` then re-register |
| `$exceptions->shouldRenderJsonWhen(fn)` | Register a `ResponseRenderer` via `e.Render` and decide yourself |
| `$exceptions->respond(fn)` | Wrap the default Handler via `e.Handler` and intercept |
| `APP_DEBUG` | `APP_DEBUG` (semantics fully aligned) |
| `Handler::$dontReport` | `Handler.DontReport []Predicate` |
| `Handler::report()` | `Handler.Report(ctx, err, fields)` |
| `Handler::render()` | `Handler.Render(c, err)` |
| `Handler::shouldReport()` | `Handler.ShouldReport(err, status)` |
| `Handler::level()` | `Handler.Level(err, status)` |
| `report($e)` helper | `exception.Report(ctx, err, nil)` |
| `abort(404)` | `httpkit.AbortWithBizError(c, errkit.ErrNotFound(...))` |
| Custom error pages | Register a `ResponseRenderer` via `e.Render`, use `c.HTML` |
