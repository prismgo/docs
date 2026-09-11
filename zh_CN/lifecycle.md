# 应用生命周期

- [介绍](#介绍)
- [生命周期概览](#生命周期概览)
    - [第一步](#第一步)
    - [应用启动引导](#应用启动引导)
    - [服务提供者](#服务提供者)
    - [HTTP 请求处理](#http-请求处理)
    - [Console 命令](#console-命令)
    - [关闭](#关闭)
- [生命周期事件](#生命周期事件)

## 介绍

在"现实世界"中使用任何工具时，如果你了解它的工作原理，你会感到更加自信。应用开发也不例外。当你理解了开发工具的内部运作方式，你会更加舒适和自信地使用它们。

这篇文档的目标是让你对 Prismgo 框架的底层运作方式有一个良好的高层次概览。通过更好地了解框架的整体结构，一切都会变得不那么"神奇"，你也会更加自信地构建你的应用。如果你暂时不能理解所有的术语，不要灰心！只需要对正在发生的事情有一个基本的把握，随着你探索文档的其他部分，你的知识会不断增长。

## 生命周期概览

### 第一步

Prismgo 应用的入口点是 `main.go`。这个文件是应用实例被创建、配置并交给 HTTP 服务器或 Console 内核的地方。`main.go` 文件本身并没有太多代码，它只是一个加载框架其余部分的起点。

Prismgo 的第一个动作是通过 `bootstrap.NewApplication()` 创建应用实例。这会调用 `foundation.Configure()`，构建一个 `Application` 实例，并注册框架所有的[服务提供者](/docs/{{version}}/service-provider)。

新项目从安装到第一个接口的完整流程见 [快速入门](starter.md)。HTTP 服务配置和 `serve` 进程控制见 [HTTP Server](http-server.md)。

```go
package main

import (
    "fmt"
    "os"

    "yourapp/bootstrap"

    _ "github.com/joho/godotenv/autoload"
)

func main() {
    app := bootstrap.NewApplication()

    if err := app.RunContext(func(ctx context.Context) error {
        return app.NewHTTPServer(ctx, "8051").ListenAndServe()
    }); err != nil {
        fmt.Fprintf(os.Stderr, "application: %v\n", err)
        os.Exit(1)
    }
}
```

### 应用启动引导

通过 `foundation.Configure().Create()` 创建 `Application` 实例后，框架开始启动引导序列。这个过程由 `Application.Boot()` 处理，`RunContext` 会在你的运行函数执行之前自动调用它。

启动引导阶段按顺序执行以下任务：

1. **基础提供者立即注册。** `event`、`config`、`logger` 和 `translation` 提供者一旦 `Application` 构造完成就立即执行它们的 `Register` 方法——在任何其他提供者被添加之前——这样事件总线和配置从一开始就可用。

2. **默认框架提供者被添加到仓库中。** `redis`、`cache`、`queue`、`cookie`、`session`、`filesystem`、`database`、`schema` 和 `route` 的提供者按依赖顺序添加。此时它们只是被排入队列；它们的 `Register` 和 `Boot` 方法尚未执行。

3. **扩展提供者被添加。** 通过 `WithExtensionProviders(...)` 声明的第三方或可选模块 Provider 被追加到框架默认 Provider 之后。扩展因此可以注册数据库、队列或文件系统驱动，同时仍可依赖框架核心绑定。

4. **你的应用提供者被添加。** `bootstrap/providers.go` 返回并通过 `WithProviders(...)` 声明的提供者被追加到扩展提供者之后，这样业务 Provider 可以安全地依赖或覆盖框架与扩展绑定。

5. **异常处理器被构建。** Prismgo 构建默认的[异常处理器](/docs/{{version}}/exception)，包括恢复、日志记录和 panic 堆栈记录，然后将其注册到容器中。

此时 `Application` 对象已经完全组装完毕，但除了基础提供者外，没有任何提供者执行了它们的生命周期方法。真正的工作在 `Boot()` 被调用时才开始。

### 服务提供者

`Application.Boot()` 方法是真正启动引导发生的地方。它遍历所有已注册的提供者，分两个阶段执行它们的生命周期方法：

**阶段 1 — Register：** `Register` 方法按仓库顺序在每个提供者上调用。在此阶段，提供者应该**只**将事物绑定到[服务容器](/docs/{{version}}/service-provider)中。它们不应尝试读取配置文件、建立连接、注册事件监听器，或做任何可能依赖尚未注册的服务的事情。

```go
func (ServiceProvider) Register(app providercontract.Application) error {
    c := app.Container()
    if c.Bound("cache.manager") {
        return nil
    }
    return c.Singleton("cache.manager", func(resolver containercontract.Resolver) (any, error) {
        cfg, err := buildConfig()
        if err != nil {
            return nil, err
        }
        return NewManager(cfg)
    }, container.WithCloser(func(m *Manager) error {
        return m.Close()
    }))
}
```

**阶段 2 — Boot：** 一旦所有提供者完成了注册，`Boot` 方法会在每个提供者上调用，同样按仓库顺序。由于所有 `Register` 方法都已经完成，你现在可以访问所有已注册的容器绑定——并且可以安全地注册事件监听器、挂载中间件、声明可发布资源，或连接跨服务桥接。

```go
func (ServiceProvider) Boot(providerApplication) error {
    UseEventSink(func(ctx context.Context, ev CacheEvent) {
        dispatchCurrentEvent(ctx, ev)
    })
    return nil
}
```

所有 eager provider 的两个阶段都完成后，Prismgo 派发 `app.booted` 事件，你的 `RunContext` 运行函数开始执行。

基本上，Prismgo 提供的每一个主要功能都是由服务提供者来启动引导和配置的。由于它们启动引导和配置了框架提供的如此多的功能，服务提供者是整个 Prismgo 启动流程中最重要的部分。

Provider 的稳定分层顺序是：框架默认 Provider → 扩展 Provider → 业务 Provider。同一顺序同时用于 Register 和 Boot，关闭期的 Terminable Provider 则按反序执行。第三方驱动等扩展使用 `WithExtensionProviders(...)`；应用业务能力使用 `WithProviders(...)`。

#### 延迟提供者

如果提供者**仅**在服务容器中注册绑定，你可以选择将其注册推迟到其中一个已注册的绑定真正被需要时再执行。延迟提供者不参与 `Boot()` 生命周期——它们的 `Register` 和 `Boot` 方法只在有东西尝试解析它们提供的服务键时才执行。

Prismgo 存储了一个所有服务键到其延迟提供者标识的映射。然后，只有当你尝试解析这些服务之一时，Prismgo 才会加载并启动该提供者。这提高了应用启动性能，因为延迟提供者不会在每次启动时都从磁盘加载。

要延迟加载提供者，实现 `DeferrableProvider` 接口并定义一个 `Provides` 方法，返回该提供者注册的服务容器绑定：

```go
type MyServiceProvider struct{}

func (MyServiceProvider) Register(app providercontract.Application) error {
    c := app.Container()
    if c.Bound("my.service") {
        return nil
    }
    return c.Singleton("my.service", func(resolver containercontract.Resolver) (any, error) {
        return NewMyService()
    })
}

func (MyServiceProvider) Boot(app providercontract.Application) error {
    return nil
}

func (MyServiceProvider) Provides() []string {
    return []string{"my.service"}
}
```

#### 动态注册提供者

应用即使在已经启动后也可以接受新的提供者。当你在已启动的应用上调用 `app.RegisterProvider()` 时，Prismgo 会立即执行该提供者的 `Register` 和 `Boot` 方法——无缝集成到运行中的应用中：

```go
app.Boot()

// 启动后动态添加提供者——Register 和 Boot 立即执行
if err := app.RegisterProvider(customProvider{}); err != nil {
    return err
}
```

### HTTP 请求处理

一旦应用启动引导完成，所有服务提供者都已注册，HTTP 服务器开始监听。当请求到达时，它流经以下管道：

1. Gin 引擎接收请求。
2. 如果挂载了 `RequestID` 中间件，会生成唯一的请求 ID 并附加到 context。
3. 访问日志中间件记录传入的请求。
4. 统一的 `ExceptionHandler` 中间件包裹管道的其余部分，提供 [panic 恢复、错误渲染和错误日志记录](/docs/{{version}}/exception)。
5. 业务中间件执行——身份认证、租户验证、权限注入，以及你注册的任何自定义中间件。
6. 路由器将请求匹配到路由，并将其分派到相应的控制器方法。
7. 控制器方法执行业务逻辑并返回响应。
8. 响应通过中间件链向外返回。
9. `ExceptionHandler` 捕获任何已记录但尚未写入响应的错误。
10. 错误日志写入 `logger.Channel("error")`。
11. 响应发送到客户端。

如果请求通过了所有匹配路由的已分配中间件，路由或控制器方法将被执行，并且路由或控制器方法返回的响应将通过路由的中间件链发送回去。

### Console 命令

Prismgo 也支持 Artisan 风格的 Console 命令。Console 命令的生命周期与 HTTP 请求生命周期是分开的，流经 Console 内核：

1. `main.go` 调用 `app.HandleCommand(ctx, argv)`，从当前应用运行时创建 Console 内核。
2. 内核进入其 starting 阶段，派发 `console.application.starting` 并执行任何已注册的 starting 回调——这是提供者声明的命令被挂载的地方。
3. 命令签名被解析，匹配的命令被解析。
4. `console.command.starting` 事件被派发。
5. 命令的 `Handle` 方法被执行。
6. 当命令完成时，`console.command.finished` 被派发，附带时间和错误信息。

Console 内核和 HTTP 服务器共享同一个 `Application` 实例，因此所有容器绑定、配置和已启动的服务对两者都可用。

### 关闭

当运行函数返回时——无论是因为正常完成，还是因为收到了系统信号（SIGINT/SIGTERM）——`RunContext` 调用 `Application.Close()` 来优雅地关闭一切。

关闭序列按以下顺序进行：

1. 应用的根 context 被取消，通知所有长时间运行的 goroutine 停止。
2. `app.terminating` 事件被派发，让监听器有机会执行关闭前的任务。
3. 所有实现了 `TerminableProvider` 接口的提供者的 `Terminate` 方法被调用——按**仓库反序**执行，这样依赖其他提供者的提供者先释放它们的资源。
4. 通过 `app.RegisterCleanup()` 注册的清理函数被执行，同样按反序执行。
5. 容器的普通资源（数据库连接、Redis 连接、文件句柄）被关闭。
6. 任何关闭错误通过仍存活的报告资源（错误日志器、异常报告器）上报。
7. 容器的报告资源被关闭。
8. `app.terminated` 事件被派发，附带总关闭耗时和任何发生的错误。

如果有任何容器资源关闭失败，`CloseContext` 可以再次调用——它只会重试尚未释放的资源，而不会重新执行提供者终止或清理阶段。

## 生命周期事件

Prismgo 在生命周期的关键点派发[事件](/docs/{{version}}/event)。这些事件以尽力而为的方式派发——如果事件派发器尚不可用（因为事件提供者本身尚未启动），事件会被简单地跳过，不影响启动结果。

以下是你的应用可以监听的生命周期事件：

| 事件 | Payload | 触发时机 |
| --- | --- | --- |
| `app.booting` | `AppBooting{Args}` | 所有 Register 阶段完成后，Boot 开始前 |
| `app.booted` | `AppBooted{Duration}` | 所有提供者的 Boot 完成后 |
| `app.terminating` | `AppTerminating{Reason}` | 关闭开始，context 取消后 |
| `app.terminated` | `AppTerminated{Duration, Error}` | 关闭完成，所有资源释放 |
| `app.provider.registering` | `ProviderRegistering{Provider}` | 单个提供者 Register 方法执行前 |
| `app.provider.registered` | `ProviderRegistered{Provider}` | 单个提供者 Register 方法执行后 |
| `app.provider.booting` | `ProviderBooting{Provider}` | 单个提供者 Boot 方法执行前 |
| `app.provider.booted` | `ProviderBooted{Provider}` | 单个提供者 Boot 方法执行后 |
| `server.starting` | `ServerStarting{Addr, PID}` | HTTP 服务器开始监听前 |
| `server.started` | `ServerStarted{Addr, PID}` | HTTP 服务器开始监听后 |
| `server.stopping` | `ServerStopping{Addr, Reason}` | HTTP 服务器优雅关闭开始 |
| `server.stopped` | `ServerStopped{Addr, Duration, Error}` | HTTP 服务器已停止 |
| `request.received` | `RequestReceived{Method, Path, ClientIP, RequestID, ReceivedAt}` | HTTP 请求进入路由层 |
| `request.handled` | `RequestHandled{Method, Path, RequestID, Status, Duration}` | HTTP 请求成功完成 |
| `request.failed` | `RequestFailed{Method, Path, RequestID, Status, Duration, Error, Stack}` | HTTP 请求以 5xx 错误或 panic 结束 |
| `request.finished` | `RequestFinished{Method, Path, RequestID, Status, Duration, Error}` | HTTP 请求完全结束（无论结果如何都会派发） |
| `console.application.starting` | `ConsoleApplicationStarting{KernelName}` | Console 内核进入 starting 阶段 |
| `console.command.starting` | `CommandStarting{Command, Input}` | Console 命令即将执行 |
| `console.command.finished` | `CommandFinished{Command, Succeeded, Error, Duration}` | Console 命令执行完毕 |

### 监听生命周期事件

你可以在服务提供者的 `Boot` 方法中监听生命周期事件——此时事件派发器保证可用：

```go
func (p *AppServiceProvider) Boot(app providercontract.Application) error {
    bus, err := container.Make[eventcontract.Dispatcher]("event.dispatcher")
    if err != nil || bus == nil {
        return err
    }

    bus.Listen(event.EventAppBooted, listener.New(func(ctx context.Context, ev event.AppBooted) error {
        logger.Channel("app").WithField("duration_ms", ev.Duration.Milliseconds()).Info("app booted")
        return nil
    }))

    bus.Listen(event.EventRequestFinished, listener.New(func(ctx context.Context, ev event.RequestFinished) error {
        if ev.Status >= 500 {
            logger.Channel("error").WithError(fmt.Errorf(ev.Error)).
                WithField("method", ev.Method).
                WithField("path", ev.Path).
                WithField("duration_ms", ev.Duration.Milliseconds()).
                Error("request failed")
        }
        return nil
    }))

    return nil
}
```

注意，生命周期事件 payload 只包含基础类型——字符串、整数、时间间隔和错误——刻意避免携带 `gin.Context`、`http.Server` 或其他运行时对象，以免将事件层耦合到特定基础设施。

### 本页内容

- [介绍](#介绍)
- [生命周期概览](#生命周期概览)
    - [第一步](#第一步)
    - [应用启动引导](#应用启动引导)
    - [服务提供者](#服务提供者)
    - [HTTP 请求处理](#http-请求处理)
    - [Console 命令](#console-命令)
    - [关闭](#关闭)
- [生命周期事件](#生命周期事件)
