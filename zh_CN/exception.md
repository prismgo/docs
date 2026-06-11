# Exception

- [简介](#简介)
- [配置](#配置)
  - [配置文件](#配置文件)
  - [配置参数说明](#配置参数说明)
- [异常处理](#异常处理)
  - [上报异常](#上报异常)
  - [异常日志级别](#异常日志级别)
  - [忽略异常](#忽略异常)
  - [渲染异常](#渲染异常)
  - [自定义 Problem JSON 渲染](#自定义-problem-json-渲染)
  - [自定义完整响应渲染](#自定义完整响应渲染)
- [HTTP 异常](#http-异常)
- [Problem 响应格式](#problem-响应格式)
- [请求上下文字段](#请求上下文字段)
- [Handler 结构体与 Option 函数](#handler-结构体与-option-函数)
  - [Handler 字段说明](#handler-字段说明)
  - [Option 函数一览](#option-函数一览)
- [Facade 入口](#facade-入口)
- [非 HTTP 上下文使用](#非-http-上下文使用)
- [日志脱敏](#日志脱敏)
- [完整替换或包裹 Handler](#完整替换或包裹-handler)
- [与 Laravel Exception Handler 的对应关系](#与-laravel-exception-handler-的对应关系)

---

PrismGo 的异常处理组件提供统一的异常上报与渲染机制，对齐 Laravel 13 `App\Exceptions\Handler` 设计哲学。单一 `Handler` 同时服务 HTTP（Render + Report）和非 HTTP（仅 Report）上下文，DontReport / Level / Reporter 配置在两种上下文中完全共享。

---

## 简介

异常处理系统以 `exception.Handler` 为核心，负责 panic 恢复、安全 HTTP 响应渲染、结构化日志写入和自定义扩展回调。业务代码通过 `foundation.WithExceptions` 在 `bootstrap/app.go` 中集中配置异常处理行为，对齐 Laravel `withExceptions` 闭包的用法。

所有异常操作显式接收 `context.Context`，日志字段使用 `map[string]any`，返回值携带 `error`（Report 路径为 void，错误由日志系统内部处理）。

## 配置

### 配置文件

异常处理相关配置注册在 `config/app.go`，通过环境变量覆盖：

```go
// config/app.go
func init() {
    config.Add("app", func() map[string]interface{} {
        return map[string]interface{}{
            // ...
            "debug":             config.Env("APP_DEBUG", false),
            "server": map[string]interface{}{
                // exception_handler 控制是否启用统一 HTTP 异常处理器，覆盖错误日志与 panic 恢复。
                "exception_handler": config.Env("SERVER_EXCEPTION_HANDLER", true),
            },
        }
    })
}
```

### 配置参数说明

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `app.debug` | `APP_DEBUG` | `false` | 调试模式开关。`true` 时 5xx 响应会向客户端暴露异常类型、源文件、行号和调用栈；生产环境必须为 `false` |
| `app.server.exception_handler` | `SERVER_EXCEPTION_HANDLER` | `true` | 是否在 HTTP 中间件链中挂载统一异常处理器。`false` 时不挂载中间件，panic 不会被默认 handler 恢复，但主动调用 `httpkit.Fail` 仍会渲染错误响应 |

> **注意**：`APP_DEBUG` 在生产环境必须设为 `false`。设为 `true` 会向终端用户暴露敏感配置值和内部实现细节。

## 异常处理

### 上报异常

异常上报用于将异常写入日志或发送到外部服务（如 Sentry、OpenTelemetry）。默认情况下，异常会按日志级别写入 `logger.Channel("error")` 通道。

如果你需要以不同方式上报不同类型的异常，可以在 `bootstrap/app.go` 中通过 `WithExceptions` 注册自定义上报器：

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.Report(func(ctx any, err error, fields map[string]any) {
            // 将异常发送到外部监控服务
            sentry.CaptureException(err)
        })
    })
```

`Reporter` 在内置日志写入之后执行，适合接入 Sentry、OpenTelemetry、企业微信告警等外部系统。`ctx` 在 HTTP 上下文中为 `*gin.Context`，在非 HTTP 上下文中为 `context.Context`。

#### 包级便捷上报

在非 HTTP 场景（如 CLI 命令、队列任务、事件监听器）中，可以使用包级 `exception.Report` 函数快速上报异常：

```go
exception.Report(ctx, err, map[string]any{
    "job_id": jobID,
    "queue":  queueName,
})
```

#### 全局日志上下文

如果你希望为每条异常日志附加业务身份字段（如 `tenant_id`、`user_id`），可以使用 `Context` 方法：

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

提取的字段仅附加到异常日志，不会被渲染到客户端错误响应中。

### 异常日志级别

异常写入日志时使用指定的日志级别，表示消息的严重程度。默认规则为：5xx → `error`，其余 → `warn`。

你可以通过 `Level` 方法自定义特定异常的日志级别：

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

`LevelResolver` 接收原始异常和 HTTP 状态码（非 HTTP 上下文中为 0），返回 `exception.Level`。返回空字符串时回退到默认规则。

#### 日志级别常量

| 常量 | 值 | 用途 |
| --- | --- | --- |
| `exception.LevelDebug` | `"debug"` | 调试级别，用于可忽略的异常 |
| `exception.LevelInfo` | `"info"` | 信息级别，用于值得关注但不影响功能的事件 |
| `exception.LevelWarn` | `"warn"` | 警告级别，默认用于 4xx 客户端错误 |
| `exception.LevelError` | `"error"` | 错误级别，默认用于 5xx 服务端错误 |

### 忽略异常

构建应用时，某些类型的异常你可能永远不想上报。可以使用 `DontReport` 方法忽略这些异常：

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.DontReport(func(err error) bool {
            var biz *errkit.BizError
            if !errors.As(err, &biz) || biz == nil {
                return false
            }
            // 忽略 404 和 401
            switch errkit.HTTPStatus(biz) {
            case http.StatusNotFound, http.StatusUnauthorized:
                return true
            default:
                return false
            }
        })
    })
```

`Predicate` 返回 `true` 时，匹配的异常将被跳过日志写入和上报器调用。多个 `Predicate` 按注册顺序求值，任一命中即跳过。

框架默认已过滤 `context.Canceled` 和 `context.DeadlineExceeded`，避免将进程生命周期信号当作异常上报。如需移除默认行为，可在构造后清空 `Handler.DontReport`。

### 渲染异常

默认情况下，异常处理器会将异常转换为 Problem Details 风格的 JSON 响应。你可以注册自定义渲染闭包来改变特定异常的渲染行为：

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
                    Message: "订阅已过期，请续费后继续使用",
                }, true
            }
            return exception.Problem{}, false
        })
    })
```

返回 `(Problem, true)` 表示已处理，框架将以此响应渲染 JSON；返回 `(Problem{}, false)` 表示未处理，继续尝试下一个渲染器或回退默认。

### 自定义 Problem JSON 渲染

适合仍返回 JSON，但需要针对特定业务错误调整 `type`、`status` 或 `message` 的场景。注册 `exception.Renderer`：

```go
e.Render(func(c *gin.Context, err error) (exception.Problem, bool) {
    if errors.Is(err, ErrPaymentFailed) {
        return exception.Problem{
            Type:    "payment_failed",
            Title:   "Payment Failed",
            Status:  http.StatusPaymentRequired,
            Message: "支付失败，请检查支付方式",
        }, true
    }
    return exception.Problem{}, false
})
```

### 自定义完整响应渲染

适合根据请求返回 HTML、纯文本、文件、重定向等非默认 JSON 响应。注册 `exception.ResponseRenderer`：

```go
e.Render(func(c *gin.Context, err error) bool {
    if !strings.Contains(c.GetHeader("Accept"), "text/html") {
        return false
    }
    if !errkit.IsBizError(err, errkit.CodeNotFound) {
        return false
    }
    c.Data(http.StatusNotFound, "text/html; charset=utf-8", []byte("<h1>页面不存在</h1>"))
    return true
})
```

返回 `true` 表示已处理该错误，可使用 `c.HTML`、`c.Data`、`c.JSON` 或 `c.Redirect` 等任意 Gin 响应方法；返回 `false` 表示未处理，继续尝试下一个渲染器或回退默认 JSON。

## HTTP 异常

HTTP 请求处理中的异常由 `github.com/prismgo/framework/http/middleware` 的统一异常处理中间件自动捕获，行为包括：

1. **panic 恢复**：捕获 panic 并渲染 500 安全响应，记录 panic 值和调用栈。
2. **c.Errors 处理**：收集 Gin context 中累积的错误并上报。
3. **4xx/5xx 状态码上报**：对非正常状态码自动写入异常日志。

中间件通过 `middleware.UseWithConfig(engine, serverConfig)` 挂载，受 `SERVER_EXCEPTION_HANDLER` 配置控制。

请求追踪 ID 不由异常处理中间件生成。如需在错误响应、事件和日志中串联同一请求，应显式挂载：

```go
engine.Use(middleware.RequestID())
```

## Problem 响应格式

错误响应默认使用 Problem Details（RFC 7807）风格，同时保留业务错误码和消息：

```json
{
    "type": "invalid_input",
    "title": "Bad Request",
    "status": 400,
    "code": 40001,
    "message": "参数错误",
    "request_id": "..."
}
```

`request_id` 仅在应用已显式挂载 `middleware.RequestID()` 或等价中间件写入 `gin.Context["request_id"]` 时出现；未启用时默认省略。

字段校验错误可以额外返回 `errors`：

```json
{
    "type": "invalid_input",
    "title": "Bad Request",
    "status": 400,
    "code": 40001,
    "message": "参数错误",
    "request_id": "...",
    "errors": {
        "phone": ["手机号不能为空"]
    }
}
```

### Problem 结构体字段

| 字段 | JSON 键 | 类型 | 说明 |
| --- | --- | --- | --- |
| `Type` | `type` | `string` | 错误类型标识（如 `"not_found"`、`"internal_error"`） |
| `Title` | `title` | `string` | 错误标题（HTTP 状态文本） |
| `Status` | `status` | `int` | HTTP 状态码 |
| `Detail` | `detail` | `string` | 详细说明（4xx 用 PublicMessage，5xx 默认 `"Internal Server Error"`） |
| `Instance` | `instance` | `string` | 实例标识 |
| `Code` | `code` | `int` | 业务错误码 |
| `Message` | `message` | `string` | 消息 |
| `RequestID` | `request_id` | `string` | 请求 ID |
| `Errors` | `errors` | `map[string]any` | 字段级错误（来自 `PublicFields()` 接口） |
| `Exception` | `exception` | `string` | 调试模式下的异常类型名 |
| `File` | `file` | `string` | 调试模式下的源文件 |
| `Line` | `line` | `int` | 调试模式下的行号 |
| `Trace` | `trace` | `[]string` | 调试模式下的完整调用栈 |

### HTTPError 接口

`HTTPError` 是最小 HTTP 错误契约，暴露安全的状态码和公开消息：

```go
type HTTPError interface {
    error
    StatusCode() int
    PublicMessage() string
}
```

实现了 `HTTPError` 的错误类型，其 `StatusCode()` 和 `PublicMessage()` 会被用于构建 Problem 响应。4xx 错误会将 `PublicMessage()` 作为 `detail` 返回给客户端；5xx 错误默认返回 `"Internal Server Error"`，仅在 `APP_DEBUG=true` 时暴露内部详情。

### 默认响应不会暴露以下内部信息

- SQL 语句或数据库驱动错误
- panic 原始堆栈
- 文件路径和行号
- 内部第三方服务错误详情
- token、密码、身份证号等敏感字段

## 请求上下文字段

默认异常处理器写入 `logger.Channel("error")` 时包含以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `int` | HTTP 状态码 |
| `method` | `string` | 请求方法 |
| `path` | `string` | Gin 路由模板 |
| `url` | `string` | 请求路径 |
| `query` | `string` | 查询字符串 |
| `client_ip` | `string` | 客户端 IP |
| `duration_ms` | `int64` | 请求耗时（毫秒） |
| `request_id` | `string` | 请求 ID；仅在应用显式注入时包含 |
| `errors` | `string` | Gin context 中收集到的错误（`|` 分隔） |
| `panic` | `string` | panic 恢复时的 panic 值 |
| `stack` | `string` | panic 或 5xx 错误时的堆栈 |
| `error_code` | `int` | 业务错误码（来自 `BusinessCode()` 接口） |
| `error_type` | `string` | 业务错误类型（来自 `ErrorType()` 接口） |
| `error_context` | `map[string]any` | `BizError.Context` 中的结构化上下文 |
| `field_errors` | `map[string]any` | 字段错误（来自 `PublicFields()` 接口） |

## Handler 结构体与 Option 函数

### Handler 字段说明

`exception.Handler` 是框架统一异常处理器，公开字段允许业务侧通过 struct embedding 覆盖特定行为：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DontReport` | `[]Predicate` | `[DefaultDontReport]` | 不上报的异常过滤链，对齐 Laravel `$dontReport` |
| `LevelResolver` | `LevelResolver` | `nil`（使用默认规则） | 自定义日志级别映射 |
| `Reporters` | `[]Reporter` | `nil` | 自定义上报器链 |
| `RecoverPanics` | `bool` | `true` | 是否在 HTTP 中间件中恢复 panic |
| `LogErrors` | `bool` | `true` | 是否写入内置异常日志 |
| `LogClientErrors` | `bool` | `true` | 是否记录 4xx 客户端错误 |
| `PanicStack` | `bool` | `true` | 异常日志是否附带完整调用栈 |
| `DebugResolver` | `func() bool` | `DefaultDebugResolver`（返回 `false`） | 读取应用调试开关，默认读 `app.debug` |
| `ContextExtractor` | `ContextExtractor` | `nil` | 从请求上下文提取身份字段 |
| `Renderers` | `[]rendererEntry` | `nil` | 自定义渲染器链 |

### Option 函数一览

所有 `With*` 函数返回 `Option`，通过 `New(opts...)` 或 `ApplyOptions(opts...)` 应用。Option 函数式配置避免了构造函数参数膨胀，且易于扩展新配置项。

| Option 函数 | 参数类型 | 说明 | Laravel 对应 |
| --- | --- | --- | --- |
| `WithDontReport(p)` | `Predicate` | 追加不上报断言 | `$exceptions->dontReport()` |
| `WithLevel(resolve)` | `LevelResolver` | 自定义日志级别映射 | `$exceptions->level()` |
| `WithReporter(reporter)` | `Reporter` | 注册自定义上报器 | `$exceptions->report()` |
| `WithRecovery(enabled)` | `bool` | 控制 panic 恢复 | — |
| `WithLogging(enabled)` | `bool` | 控制日志写入 | — |
| `WithClientErrorLogging(enabled)` | `bool` | 控制 4xx 日志 | — |
| `WithPanicStack(enabled)` | `bool` | 控制调用栈采集 | — |
| `WithDebug(enabled)` | `bool` | 固定调试开关 | `APP_DEBUG` |
| `WithDebugResolver(resolve)` | `func() bool` | 动态调试开关 | `APP_DEBUG` |
| `WithContext(extract)` | `ContextExtractor` | 请求上下文字段提取 | `$exceptions->context()` |
| `WithRenderer(renderer)` | `Renderer` | 注册 Problem JSON 渲染器 | `$exceptions->render()`（JSON 路径） |
| `WithResponseRenderer(renderer)` | `ResponseRenderer` | 注册自定义响应渲染器 | `$exceptions->render()`（自定义响应路径） |

### 类型定义

#### Predicate

```go
type Predicate func(error) bool
```

异常过滤断言函数。返回 `true` 表示该异常应跳过日志和上报。多个 `Predicate` 按注册顺序求值，任一命中即跳过。

#### LevelResolver

```go
type LevelResolver func(err error, status int) Level
```

根据错误和 HTTP 状态码选择日志级别。`status` 在非 HTTP 上下文中为 0。返回空字符串时回退默认规则（5xx → `error`，其余 → `warn`）。

#### Reporter

```go
type Reporter func(ctx any, err error, fields map[string]any)
```

自定义异常上报器。`ctx` 在 HTTP 上下文中为 `*gin.Context`，非 HTTP 为 `context.Context`。在日志写入之后执行。

#### ContextExtractor

```go
type ContextExtractor func(c *gin.Context) map[string]any
```

从请求上下文提取身份字段，仅附加到日志不渲染到客户端。

#### Renderer

```go
type Renderer func(c *gin.Context, err error) (Problem, bool)
```

自定义 Problem JSON 渲染器。返回 `(Problem, true)` 表示已处理；`(Problem{}, false)` 表示跳过。

#### ResponseRenderer

```go
type ResponseRenderer func(c *gin.Context, err error) bool
```

自定义完整响应渲染器。返回 `true` 表示已处理，可使用 `c.HTML`/`c.Data`/`c.JSON` 等任意 Gin 响应方法。

## Facade 入口

`exception` 包提供以下包级便捷函数：

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Resolve` | `func Resolve() *Handler` | 从 Application 容器解析异常处理器，registry key 为 `"exception.handler"` |
| `Report` | `func Report(ctx context.Context, err error, fields map[string]any)` | 包级便捷上报入口，通过当前 Handler 上报异常 |
| `Render` | `func Render(c *gin.Context, err error) int` | 包级便捷渲染入口，通过当前 Handler 渲染 HTTP 错误响应 |
| `BuildAndRegister` | `func BuildAndRegister(opts []Option, factory func(*Handler) *Handler) *Handler` | 构建 Handler 并返回实例，供 bootstrap 调用 |

### Handler 方法

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `Report` | `func (h *Handler) Report(ctx context.Context, err error, fields map[string]any)` | 统一上报入口（HTTP 和非 HTTP 共用） |
| `Render` | `func (h *Handler) Render(c *gin.Context, err error) int` | 渲染安全 HTTP 响应，返回最终状态码 |
| `ShouldReport` | `func (h *Handler) ShouldReport(err error, status int) bool` | 判断是否应上报：检查 LogErrors、LogClientErrors、DontReport 链 |
| `Level` | `func (h *Handler) Level(err error, status int) Level` | 返回日志级别：先查 LevelResolver，空则回退默认 |
| `Debug` | `func (h *Handler) Debug() bool` | 读取调试开关，决定是否向客户端暴露调试信息 |
| `ApplyOptions` | `func (h *Handler) ApplyOptions(opts ...Option)` | 批量应用 Option，用于 foundation 装配流程 |

## 非 HTTP 上下文使用

以下框架模块在非 HTTP 上下文中使用 `exception.Report()` 上报异常：

| 模块 | 场景 |
| --- | --- |
| `github.com/prismgo/framework/kernel` | CLI 命令 panic 恢复和执行错误上报 |
| `github.com/prismgo/framework/routine` | 安全协程 panic 恢复和错误上报 |
| `github.com/prismgo/framework/queue` | 队列任务最终失败后上报 |
| `github.com/prismgo/framework/horizon` | supervisor/worker 运行时错误上报 |
| `github.com/prismgo/framework/event` | 事件监听器 panic/错误上报 |

非 HTTP 路径中 `status` 默认为 500，`fields` 由调用方提供。

## 日志脱敏

异常处理器自动对日志字段进行脱敏，防止敏感信息写入日志：

- 敏感 key 模式：`password`、`secret`、`token`、`key`、`authorization`、`cookie`、`payload`、`raw_body`、`body_base64`
- 匹配的值替换为 `"[redacted]"`
- 递归处理嵌套 `map[string]any`、`map[string]string`、`[]any`
- 特例：`service_key` 不脱敏（是容器绑定标识，不含凭据）

## 完整替换或包裹 Handler

如果细粒度扩展不够，可以完整替换或包裹默认 Handler。

### 包裹默认 Handler

推荐优先使用包裹方式，保留默认安全响应、日志、panic 恢复和 `WithExceptions` 细粒度配置：

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

注册：

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.Handler(func(cfg httpkit.ServerConfig, next httpkit.ExceptionHandlerDriver) httpkit.ExceptionHandlerDriver {
            return ObservedExceptionHandler{next: next}
        })
    })
```

### 完整替换 Handler

只有在确实需要完全接管响应、日志和 panic 恢复时才建议这么做：

```go
foundation.Configure().
    WithExceptions(func(e *foundation.Exceptions) {
        e.Use(PlainTextExceptionHandler{})
    })
```

> **注意**：完整替换后，默认 `Problem` 响应、默认错误日志字段、默认 panic stack 记录都由用户 Handler 自己负责。如果只是要增加监控、调整日志字段或定制少量响应，优先包裹默认 Handler 或使用细粒度扩展。

## 与 Laravel Exception Handler 的对应关系

| Laravel 方法 | PrismGo 等价 |
| --- | --- |
| `$exceptions->report(fn)` | `e.Report(func(ctx any, err error, fields map[string]any) { ... })` |
| `$exceptions->render(fn)` | `e.Render(func(c *gin.Context, err error) (exception.Problem, bool) { ... })` |
| `$exceptions->context(fn)` | `e.Context(func(c *gin.Context) map[string]any { ... })` |
| `$exceptions->level(Class, Level)` | `e.Level(func(err error, status int) exception.Level { ... })` |
| `$exceptions->dontReport([Class])` | `e.DontReport(func(err error) bool { ... })` |
| `$exceptions->dontReportWhen(fn)` | `e.DontReport(func(err error) bool { ... })` |
| `$exceptions->stopIgnoring(Class)` | 清空 `Handler.DontReport` 后重新注册 |
| `$exceptions->shouldRenderJsonWhen(fn)` | 通过 `e.Render` 注册 `ResponseRenderer` 自行判断 |
| `$exceptions->respond(fn)` | 通过 `e.Handler` 包裹默认 Handler 后拦截 |
| `APP_DEBUG` | `APP_DEBUG`（语义完全对齐） |
| `Handler::$dontReport` | `Handler.DontReport []Predicate` |
| `Handler::report()` | `Handler.Report(ctx, err, fields)` |
| `Handler::render()` | `Handler.Render(c, err)` |
| `Handler::shouldReport()` | `Handler.ShouldReport(err, status)` |
| `Handler::level()` | `Handler.Level(err, status)` |
| `report($e)` helper | `exception.Report(ctx, err, nil)` |
| `abort(404)` | `httpkit.AbortWithBizError(c, errkit.ErrNotFound(...))` |
| Custom error pages | `e.Render` 注册 `ResponseRenderer`，使用 `c.HTML` |
