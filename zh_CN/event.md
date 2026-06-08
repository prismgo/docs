# Events

- [简介](#简介)
- [注册事件与监听器](#注册事件与监听器)
  - [手动注册监听器](#手动注册监听器)
  - [闭包监听器](#闭包监听器)
  - [通配符监听器](#通配符监听器)
- [定义事件](#定义事件)
- [定义监听器](#定义监听器)
- [Queued Event Listeners](#queued-event-listeners)
  - [自定义队列连接、队列名与延迟](#自定义队列连接队列名与延迟)
  - [注册事件工厂](#注册事件工厂)
- [派发事件](#派发事件)
- [Event Subscribers](#event-subscribers)
  - [编写 Event Subscribers](#编写-event-subscribers)
  - [注册 Event Subscribers](#注册-event-subscribers)
- [全局门面](#全局门面)
- [异步监听器](#异步监听器)
- [生命周期事件](#生命周期事件)
  - [应用生命周期](#应用生命周期)
  - [Provider 生命周期](#provider-生命周期)
  - [HTTP 服务生命周期](#http-服务生命周期)
  - [HTTP 请求生命周期](#http-请求生命周期)
  - [Console 生命周期](#console-生命周期)
  - [Vendor Publish 事件](#vendor-publish-事件)
- [错误与 Panic 处理](#错误与-panic-处理)
- [测试](#测试)
- [最佳实践](#最佳实践)
- [接口参考](#接口参考)
  - [Event](#event)
  - [Listener](#listener)
  - [ListenerFunc](#listenerfunc)
  - [Dispatcher](#dispatcher)
  - [Subscriber](#subscriber)
  - [ShouldQueue](#shouldqueue)
  - [AsyncListener](#asynclistener)
  - [QueueOptionsProvider](#queueoptionsprovider)
- [ServiceProvider](#serviceprovider)
- [与 Laravel 13 的差异](#与-laravel-13-的差异)

---

## 简介

PrismGo 的事件系统提供了观察者模式的实现，允许你订阅和监听应用中发生的各种事件。事件类通常放在 `app/events` 目录，监听器放在 `app/listeners` 目录。

事件是解耦应用各个方面的绝佳方式，因为一个事件可以有多个互不依赖的监听器。例如，你可能希望在每次工单创建时发送通知。与其将工单处理代码与通知代码耦合在一起，不如派发一个 `workorder.created` 事件，让监听器接收并处理通知发送。

`prismgo/event` 包提供 Laravel 风格的事件总线，核心特性包括：

- 同步派发为主，单个监听器可声明为 goroutine 异步或队列异步执行
- 监听器之间互相隔离：任一监听器 panic 或返回 error 都不会影响其余监听器
- 支持精确事件名匹配，以及 `"*"`（全匹配）与 `"<prefix>.*"`（前缀匹配）两种通配符
- 零业务耦合，可跨项目复用

## 注册事件与监听器

### 手动注册监听器

PrismGo 不支持自动事件发现，所有监听器需要显式注册。当前项目在 `app/listeners/register.go` 中集中注册业务监听器：

```go
package listeners

import (
    "context"

    eventcontract "github.com/prismgo/framework/contracts/event"
    "github.com/prismgo/framework/event"
    "github.com/prismgo/framework/logger"
    "prismgo/app/services"
)

func Register(bus eventcontract.Dispatcher, notificationSvc *services.NotificationService) {
    if bus == nil {
        return
    }
    registerLifecycleProbes(bus)
    if notificationSvc != nil {
        bus.Subscribe(&notificationSubscriber{svc: notificationSvc})
    }
}
```

使用 `Listen` 方法注册结构体监听器：

```go
bus.Listen("workorder.created", &WorkorderCreatedListener{
    notifications: notificationSvc,
})
```

### 闭包监听器

使用 `ListenFunc` 注册函数式监听器，适合轻量逻辑：

```go
bus.ListenFunc("workorder.created", func(ctx context.Context, ev event.Event) error {
    e := ev.(WorkorderCreated)
    return notificationSvc.SendWorkorderCreated(ctx, e.TenantID, e.WorkorderID, e.OperatorID)
})
```

### 通配符监听器

支持两类通配符：

- `"*"`：匹配所有事件
- `"<prefix>.*"`：匹配指定前缀的所有事件，例如 `workorder.*` 匹配 `workorder.created`、`workorder.assigned` 等

```go
// 监听所有 workorder 前缀的事件
bus.ListenFunc("workorder.*", func(ctx context.Context, ev event.Event) error {
    logger.WithFields(map[string]any{
        "event": ev.Name(),
    }).Info("workorder event fired")
    return nil
})

// 监听所有事件
bus.ListenFunc("*", func(ctx context.Context, ev event.Event) error {
    logger.WithFields(map[string]any{
        "event": ev.Name(),
    }).Debug("event fired")
    return nil
})
```

通配符适合日志、监控、调试和指标采集。核心业务逻辑优先监听明确事件名。

> **注意**：`Forget` 和 `Has` 只处理精确事件名，不影响也不统计通配符监听器。

## 定义事件

事件是普通 Go 结构体，只需实现 `Event` 接口的 `Name() string` 方法：

```go
package events

const EventWorkorderCreated = "workorder.created"

type WorkorderCreated struct {
    TenantID    uint `json:"tenant_id"`
    WorkorderID uint `json:"workorder_id"`
    OperatorID  uint `json:"operator_id"`
}

func (WorkorderCreated) Name() string {
    return EventWorkorderCreated
}
```

事件名建议使用 `<domain>.<action>` 格式，全小写、点号分隔：

```text
workorder.created
workorder.assigned
followup.submitted
notification.failed
```

事件 payload 只放必要字段或可安全序列化的快照。不要携带 `gin.Context`、数据库连接、事务对象、service、repository 等运行时资源。

## 定义监听器

### 结构体监听器

结构体监听器适合依赖较多、逻辑较复杂或需要单独测试的场景：

```go
type WorkorderCreatedListener struct {
    notifications *NotificationService
}

func (l *WorkorderCreatedListener) Handle(ctx context.Context, ev event.Event) error {
    e := ev.(events.WorkorderCreated)
    return l.notifications.SendWorkorderCreated(ctx, e.TenantID, e.WorkorderID, e.OperatorID)
}
```

注册：

```go
bus.Listen(events.EventWorkorderCreated, &WorkorderCreatedListener{
    notifications: notificationSvc,
})
```

### 函数式监听器

轻量逻辑可直接使用 `ListenerFunc`：

```go
bus.ListenFunc(events.EventWorkorderCreated, func(ctx context.Context, ev event.Event) error {
    e := ev.(events.WorkorderCreated)
    return notificationSvc.SendWorkorderCreated(ctx, e.TenantID, e.WorkorderID, e.OperatorID)
})
```

### 停止事件传播

PrismGo 不支持通过返回 `false` 停止事件传播。所有匹配的监听器都会被执行。如果某个动作必须在主流程成功后才执行，应在 service 中直接调用而非使用事件。

## Queued Event Listeners

如果监听器需要执行耗时操作（如发送邮件、调用外部 API），可以使用队列监听器，让监听器在队列 worker 中异步执行。使用前请确保已配置 `prismgo/queue` 并启动了 worker。

### 实现 ShouldQueue 接口

让监听器实现 `ShouldQueue` 接口即可将其投递到队列：

```go
type SendWelcomeMailListener struct{}

func (SendWelcomeMailListener) Handle(ctx context.Context, ev event.Event) error {
    e := ev.(*UserRegistered)
    return sendWelcomeMail(ctx, e.UserID)
}

func (SendWelcomeMailListener) ShouldQueue() bool {
    return true
}

bus.Listen("user.registered", SendWelcomeMailListener{})
```

### 使用 Queued 包装器

也可以用 `event.Queued` 包装已有监听器：

```go
bus.Listen("user.registered", event.Queued(event.ListenerFunc(func(ctx context.Context, ev event.Event) error {
    e := ev.(*UserRegistered)
    return sendWelcomeMail(ctx, e.UserID)
})))
```

事件派发时，队列监听器会被序列化为内部 Job，交给当前 Application 容器中的 `queue.dispatcher` 投递。`sync` 队列连接会在当前调用栈执行；`redis` 队列连接会写入 Redis 等待 worker 消费。

### 自定义队列连接、队列名与延迟

队列监听器可以实现 `QueueOptionsProvider` 接口来自定义队列参数：

```go
type SendWelcomeMailListener struct{}

func (SendWelcomeMailListener) Handle(ctx context.Context, ev event.Event) error {
    e := ev.(*UserRegistered)
    return sendWelcomeMail(ctx, e.UserID)
}

func (SendWelcomeMailListener) ShouldQueue() bool { return true }

func (SendWelcomeMailListener) QueueConnection() string { return "redis" }
func (SendWelcomeMailListener) QueueName() string       { return "mail" }
func (SendWelcomeMailListener) QueueDelay() time.Duration {
    return 10 * time.Second
}
func (SendWelcomeMailListener) QueueTries() int { return 3 }
func (SendWelcomeMailListener) QueueBackoff() []time.Duration {
    return []time.Duration{5 * time.Second, 30 * time.Second}
}
func (SendWelcomeMailListener) QueueTimeout() time.Duration { return 20 * time.Second }
```

`QueueOptionsProvider` 各方法说明：

| 方法 | 返回类型 | 说明 |
| --- | --- | --- |
| `QueueConnection()` | `string` | 队列连接名，如 `"redis"`、`"sync"` |
| `QueueName()` | `string` | 队列名，如 `"mail"`、`"default"` |
| `QueueDelay()` | `time.Duration` | 延迟投递时间 |
| `QueueTries()` | `int` | 最大重试次数 |
| `QueueBackoff()` | `[]time.Duration` | 每次重试之间的退避时间 |
| `QueueTimeout()` | `time.Duration` | 单次执行超时时间 |

### 注册事件工厂

队列监听器会把事件 JSON 序列化后保存到队列 payload。Worker 消费时需要将 JSON 反序列化回具体事件结构体，因此必须在启动阶段注册事件工厂：

```go
type UserRegistered struct {
    UserID uint `json:"user_id"`
}

func (UserRegistered) Name() string { return "user.registered" }

func init() {
    event.RegisterEvent[*UserRegistered]()
}
```

> **重要**：`RegisterEvent[T]()` 的泛型参数 `T` 必须是指向具体事件结构体的指针类型（如 `*UserRegistered`），不能是接口或双重指针。注册属于启动期配置，类型错误或空事件名会直接 panic，便于尽早暴露编程错误。

如果没有注册事件工厂，Worker 无法把 payload 恢复为具体事件结构体，此时会回退为 `rawQueuedEvent`（只保留事件名和原始 JSON），监听器无法通过类型断言访问业务字段。

## 派发事件

在业务服务中调用 `Dispatch` 派发事件：

```go
func (s *WorkorderService) Create(ctx context.Context, req CreateWorkorderRequest) error {
    id, err := s.repo.Create(ctx, req)
    if err != nil {
        return err
    }

    s.bus.Dispatch(ctx, events.WorkorderCreated{
        TenantID:    req.TenantID,
        WorkorderID: id,
        OperatorID:  req.OperatorID,
    })
    return nil
}
```

`Dispatch` 不返回监听器错误。监听器返回 error 或 panic 会被记录，不会打断后续监听器，也不会改变主流程返回值。

`ctx` 为 `nil` 时会回退到 `context.Background()`；`ev` 为 `nil` 时直接忽略。

## Event Subscribers

Event Subscribers 允许在一个对象中集中订阅多个相关事件，避免把多个 `Listen` 调用散落在不同位置。

### 编写 Event Subscribers

实现 `Subscriber` 接口的 `Subscribe(dispatcher Dispatcher)` 方法：

```go
type WorkorderSubscriber struct {
    notifications *NotificationService
}

func (s *WorkorderSubscriber) Subscribe(bus eventcontract.Dispatcher) {
    bus.ListenFunc(events.EventWorkorderCreated, s.onCreated)
    bus.ListenFunc(events.EventWorkorderAssigned, s.onAssigned)
}

func (s *WorkorderSubscriber) onCreated(ctx context.Context, ev event.Event) error {
    e := ev.(events.WorkorderCreated)
    return s.notifications.SendWorkorderCreated(ctx, e.TenantID, e.WorkorderID, e.OperatorID)
}

func (s *WorkorderSubscriber) onAssigned(ctx context.Context, ev event.Event) error {
    e := ev.(events.WorkorderAssigned)
    return s.notifications.SendWorkorderAssigned(ctx, e.TenantID, e.WorkorderID, e.AssigneeID)
}
```

### 注册 Event Subscribers

```go
bus.Subscribe(&WorkorderSubscriber{notifications: notificationSvc})
```

当前项目业务监听器集中在 `app/listeners/`，由 provider 在启动阶段统一注册。

## 全局门面

业务代码优先通过依赖注入使用 `eventcontract.Dispatcher`。没有 DI 链路的命令、定时任务或基础设施代码可以使用包级门面：

```go
event.ListenFunc("workorder.created", onWorkorderCreated)
event.Dispatch(ctx, events.WorkorderCreated{WorkorderID: 1001})
```

| 方法 | 说明 |
| --- | --- |
| `event.Resolve()` | 从当前 Application 容器解析事件总线 |
| `event.Dispatch(ctx, ev)` | 使用全局总线派发事件 |
| `event.Listen(name, listener)` | 使用全局总线注册监听器 |
| `event.ListenFunc(name, fn)` | 使用全局总线注册函数监听器 |
| `event.Subscribe(subscriber)` | 使用全局总线注册订阅者 |
| `event.Forget(name)` | 删除全局总线上的精确监听器 |
| `event.Has(name)` | 判断全局总线是否存在精确监听器 |

## 异步监听器

使用 `event.Async` 包装监听器，使其在独立 goroutine 中执行：

```go
bus.Listen("user.registered", event.Async(func(ctx context.Context, ev event.Event) error {
    e := ev.(UserRegistered)
    return mailer.SendWelcomeMail(ctx, e.UserID)
}))
```

`event.Async` 适合不要求持久化、不要求 worker 重试的轻量副作用。异步监听器仍由当前进程执行，进程退出时未完成的 goroutine 不会自动恢复。

如果需要可靠异步、失败重试、延迟执行或跨进程 worker 消费，请使用 Queued Event Listeners。

## 生命周期事件

`prismgo/event` 定义了一组通用生命周期事件，供基础设施和业务侧订阅。事件名统一使用 `<domain>.<stage>` 格式。

### 应用生命周期

| 事件名常量 | 事件名 | 类型 | 用途 |
| --- | --- | --- | --- |
| `EventAppBooting` | `app.booting` | `AppBooting` | 应用即将开始执行 provider 注册与启动流程 |
| `EventAppBooted` | `app.booted` | `AppBooted` | 应用已完成 provider 注册与启动流程 |
| `EventAppTerminating` | `app.terminating` | `AppTerminating` | 应用收到关闭意图，即将执行 cleanup 与 facade 资源释放 |
| `EventAppTerminated` | `app.terminated` | `AppTerminated` | 应用已完成 cleanup 与 facade 资源释放 |

`AppBooting` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Args` | `[]string` | 应用启动参数 |

`AppBooted` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Duration` | `time.Duration` | 启动耗时 |

`AppTerminating` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Reason` | `string` | 关闭原因 |

`AppTerminated` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Duration` | `time.Duration` | 关闭耗时 |
| `Error` | `string` | 关闭过程中的错误摘要 |

### Provider 生命周期

| 事件名常量 | 事件名 | 类型 | 用途 |
| --- | --- | --- | --- |
| `EventProviderRegistering` | `app.provider.registering` | `ProviderRegistering` | ServiceProvider 即将执行 Register 阶段 |
| `EventProviderRegistered` | `app.provider.registered` | `ProviderRegistered` | ServiceProvider 已完成 Register 阶段 |
| `EventProviderBooting` | `app.provider.booting` | `ProviderBooting` | ServiceProvider 即将执行 Boot 阶段 |
| `EventProviderBooted` | `app.provider.booted` | `ProviderBooted` | ServiceProvider 已完成 Boot 阶段 |

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Provider` | `string` | Provider 名称 |

### HTTP 服务生命周期

| 事件名常量 | 事件名 | 类型 | 用途 |
| --- | --- | --- | --- |
| `EventServerStarting` | `server.starting` | `ServerStarting` | HTTP 服务即将开始监听端口 |
| `EventServerStarted` | `server.started` | `ServerStarted` | HTTP 服务已开始监听，可以对外提供服务 |
| `EventServerStopping` | `server.stopping` | `ServerStopping` | HTTP 服务开始优雅关闭 |
| `EventServerStopped` | `server.stopped` | `ServerStopped` | HTTP 服务已结束监听并完成关闭流程 |

`ServerStarting` / `ServerStarted` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Addr` | `string` | 监听地址 |
| `PID` | `int` | 进程 ID |

`ServerStopping` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Addr` | `string` | 监听地址 |
| `Reason` | `string` | 关闭原因 |

`ServerStopped` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Addr` | `string` | 监听地址 |
| `Duration` | `time.Duration` | 关闭耗时 |
| `Error` | `string` | 关闭错误摘要 |

### HTTP 请求生命周期

| 事件名常量 | 事件名 | 类型 | 用途 |
| --- | --- | --- | --- |
| `EventRequestReceived` | `request.received` | `RequestReceived` | HTTP 请求进入路由层 |
| `EventRequestHandled` | `request.handled` | `RequestHandled` | HTTP 请求正常处理完成（状态码 < 500） |
| `EventRequestFailed` | `request.failed` | `RequestFailed` | HTTP 请求失败（状态码 >= 500 或 panic） |
| `EventRequestFinished` | `request.finished` | `RequestFinished` | HTTP 请求完成收尾（成功和失败都会触发） |

`RequestReceived` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Method` | `string` | 请求方法 |
| `Path` | `string` | 请求路径 |
| `ClientIP` | `string` | 客户端 IP |
| `RequestID` | `string` | 请求 ID |
| `ReceivedAt` | `time.Time` | 请求到达时间 |

`RequestHandled` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Method` | `string` | 请求方法 |
| `Path` | `string` | 请求路径 |
| `RequestID` | `string` | 请求 ID |
| `Status` | `int` | 响应状态码 |
| `Duration` | `time.Duration` | 处理耗时 |

`RequestFailed` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Method` | `string` | 请求方法 |
| `Path` | `string` | 请求路径 |
| `RequestID` | `string` | 请求 ID |
| `Status` | `int` | 响应状态码 |
| `Duration` | `time.Duration` | 处理耗时 |
| `Error` | `string` | 错误摘要 |
| `Stack` | `string` | 堆栈信息 |

`RequestFinished` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Method` | `string` | 请求方法 |
| `Path` | `string` | 请求路径 |
| `RequestID` | `string` | 请求 ID |
| `Status` | `int` | 响应状态码 |
| `Duration` | `time.Duration` | 处理耗时 |
| `Error` | `string` | 错误摘要（成功时为空） |

> `request.finished` 总是在 `request.handled` 或 `request.failed` 之后派发，适合统一做耗时统计、状态码统计和链路收尾。

### Console 生命周期

| 事件名常量 | 事件名 | 类型 | 用途 |
| --- | --- | --- | --- |
| `EventConsoleApplicationStarting` | `console.application.starting` | `ConsoleApplicationStarting` | Console Kernel 首次进入 Artisan starting 阶段 |
| `EventCommandStarting` | `console.command.starting` | `CommandStarting` | 具体 console command 即将执行 |
| `EventCommandFinished` | `console.command.finished` | `CommandFinished` | 具体 console command 已结束 |

`ConsoleApplicationStarting` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `KernelName` | `string` | Kernel 名称 |

`CommandStarting` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Command` | `string` | 命令名 |
| `Input` | `[]string` | 原始命令参数和选项 |

`CommandFinished` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Command` | `string` | 命令名 |
| `Succeeded` | `bool` | 是否执行成功 |
| `Error` | `string` | 错误摘要 |
| `Duration` | `time.Duration` | 执行耗时 |

### Vendor Publish 事件

| 事件名常量 | 事件名 | 类型 | 用途 |
| --- | --- | --- | --- |
| — | `vendor.tag.published` | `VendorTagPublished` | `vendor:publish` 命令完成资源发布后触发 |

`VendorTagPublished` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Tag` | `[]string` | 本次发布的 tag 列表 |
| `Published` | `int` | 本次发布新创建的文件数 |
| `Skipped` | `int` | 本次因已存在或过滤跳过的文件数 |

## 错误与 Panic 处理

| 场景 | 处理方式 |
| --- | --- |
| 同步监听器返回 error | 记录错误，继续执行后续监听器 |
| 同步监听器 panic | recover，记录 stack，继续执行后续监听器 |
| `event.Async` 返回 error | 在 goroutine 中记录错误 |
| `event.Async` panic | 在 goroutine 中 recover 并记录 stack |
| 队列监听器返回 error | 交给当前队列实现处理重试、释放或失败归档 |

事件监听器失败不会自动让主业务回滚。如果副作用必须和主流程强一致，应直接放在 service 主链路中显式执行。

## 测试

监听器测试优先创建独立总线，不依赖全局状态：

```go
func TestWorkorderCreatedListener(t *testing.T) {
    bus := event.New()
    var called bool

    bus.ListenFunc("workorder.created", func(ctx context.Context, ev event.Event) error {
        e := ev.(WorkorderCreated)
        called = e.WorkorderID == 1001
        return nil
    })

    bus.Dispatch(context.Background(), WorkorderCreated{WorkorderID: 1001})

    if !called {
        t.Fatal("listener was not called")
    }
}
```

队列监听器测试可使用 `sync` 队列连接，让监听器在 `Dispatch` 内立即执行；需要覆盖真实 worker 路径时，再使用 Redis 或 miniredis 并启动 worker 消费一次。

## 最佳实践

- 业务事件定义放在领域相关包中，事件名用常量保存
- 监听器集中注册，例如当前项目的 `app/listeners/register.go`
- 派发事件时只传必要业务 ID 或轻量快照
- 监听器内部要显式处理类型断言，必要时先检查 `ok` 并返回错误
- 需要可靠异步、重试和失败归档时使用队列监听器
- 只是不想阻塞当前请求时才使用 `event.Async`
- 通配符监听主要用于日志、监控和调试
- 不要把必须成功的主流程动作放进监听器
- 测试中使用 `event.New()` 创建独立总线，避免污染全局默认总线

## 接口参考

所有接口定义在 `prismgo/contracts/event` 包中。

### Event

```go
type Event interface {
    Name() string
}
```

任何事件都必须实现的基础接口。`Name()` 返回事件的稳定名称，如 `"workorder.created"`，用于监听器匹配、日志标识和监控聚合。

### Listener

```go
type Listener interface {
    Handle(ctx context.Context, ev Event) error
}
```

事件监听器的基本契约。`Handle` 处理事件，返回非 nil error 时框架记录日志但不中断其他监听器。

### ListenerFunc

```go
type ListenerFunc func(ctx context.Context, ev Event) error
```

将普通函数适配为 `Listener` 接口，允许业务代码以闭包形式注册监听器。

### Dispatcher

```go
type Dispatcher interface {
    Listen(eventName string, l Listener)
    ListenFunc(eventName string, fn func(context.Context, Event) error)
    Subscribe(s Subscriber)
    Forget(eventName string)
    Has(eventName string) bool
    Dispatch(ctx context.Context, ev Event)
}
```

事件总线的完整契约。各方法说明：

| 方法 | 说明 |
| --- | --- |
| `Listen(eventName, l)` | 为指定事件名注册监听器，`eventName` 支持精确名称、`"*"` 和 `"<prefix>.*"` |
| `ListenFunc(eventName, fn)` | 为指定事件名注册函数式监听器 |
| `Subscribe(s)` | 让订阅者一次性注册多个监听器 |
| `Forget(eventName)` | 移除指定事件名的所有精确匹配监听器，不影响通配符监听器 |
| `Has(eventName)` | 判断指定事件名是否存在精确匹配的监听器，不检查通配符 |
| `Dispatch(ctx, ev)` | 向所有匹配的监听器分发事件 |

### Subscriber

```go
type Subscriber interface {
    Subscribe(dispatcher Dispatcher)
}
```

批量注册监听器的契约。让一个对象可以一次性把多个监听器挂载到事件总线。

### ShouldQueue

```go
type ShouldQueue interface {
    Listener
    ShouldQueue() bool
}
```

标记监听器应通过队列异步执行。实现该接口的监听器在事件分发时不会被同步执行，而是序列化后投递到队列由 worker 消费。

### AsyncListener

```go
type AsyncListener interface {
    Listener
    Async() bool
}
```

可选标记接口。实现并返回 `true` 时，Dispatcher 会在独立 goroutine 中执行该监听器。适用于通知、推送等不希望阻塞业务主流程的副作用。

便捷函数 `event.Async(fn)` 可将任意 `ListenerFunc` 包装为异步监听器。

### QueueOptionsProvider

```go
type QueueOptionsProvider interface {
    QueueConnection() string
    QueueName() string
    QueueDelay() time.Duration
    QueueTries() int
    QueueBackoff() []time.Duration
    QueueTimeout() time.Duration
}
```

允许队列监听器声明连接、队列、延迟和重试策略。各方法返回值含义见[自定义队列连接、队列名与延迟](#自定义队列连接队列名与延迟)。

## ServiceProvider

`event.ServiceProvider` 负责将事件总线注册到 Application Container：

- **Register 阶段**：注册 `event.dispatcher` 的 lazy factory（Singleton），如果已绑定则跳过
- **Boot 阶段**：注册 queued listener 内部 Job 到默认 queue registry，供 worker 恢复 payload

```go
// ServiceProvider 注册事件总线 lazy factory
type ServiceProvider struct{}

func (ServiceProvider) Name() string { return "event" }

func (ServiceProvider) Register(app providerApplication) error {
    c := app.Container()
    if c.Bound("event.dispatcher") {
        return nil
    }
    return c.Singleton("event.dispatcher", func(containercontract.Resolver) (any, error) {
        return New(), nil
    })
}
```

## 与 Laravel 13 的差异

PrismGo 对齐 Laravel 13 Events 的核心模型，但存在以下差异：

| Laravel 13 特性 | PrismGo 状态 | 说明 |
| --- | --- | --- |
| 自动事件发现（Event Discovery） | 不支持 | 监听器需要显式注册 |
| Listener constructor 自动注入 | 不支持 | 依赖由业务代码或 provider 构造监听器时注入 |
| 返回 `false` 停止传播 | 不支持 | PrismGo 会继续执行所有匹配的监听器 |
| `Event::fake` / `assertDispatched` | 不支持 | 测试使用独立 dispatcher 或自定义监听器断言 |
| 数据库事务后的事件派发 | 不支持 | 需结合 `prismgo/queue` 能力另行封装 |
| Queued Listener Middleware | 不支持 | — |
| Encrypted Queued Listeners | 不支持 | — |
| Unique Event Listeners | 不支持 | — |
| `ShouldQueue` + 队列参数 | 支持 | 通过 `QueueOptionsProvider` 接口声明 |
| 通配符监听 | 支持 | `"*"` 和 `"<prefix>.*"` |
| Event Subscribers | 支持 | `Subscriber` 接口 |
| 闭包监听器 | 支持 | `ListenFunc` |
| 生命周期事件 | 支持 | 应用、Provider、HTTP 服务、HTTP 请求、Console |
