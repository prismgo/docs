# 服务容器

- [简介](#简介)
	- [什么是服务容器](#什么是服务容器)
	- [零配置解析](#零配置解析)
	- [何时使用容器](#何时使用容器)
- [绑定](#绑定)
	- [基础绑定](#基础绑定)
	- [单例绑定](#单例绑定)
	- [实例绑定](#实例绑定)
	- [别名](#别名)
	- [绑定选项](#绑定选项)
- [解析服务](#解析服务)
	- [Make 方法](#make-方法)
	- [Factory 方法](#factory-方法)
	- [泛型类型安全助手](#泛型类型安全助手)
	- [Value 助手](#value-助手)
- [方法调用与注入](#方法调用与注入)
- [容器状态](#容器状态)
	- [检查服务是否存在](#检查服务是否存在)
	- [检查解析状态](#检查解析状态)
	- [列出所有条目](#列出所有条目)
	- [重置服务](#重置服务)
- [资源生命周期](#资源生命周期)
	- [关闭分组](#关闭分组)
	- [自定义关闭行为](#自定义关闭行为)
	- [优雅关闭语义](#优雅关闭语义)
- [缺失工厂加载器](#缺失工厂加载器)
- [包级 Facade](#包级-facade)
- [错误常量](#错误常量)
- [Laravel 容器映射](#laravel-容器映射)

---

PrismGo 的服务容器是一个中心化的注册中心，用于管理服务依赖及其生命周期。它实现了 `contracts/container` 接口，提供基于字符串键的服务绑定、解析和优雅资源关闭能力。

---

## 简介

### 什么是服务容器

PrismGo 服务容器是一个强大的工具，用于管理服务依赖和执行依赖注入。依赖注入意味着服务的依赖项被"注入"到其中，而不是在内部自行构建。

与 Laravel 使用类/接口名和 PHP 反射进行自动解析不同，PrismGo 的容器使用 **显式的字符串键** 和 **工厂函数** 进行绑定和解析。这种设计符合 Go 语言习惯，使解析路径保持显式且类型安全。

以下是服务容器在 PrismGo 应用中的工作示例：

```go
import (
	"github.com/prismgo/framework/container"
	"github.com/prismgo/framework/contracts/container"
)

// 定义一个服务。
type PodcastService struct {
	client HttpClient
}

// 在服务提供者中注册服务。
app.Container().Singleton("podcast.service", func(resolver containercontract.Resolver) (any, error) {
	return &PodcastService{
		client: NewHttpClient(),
	}, nil
})

// 在应用的某个位置解析服务。
svc, err := container.Make[*PodcastService]("podcast.service")
```

### 零配置解析

如果一个服务没有依赖项，或者只依赖其他已绑定的具体类型，你可以在工厂闭包中按需解析子依赖，而无需手动编排：

```go
app.Container().Singleton("podcast.parser", func(resolver containercontract.Resolver) (any, error) {
	// 从容器的 Resolver 中解析子依赖
	httpClient, _ := resolver.Make("http.client")
	return NewPodcastParser(httpClient), nil
})
```

由于容器处理了依赖编排，你可以专注于业务逻辑而非对象构造。

### 何时使用容器

你无需在每个代码路径中都手动与容器交互。许多组件通过包级 facade 助手（如 `container.Make[T]`、`cache.Get[T]`、`queue.Dispatch`）获取依赖，这些助手底层使用了当前应用容器。

在以下场景中，你应该手动将服务绑定到容器：

- 你正在编写一个实现接口的服务，并希望在整个应用中通过键来解析它。
- 你正在编写 PrismGo 包或模块，需要注册服务以便其他模块消费。
- 你需要管理外部资源（数据库连接、HTTP 客户端、文件句柄）的生命周期，这些资源必须在应用关闭时优雅释放。

---

## 绑定

### 基础绑定

几乎所有的容器绑定都在[服务提供者](/docs/providers)中注册。在服务提供者中，你可以通过 `app.Container()` 访问容器。

#### 简单绑定

`Bind` 方法注册 **瞬时（transient）** 服务。每次解析服务时，工厂函数都会执行并返回一个新实例。容器不会保留该实例，也不会在应用关闭时关闭它：

```go
app.Container().Bind("uuid.generator", func(resolver containercontract.Resolver) (any, error) {
	return uuid.NewString, nil
})
```

工厂函数接收容器的 `Resolver`，你可以用它来解析子依赖：

```go
app.Container().Bind("podcast.parser", func(resolver containercontract.Resolver) (any, error) {
	httpClient, err := resolver.Make("http.client")
	if err != nil {
		return nil, err
	}
	return NewPodcastParser(httpClient.(*HttpClient)), nil
})
```

### 单例绑定

`Singleton` 方法绑定一个**只解析一次**的服务。工厂函数在首次 `Make` 调用时执行，之后所有调用都返回同一个实例：

```go
app.Container().Singleton("cache.manager", func(resolver containercontract.Resolver) (any, error) {
	return cache.NewManager(cache.Config{
		Default: "memory",
	}), nil
})
```

如果单例工厂返回错误，该错误**不会**被缓存——调用方可以在修复依赖后重试。一旦工厂成功，实例将在容器的生命周期内共享。

单例适用于管理共享状态的服务：连接池、配置仓库、事件分发器、日志记录器等。

### 实例绑定

`Instance` 方法将一个**已构造完成**的对象绑定到容器中。该服务立即被标记为已解析，并在所有后续 `Make` 调用中返回：

```go
configRepo := config.NewRepository(map[string]any{
	"app.name": "PrismGo",
})

app.Container().Instance("config.repository", configRepo)
```

`Instance` 适用于注入应用启动阶段创建的对象，或单元测试中的测试替身（test double）。传入 `nil` 会保留条目但标记为未注册；要完全清除服务，请使用 `Forget`。

### 别名

`Alias` 方法为现有服务键注册一个替代名称。所有容器操作（`Make`、`Has`、`Bound`、`Resolved`、`Value`）都会将别名解析为规范键：

```go
app.Container().Alias("cache.manager", "cache")
app.Container().Alias("cache.manager", "cm")

// 以下都解析到同一个服务：
manager1, _ := app.Container().Make("cache.manager")
manager2, _ := app.Container().Make("cache")
manager3, _ := app.Container().Make("cm")
```

别名不会复制绑定，也不会影响关闭顺序；关闭始终遵循原始注册顺序。

### 绑定选项

注册单例或实例时，你可以提供绑定选项来管理资源生命周期。

#### WithCloser

`WithCloser` 注册一个类型安全的关闭函数，容器在 `Close` 时会调用它：

```go
import "github.com/prismgo/framework/container"

app.Container().Singleton("cache.manager", func(resolver containercontract.Resolver) (any, error) {
	return cache.NewManager(cache.Config{Default: "memory"})
}, container.WithCloser(func(m *cache.Manager) error {
	return m.Close()
}))
```

#### WithContextCloser

`WithContextCloser` 注册一个接收应用关闭上下文的关闭函数，使关闭过程可以遵守超时或取消信号：

```go
app.Container().Singleton("queue.connection", newQueueConnection,
	container.WithContextCloser(func(ctx context.Context, conn *QueueConnection) error {
		return conn.Shutdown(ctx)
	}),
)
```

#### WithCloseGroup

`WithCloseGroup` 将服务分配到指定的关闭分组，控制其在应用关闭期间释放的阶段：

```go
app.Container().Singleton("logger", newLogger,
	container.WithCloseGroup(container.CloseGroupReporting),
)
```

更多细节请参阅[关闭分组](#关闭分组)章节。

---

## 解析服务

### Make 方法

`Make` 方法根据键解析服务。它返回 `any`（空接口），调用方需要自行进行类型断言：

```go
raw, err := app.Container().Make("cache.manager")
if err != nil {
	return err
}
manager := raw.(*cache.Manager)
```

`Make` 按以下顺序解析：

1. 如果已存在已解析的单例实例，直接返回。
2. 如果未找到绑定，尝试[缺失工厂加载器](#缺失工厂加载器)。
3. 执行注册的工厂函数。
4. 对于单例，缓存并返回结果。

### Factory 方法

`Factory` 方法返回一个延迟解析闭包。返回的闭包内部调用 `Make`，保留原始绑定的生命周期语义（瞬时 vs 单例）：

```go
makeQueue, err := app.Container().Factory("queue.manager")
if err != nil {
	return err
}

// 在需要时再解析服务：
raw, err := makeQueue()
```

### 泛型类型安全助手

包级 `Make[T]` 函数提供了类型安全的解析路径。它从**当前应用容器**中解析，并自动执行类型断言：

```go
import "github.com/prismgo/framework/container"

manager, err := container.Make[*cache.Manager]("cache.manager")
if err != nil {
	return err
}
// manager 已经是 *cache.Manager 类型——无需类型断言。
```

如果解析出的值类型与 `T` 不匹配，`Make[T]` 会返回描述性错误。

### Value 助手

包级 `Value[T]` 函数从当前容器中读取**已经解析过**的单例实例。它**不会**创建服务——只返回之前通过 `Make` 调用已解析的实例：

```go
manager := container.Value[*cache.Manager]("cache.manager")
if manager == nil {
	// 服务尚未解析或不存在。
}
```

`Value[T]` 在未找到服务或类型不匹配时返回 `T` 的零值。适用于可选依赖——缺失服务不作为错误处理。

---

## 方法调用与注入

`Call` 方法调用一个函数，并从容器的自动解析其参数。你显式提供的参数按位置优先使用；其余参数通过 `Make` 以参数类型字符串作为服务键来解析：

```go
_, err := app.Container().Call(func(dispatcher event.Dispatcher) error {
	return dispatcher.Dispatch(ctx, evt)
})
```

你也可以显式传入部分参数，让容器解析剩余部分：

```go
result, err := app.Container().Call(func(prefix string, count int) (string, error) {
	return fmt.Sprintf("%s-%d", prefix, count), nil
}, "order")
// 容器尝试按 "int" 键解析 count（如果已绑定），否则使用位置参数。
```

`Call` 返回函数返回值的 `[]any` 切片。如果函数最后一个返回值是 `error`，它也会包含在切片中，由调用方检查。

> **注意**：PrismGo 的 `Call` 有意比 Laravel 的完整方法注入更简单。它未实现上下文绑定、标签解析或可变参数注入。适用于需要容器解析参数的工厂或回调函数。

---

## 容器状态

### 检查服务是否存在

`Has` 检查服务是否可解析。如果当前未注册绑定，它会触发缺失工厂加载器：

```go
if app.Container().Has("cache.manager") {
	// 该服务可以解析。
}
```

`Bound` 仅检查当前绑定表，不会触发缺失工厂加载器：

```go
if app.Container().Bound("cache.manager") {
	// 绑定已注册（但可能尚未解析）。
}
```

当你想知道"现在能调用 `Make` 吗？"时使用 `Has`。当你只想检查是否已经手动注册过（例如在测试中避免重复注册）时使用 `Bound`。

### 检查解析状态

`Resolved` 在服务已经产出过实例时返回 `true`。对于 `Instance`，注册后立即为 `true`。对于 `Singleton`，首次成功的 `Make` 后变为 `true`：

```go
if app.Container().Resolved("cache.manager") {
	// 单例已被实例化。
}
```

### 列出所有条目

`List` 按注册顺序返回所有已知服务的元信息。它不会触发缺失工厂加载器或执行工厂函数：

```go
entries := app.Container().List()
for _, entry := range entries {
	fmt.Printf("key=%s type=%s registered=%v closable=%v group=%s\n",
		entry.Key, entry.Type, entry.Registered, entry.Closable, entry.CloseGroup)
}
```

每个 `EntryInfo` 包含：

| 字段 | 描述 |
| --- | --- |
| `Key` | 服务键 |
| `Type` | 解析后的类型字符串（如 `*cache.Manager`） |
| `Registered` | 服务当前是否持有值 |
| `Closable` | 服务是否注册了关闭函数 |
| `CloseGroup` | 关闭分组，用于关闭顺序控制 |

`List` 适用于诊断、测试关闭行为和审计资源泄漏。

### 重置服务

`Forget` 清除服务的已解析实例和工厂，允许重新注册或重新解析：

```go
app.Container().Forget("cache.manager")
_ = app.Container().Singleton("cache.manager", newTestCache)
```

`Forget` **不会**调用服务的关闭函数。如果服务持有外部资源，请在调用 `Forget` 前手动关闭。

---

## 资源生命周期

### 关闭分组

PrismGo 的容器提供了结构化的关闭机制。应用退出时，按注册顺序的**反序**调用 `Close` 或 `CloseGroup` 来释放资源。

提供两个内置关闭分组：

| 分组 | 常量 | 描述 |
| --- | --- | --- |
| 普通 | `CloseGroupNormal` | 默认分组。资源在错误上报前释放。 |
| 上报 | `CloseGroupReporting` | 日志、异常处理器和错误上报客户端资源。在普通分组之后释放，确保正常关闭期间上报能力可用。 |

```go
// 按反序释放所有注册资源。
err := app.Container().Close(ctx)

// 仅释放 "reporting" 分组。
err := app.Container().CloseGroup(ctx, container.CloseGroupReporting)
```

### 自定义关闭行为

#### 关闭顺序

服务按注册顺序的**反序**关闭。如果服务 `A` 依赖于服务 `B`，先注册 `B`，再注册 `A`。关闭时，`A` 在 `B` 之前被关闭。

#### 关闭函数

关闭函数是一个释放服务外部资源的函数。在绑定时通过 `WithCloser` 或 `WithContextCloser` 注册：

```go
app.Container().Singleton("db.connection", newDBConnection,
	container.WithContextCloser(func(ctx context.Context, conn *DBConnection) error {
		return conn.Close(ctx)
	}),
)
```

- `WithCloser[T]`：关闭函数接收类型化值和后台 context。
- `WithContextCloser[T]`：关闭函数接收类型化值和应用的关闭 context，可能携带超时或取消信号。

只有 `Singleton` 和 `Instance` 绑定可以有关闭函数。`Bind`（瞬时）服务不会被容器保留，也不会被关闭。

### 优雅关闭语义

`Close` 方法遵循以下语义：

- 如果在 `Close` 开始前 context 已取消，则不改变任何状态。
- 关闭函数执行成功（或没有关闭函数）的服务会被清空。
- 如果关闭函数返回错误，服务保留其已注册状态（允许调用方检查或重试）。
- 如果在关闭过程中 context 被取消，剩余服务保留其已注册状态。

这种设计允许调用方在解决失败后重试关闭剩余资源：

```go
err := app.Container().Close(ctx)
if err != nil {
	// 通过 List() 检查哪些服务仍然存在
	remaining := app.Container().List()
	// 记录日志或重试关闭剩余资源。
}
```

---

## 缺失工厂加载器

缺失工厂加载器是一个回调函数，在 `Make`、`Has` 或 `Factory` 找不到已注册绑定时被调用。这实现了**延迟提供者（deferred provider）** 支持：像 `cache.manager` 或 `queue.manager` 这样的服务只有在首次访问时才注册，而不是在启动时立即注册。

通过 `SetMissingFactoryLoader` 安装加载器：

```go
app.Container().SetMissingFactoryLoader(func(key string) error {
	// 加载注册 "cache.manager" 的提供者
	return loadDeferredProvider(key)
})
```

加载器应仅为给定键注册绑定——不应创建重量级资源。如果加载器返回错误，`Has` 将服务视为不可解析，`Make` / `Factory` 将错误传播给调用方。

PrismGo foundation 内部使用此机制支持延迟加载的服务提供者。

---

## 包级 Facade

`container` 包提供操作**当前应用容器**的便捷函数。这些是在业务代码中解析服务的主要方式，无需显式传递容器实例：

```go
import "github.com/prismgo/framework/container"
```

| 函数 | 描述 |
| --- | --- |
| `Make[T](key)` | 从当前应用容器类型安全地解析服务 |
| `Value[T](key)` | 读取已解析的单例（不会创建） |
| `Close(ctx)` | 关闭当前容器中所有已注册资源 |
| `List()` | 列出当前容器中所有已知条目 |
| `SetProvider(provider)` | 注入当前容器提供者（由 `foundation` 调用） |

当前容器提供者由 `foundation.NewApplication` 注入，并在 `Application.Close` 时清除。如果未设置当前容器，`Make[T]` 返回 `ErrNoCurrentContainer`。

---

## 错误常量

| 错误常量 | 描述 |
| --- | --- |
| `container.ErrFactoryNotRegistered` | 请求的服务键未注册工厂 |
| `container.ErrFactoryReturnedNil` | 工厂执行成功但返回了 `nil` |
| `container.ErrNoCurrentContainer` | 在没有当前应用容器时尝试包级操作 |

所有错误都可以通过 `errors.Is` 比较：

```go
_, err := container.Make[*CacheManager]("cache.manager")
if errors.Is(err, container.ErrNoCurrentContainer) {
	// 应用尚未初始化。
}
```

---

## Laravel 容器映射

| Laravel | PrismGo 对应 |
| --- | --- |
| `$app->bind($key, $factory)` | `app.Container().Bind(key, factory)` |
| `$app->singleton($key, $factory)` | `app.Container().Singleton(key, factory)` |
| `$app->instance($key, $instance)` | `app.Container().Instance(key, instance)` |
| `$app->alias($key, $alias)` | `app.Container().Alias(key, alias)` |
| `$app->make($key)` | `app.Container().Make(key)` |
| `$app->resolved($key)` | `app.Container().Resolved(key)` |
| `$app->bound($key)` | `app.Container().Bound(key)` |
| `App::make($key)` | `container.Make[T](key)` |
| `$app->call($callback)` | `app.Container().Call(callback)` |
| — | `container.Value[T](key)`（读取已有实例） |
| — | `container.Close(ctx)`（资源生命周期管理） |
| `$app->tag($keys, $tag)` | 不直接支持；请使用服务键 |
| `$app->when($class)->needs($iface)->give($impl)` | 不直接支持（无上下文绑定） |
