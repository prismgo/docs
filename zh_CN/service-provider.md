# 服务提供者

- [介绍](#介绍)
- [编写服务提供者](#编写服务提供者)
    - [Register 方法](#register-方法)
    - [Boot 方法](#boot-方法)
- [注册提供者](#注册提供者)
- [延迟提供者](#延迟提供者)
- [可终止提供者](#可终止提供者)

## 介绍

服务提供者是所有 Prismgo 应用启动引导的中心位置。你自己的应用，以及所有 Prismgo 的核心服务，都是通过服务提供者来启动引导的。

但是，我们所说的"启动引导"是什么意思？一般来说，我们指的是**注册**各种事物，包括注册服务容器绑定、事件监听器、中间件，甚至是路由。服务提供者是配置你的应用的中心场所。

Prismgo 内部使用了一组默认服务提供者来启动引导其核心服务，例如缓存、队列、数据库等。其中许多提供者是"延迟"提供者，意味着它们不会在每个请求中都加载，只有在它们提供的服务真正被需要时才加载。

所有用户定义的服务提供者都注册在 `bootstrap/provider.go` 文件中。在下面的文档中，你将学习如何编写自己的服务提供者并将其注册到你的 Prismgo 应用中。

如果你想了解更多关于 Prismgo 如何处理请求和内部运作的信息，请查阅我们的 Prismgo [应用生命周期](/docs/{{version}}/lifecycle)文档。

## 编写服务提供者

所有服务提供者都实现 `github.com/prismgo/framework/contracts/provider` 中的 `ServiceProvider` 接口。大多数服务提供者包含一个 `Register` 和一个 `Boot` 方法。在 `Register` 方法中，你应该**只将事物绑定到[服务容器](/docs/{{version}}/container)中**。你永远不应该在 `Register` 方法中尝试注册任何事件监听器、路由或任何其他功能。

让我们创建一个基础的服务提供者。`Register` 方法是你在容器中绑定服务的地方，`Boot` 方法是执行注册后任务的地方：

```go
package providers

import (
    providercontract "github.com/prismgo/framework/contracts/provider"
)

type AppServiceProvider struct{}

func (p AppServiceProvider) Register(app providercontract.Application) error {
    return nil
}

func (p AppServiceProvider) Boot(app providercontract.Application) error {
    return nil
}
```

### Register 方法

如前所述，在 `Register` 方法中，你应该只将事物绑定到[服务容器](/docs/{{version}}/container)中。你永远不应该在 `Register` 方法中尝试注册任何事件监听器、路由或任何其他功能。否则，你可能会意外使用到一个由尚未加载的服务提供者提供的服务。

让我们看一个基础的服务提供者。在你的任何服务提供者方法中，你都可以访问 `app` 参数，通过 `app.Container()` 来访问服务容器：

```go
type CacheServiceProvider struct{}

func (CacheServiceProvider) Register(app providercontract.Application) error {
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

这个服务提供者只定义了一个 `Register` 方法，并使用该方法在服务容器中定义了缓存管理器的实现。`Bound` 检查确保如果容器已有绑定——例如，当测试显式注入了 fake 时——提供者不会覆盖它。

#### 容器绑定方法

服务容器支持在你的提供者 `Register` 方法中使用多种绑定方式：

```go
// Bind 注册瞬态服务——每次解析都会创建新实例。
c.Bind("transient.service", func(resolver containercontract.Resolver) (any, error) {
    return NewTransientService()
})

// Singleton 注册共享服务——实例在首次解析后被缓存。
c.Singleton("shared.service", func(resolver containercontract.Resolver) (any, error) {
    return NewSharedService()
})

// Instance 直接注册一个已构造好的值。
c.Instance("existing.service", myService)

// Alias 为已有的绑定创建别名。
c.Alias("shared.service", "my.service.alias")
```

#### 绑定选项

注册绑定时，你可以附加控制生命周期行为的选项：

```go
c.Singleton("cache.manager", factory,
    // WithCloser 注册一个在应用关闭时调用的清理函数。
    container.WithCloser(func(m *Manager) error {
        return m.Close()
    }),
    // WithCloseGroup 将资源分配到特定的关闭阶段。
    // CloseGroupNormal 首先运行；CloseGroupReporting 最后运行（用于错误日志器等）。
    container.WithCloseGroup(container.CloseGroupReporting),
)
```

### Boot 方法

那么，如果我们需要在服务提供者中注册事件监听器呢？这应该在 `Boot` 方法中完成。**此方法在所有其他服务提供者都已注册之后才被调用**，这意味着你可以访问框架已注册的所有其他服务：

```go
type ListenerProvider struct{}

func (p ListenerProvider) Register(app providercontract.Application) error {
    return nil
}

func (p ListenerProvider) Boot(app providercontract.Application) error {
    // 解析事件派发器——此时它保证可用
    raw, err := app.Container().Make("event.dispatcher")
    if err != nil {
        return err
    }
    bus, ok := raw.(eventcontract.Dispatcher)
    if !ok || bus == nil {
        return fmt.Errorf("listener provider: unexpected type %T", raw)
    }

    // 解析数据库连接并构造业务服务
    rawDB, err := app.Container().Make("database.default")
    if err != nil {
        return err
    }
    db := rawDB.(*gorm.DB)

    notificationService := services.NewNotificationService(db)
    listeners.Register(bus, notificationService)
    return nil
}
```

这个提供者的 `Register` 方法是空的——它没有自己的容器绑定。它的 `Boot` 方法解析已注册的事件派发器和数据库连接，构造通知服务，并注册所有业务事件监听器。

#### 声明命令

如果你的提供者需要注册 Artisan 风格的 Console 命令，你可以在 `Boot` 方法中使用 `provider.Commands` 辅助函数。命令不会立即挂载——它们会延迟到 Console 内核的 starting 阶段，所以纯 HTTP 启动不会受到影响：

```go
func (ServiceProvider) Boot(providerApplication) error {
    return provider.Commands(
        cmd.NewInstallCommand(),
        cmd.NewWorkCommand(),
    )
}
```

`provider.Commands` 函数接受预先构造的 `console.Command` 实例或 `console.CommandFactory` 函数。命令定义验证、重复检查和别名冲突解决都由 Console 内核在启动时处理。

#### Vendor Publish

在开发环境中，提供者可以声明应该发布到应用目录中的资源——配置文件、迁移文件、语言文件等。这通过在 `Boot` 方法中使用 `provider.Publishes` 完成：

```go
func (ServiceProvider) Boot(providerApplication) error {
    if err := provider.Publishes("my-provider", map[string]string{
        "config/my-service.php": app.ConfigPath("my-service.php"),
        "migrations":            app.DatabasePath("migrations"),
    }, "config", "migrations"); err != nil {
        return err
    }
    return nil
}
```

- 第一个参数是提供者的稳定标识（即 `Name()` 返回的值）。
- 第二个参数是相对源路径到绝对目标路径的映射。剩余的参数是标签，允许在运行 `vendor:publish` 时进行过滤。
- 在生产环境中，`Publishes` 静默不做任何事情——它是开发专用功能。

## 注册提供者

所有服务提供者都注册在 `bootstrap/provider.go` 文件中。该文件返回一个包含你应用程序提供者的切片：

```go
package bootstrap

import (
    appproviders "yourapp/app/providers"
    "github.com/prismgo/framework/provider"
)

func Providers() []provider.ServiceProvider {
    return []provider.ServiceProvider{
        appproviders.AppServiceProvider{},
        appproviders.ListenerProvider{},
    }
}
```

框架默认提供者——`redis`、`cache`、`queue`、`cookie`、`session`、`filesystem`、`database`、`schema` 和 `route`——由 `foundation.Builder` 自动前置加载，因此你不需要在 `bootstrap/provider.go` 中列出它们。Horizon 等独立扩展通过 `WithExtensionProviders(...)` 注册；应用 Provider 继续由 `WithProviders(Providers()...)` 注册。

完整的提供者加载顺序是：

1. **基础提供者**（立即注册）：`event` → `config` → `logger` → `translation`
2. **默认提供者**（在 `Boot()` 期间注册）：`redis` → `cache` → `queue` → `cookie` → `session` → `filesystem` → `database` → `schema` → `route`
3. **扩展提供者**（在 `Boot()` 期间注册）：按 `WithExtensionProviders(...)` 的声明顺序，例如 `horizon.ServiceProvider{}`
4. **你的应用提供者**（在 `Boot()` 期间注册）：按 `bootstrap/provider.go` 返回的顺序

#### 提供者标识

每个提供者在仓库中通过唯一的标识字符串来识别。如果提供者实现了 `NamedProvider` 接口且 `Name()` 返回非空字符串，则使用该字符串作为标识。否则，使用完整的 Go 类型路径（去掉指针间接后）作为标识：

```go
// 显式标识——推荐需要稳定名称的提供者使用
func (HorizonServiceProvider) Name() string { return "app.horizon" }

// 隐式标识——使用 Go 类型路径
// "yourapp/app/providers.AppServiceProvider"
```

如果同一个标识被注册两次，第二次注册会被静默忽略，使用第一个提供者实例。

## 延迟提供者

如果你的提供者**仅**在[服务容器](/docs/zh_CN/container.md)中注册绑定，你可以选择将其注册推迟到其中一个已注册的绑定真正被需要时再执行。延迟加载这样的提供者将提高你应用的性能，因为它不会在每个请求中都从文件系统加载。

Prismgo 存储了所有延迟服务提供者提供的服务及其提供者标识的映射。然后，只有当你尝试解析这些服务之一时，Prismgo 才会加载该服务提供者。

要延迟加载提供者，实现 `DeferrableProvider` 接口并定义 `Provides` 方法。`Provides` 方法应返回该提供者注册的服务容器绑定：

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

当延迟提供者被加载时，其 `Register` 和 `Boot` 方法按顺序执行，然后延迟映射从仓库中移除。如果延迟提供者首次被解析时应用已经启动完毕，`Boot` 阶段会在 `Register` 之后立即执行。

关于延迟提供者需要注意的几点：

- `Provides` 方法必须返回至少一个服务键。空切片将导致注册错误。
- 同一个服务键不能由多个延迟提供者提供。
- 延迟提供者不参与 `Terminate` 阶段，除非它们已经被加载（即它们的服务在某个时刻被解析过）。

## 可终止提供者

如果你的提供者管理着外部资源——例如数据库连接池、后台 worker 或文件监听器——你可能希望在应用关闭时执行清理工作。这可以通过实现 `TerminableProvider` 接口并定义 `Terminate` 方法来完成。

`Terminate` 方法接收关闭 context，该 context 由 `SIGINT`/`SIGTERM` 信号或当 `RunContext` 的运行函数返回时取消：

```go
type TerminableProvider interface {
    Terminate(ctx context.Context) error
}
```

让我们看一个例子。假设你的提供者管理着一个长时间运行的 worker 池，需要在关闭时优雅地排空：

```go
type WorkerServiceProvider struct{}

func (WorkerServiceProvider) Register(app providercontract.Application) error {
    c := app.Container()
    if c.Bound("worker.pool") {
        return nil
    }
    return c.Singleton("worker.pool", func(resolver containercontract.Resolver) (any, error) {
        return NewWorkerPool(), nil
    })
}

func (WorkerServiceProvider) Boot(app providercontract.Application) error {
    raw, err := app.Container().Make("worker.pool")
    if err != nil {
        return err
    }
    pool := raw.(*WorkerPool)
    pool.Start()
    return nil
}

func (WorkerServiceProvider) Terminate(ctx context.Context) error {
    raw, err := container.MakeFrom[*WorkerPool](ctx, "worker.pool")
    if err != nil {
        return err
    }
    return pool.Drain(ctx)
}
```

在关闭期间，`Application.Close()` 按**仓库反序**调用所有符合条件的提供者的 `Terminate` 方法——这样依赖其他提供者注册的服务的提供者先释放它们的资源。

关于可终止提供者需要注意的几点：

- 只有 `Register` 方法成功完成的提供者才会参与 `Terminate` 阶段。如果提供者在 `Register` 期间失败，会被跳过。
- 从未被加载过的延迟提供者（它们的服务从未被解析过）不会参与 `Terminate`。
- `Terminate` 方法接收应用的关闭 context，因此你可以在清理期间遵循超时限制。
- 如果你也在 `Register` 中通过 `container.WithCloser` 注册了关闭回调，这些回调在 `Terminate` 阶段之后运行——在容器管理的单独步骤中执行。

你可以将三个可选接口组合在同一个提供者上：

```go
type FullLifecycleProvider struct{}

func (FullLifecycleProvider) Register(app providercontract.Application) error { /* ... */ return nil }
func (FullLifecycleProvider) Boot(app providercontract.Application) error     { /* ... */ return nil }
func (FullLifecycleProvider) Provides() []string                              { return []string{"my.service"} }
func (FullLifecycleProvider) Terminate(ctx context.Context) error             { /* ... */ return nil }
```

### 本页内容

- [介绍](#介绍)
- [编写服务提供者](#编写服务提供者)
    - [Register 方法](#register-方法)
    - [Boot 方法](#boot-方法)
- [注册提供者](#注册提供者)
- [延迟提供者](#延迟提供者)
- [可终止提供者](#可终止提供者)
