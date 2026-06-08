# Facade（门面）

- [简介](#简介)
- [Facade 的工作原理](#facade-的工作原理)
- [核心 Facade：facade.Resolve](#核心-facadefacaderesolve)
- [可用 Facade](#可用-facade)
    - [Cache Facade](#cache-facade)
    - [Config Facade](#config-facade)
    - [Route Facade](#route-facade)
    - [Logger Facade](#logger-facade)
    - [Database Facade](#database-facade)
    - [Filesystem Facade](#filesystem-facade)
- [Facade 类参考](#facade-类参考)
- [Laravel Facade 映射](#laravel-facade-映射)

---

PrismGo 的 Facade 为 [服务容器](/docs/container) 中注册的服务提供了"静态"访问接口。Facade 充当服务容器中底层类的"静态代理"，提供简洁、富有表现力的语法，同时保持比传统静态方法更好的可测试性和灵活性。

---

## 简介

在 PrismGo 的文档和源码中，你会看到通过包级函数与框架功能交互的代码示例。例如：

```go
import "github.com/prismgo/framework/cache"

// 使用 Cache Facade 写入缓存
if err := cache.Put(ctx, "site.name", "PrismGo", 10*time.Minute); err != nil {
    return err
}

// 使用 Cache Facade 读取缓存
name, err := cache.Get[string](ctx, "site.name", cache.Value("Default Name"))
```

这里的 `cache.Put` 和 `cache.Get` 并不是某个结构体上的方法，而是 `cache` 包提供的包级便利函数。它们内部通过 `facade.Resolve` 从当前 Application 的容器中解析出底层的缓存 Manager，再委托给该实例执行实际操作。

Facade 的核心价值在于：

- **简洁语法**：无需手动注入或获取服务实例，直接通过包级函数调用。
- **类型安全**：通过 Go 泛型提供强类型返回值。
- **可测试性**：底层服务由容器管理，可在测试中替换实现。
- **统一入口**：所有模块遵循相同的解析模式，降低学习成本。

## Facade 的工作原理

PrismGo 的 Facade 实现位于 `github.com/prismgo/framework/facade` 包，核心逻辑是一个泛型函数：

```go
// Resolve 从当前 Application 容器解析服务。
// 容器未装配、key 无绑定、类型不匹配或 factory 返回错误时，统一 panic 暴露装配问题。
func Resolve[T any](key string) T
```

它的工作流程如下：

1. 调用 `container.Make[T](key)`，从当前 Application 的容器中按 key 解析服务。
2. 如果容器未装配（没有当前 Application）、key 未绑定、类型不匹配或 factory 返回错误，`container.Make` 返回 error。
3. `facade.Resolve` 将这些错误转换为 panic，确保装配问题在开发期立刻暴露，避免调用方拿到零值后继续执行。

每个功能模块（cache、config、route、logger 等）在其包内定义一个 `facade.go` 文件，通过 `facade.Resolve` 获取底层服务实例，再提供一组包级便利函数。调用链如下：

```
业务代码 → cache.Put(ctx, key, val, ttl) 
         → cache.Default() → cache.Resolve().Default() 
         → facade.Resolve[*Manager]("cache.manager") 
         → container.Make[*Manager]("cache.manager") 
         → 当前 Application 容器返回已注册的 Manager 实例
```

## 核心 Facade：facade.Resolve

`facade.Resolve` 是所有模块 Facade 的基础。如果你需要直接获取容器中的一个服务，可以像这样使用：

```go
import "github.com/prismgo/framework/facade"

// 从容器解析 *cache.Manager
manager := facade.Resolve[*cache.Manager]("cache.manager")
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `T` | 泛型参数 | 期望返回的服务类型 |
| `key` | `string` | 服务在容器中注册的键名 |

**行为说明：**

- 服务存在且类型匹配：返回该服务的指针/值。
- 服务不存在、类型不匹配或 factory 返回错误：**panic**（非 error 返回）。
- 当前无 Application 容器：**panic**。

> 这种设计是有意为之的：Facade 是严格便捷入口，解析错误如果被吞掉会让调用方拿到零值继续执行。因此 facade 层统一 panic 暴露装配问题，让开发阶段就能发现错误。

## 可用 Facade

### Cache Facade

**包路径：** `github.com/prismgo/framework/cache`

**服务键名：** `"cache.manager"`

**底层类型：** `*Manager`

Cache Facade 提供了对缓存系统的便捷访问。它管理多个缓存存储（Memory、Redis、File、Failover），每个存储通过 `Repository` 暴露读写操作。

#### 解析方法

```go
// Resolve 返回缓存 Factory 契约
func Resolve() cachecontract.Factory
```

#### 配置参数

缓存配置在 `config/cache.go` 中注册。主要参数：

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cache.default` | `CACHE_STORE` | `"memory"` | 默认缓存存储名称 |
| `cache.encoding` | `CACHE_ENCODING` | `""` | 编码方式：`msgpack` 或 `json` |
| `cache.prefix` | `CACHE_PREFIX` | `"workorder_cache"` | 全局缓存 key 前缀 |

详细配置参数请参考 [Cache 文档](/docs/cache)。

#### 可用函数

**存储选择与基本信息：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `DefaultName` | `() string` | 返回默认 store 名称 |
| `Default` | `() cachecontract.Repository` | 返回默认 store 对应的 Repository |
| `Store` | `(name string) cachecontract.Repository` | 按名称返回 Repository；name 为空时返回默认 store |
| `Name` | `() string` | 返回默认 store 的 Repository 名称 |
| `Close` | `() error` | 释放已构建 store 持有的外部资源 |

**写入操作：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Put` | `(ctx, key, value, ttl) error` | 写入默认 store |
| `PutFrom` | `(ctx, storeName, key, value, ttl) error` | 写入指定 store |
| `Set` | `(ctx, key, value, ttl) error` | Put 的别名 |
| `SetFrom` | `(ctx, storeName, key, value, ttl) error` | PutFrom 的别名 |
| `Forever` | `(ctx, key, value) error` | 永久写入默认 store |
| `ForeverFrom` | `(ctx, storeName, key, value) error` | 永久写入指定 store |
| `Add` | `(ctx, key, value, ttl) (bool, error)` | 仅当 key 不存在时写入 |
| `AddFrom` | `(ctx, storeName, key, value, ttl) (bool, error)` | 仅当 key 不存在时写入指定 store |
| `PutMany` | `(ctx, values, ttl) error` | 批量写入默认 store |
| `PutManyFrom` | `(ctx, storeName, values, ttl) error` | 批量写入指定 store |
| `SetMultiple` | `(ctx, values, ttl) error` | PutMany 的别名 |
| `SetMultipleFrom` | `(ctx, storeName, values, ttl) error` | PutManyFrom 的别名 |

**读取操作：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Get[T]` | `(ctx, key, fallback...) (T, error)` | 读取并解码为泛型 T |
| `GetFrom[T]` | `(ctx, storeName, key, fallback...) (T, error)` | 从指定 store 读取并解码 |
| `String` | `(ctx, key, fallback...) (string, error)` | 读取字符串值 |
| `StringFrom` | `(ctx, storeName, key, fallback...) (string, error)` | 从指定 store 读取字符串 |
| `Integer` | `(ctx, key, fallback...) (int, error)` | 读取整数值 |
| `IntegerFrom` | `(ctx, storeName, key, fallback...) (int, error)` | 从指定 store 读取整数 |
| `Float` | `(ctx, key, fallback...) (float64, error)` | 读取 float64 值 |
| `FloatFrom` | `(ctx, storeName, key, fallback...) (float64, error)` | 从指定 store 读取 float64 |
| `Boolean` | `(ctx, key, fallback...) (bool, error)` | 读取布尔值 |
| `BooleanFrom` | `(ctx, storeName, key, fallback...) (bool, error)` | 从指定 store 读取布尔值 |
| `Has` | `(ctx, key) (bool, error)` | 判断 key 是否存在 |
| `HasFrom` | `(ctx, storeName, key) (bool, error)` | 判断指定 store 中 key 是否存在 |
| `Missing` | `(ctx, key) (bool, error)` | 判断 key 是否不存在 |
| `MissingFrom` | `(ctx, storeName, key) (bool, error)` | 判断指定 store 中 key 是否不存在 |
| `Many[T]` | `(ctx, keys, fallback...) (map[string]T, error)` | 批量读取并解码 |
| `ManyFrom[T]` | `(ctx, storeName, keys, fallback...) (map[string]T, error)` | 从指定 store 批量读取 |
| `GetMultiple[T]` | `(ctx, keys, fallback...) (map[string]T, error)` | Many 的别名 |
| `GetMultipleFrom[T]` | `(ctx, storeName, keys, fallback...) (map[string]T, error)` | ManyFrom 的别名 |

**读取与存入（Remember 模式）：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Remember[T]` | `(ctx, key, ttl, loader) (T, error)` | 读取默认 store；未命中时执行 loader 并写入 |
| `RememberFrom[T]` | `(ctx, storeName, key, ttl, loader) (T, error)` | 读取指定 store；未命中时执行 loader 并写入 |
| `RememberForever[T]` | `(ctx, key, loader) (T, error)` | 读取；未命中时执行 loader 并永久写入 |
| `RememberForeverFrom[T]` | `(ctx, storeName, key, loader) (T, error)` | 读取指定 store；未命中时永久写入 |
| `Sear[T]` | `(ctx, key, loader) (T, error)` | RememberForever 的别名 |
| `SearFrom[T]` | `(ctx, storeName, key, loader) (T, error)` | RememberForeverFrom 的别名 |
| `Flexible[T]` | `(ctx, key, window, loader) (T, error)` | 热点缓存两段式刷新 |
| `FlexibleFrom[T]` | `(ctx, storeName, key, window, loader) (T, error)` | 指定 store 的热点缓存 |

**TTL 操作：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Touch` | `(ctx, key, ttl) (bool, error)` | 延长已存在 key 的 TTL |
| `TouchFrom` | `(ctx, storeName, key, ttl) (bool, error)` | 延长指定 store 中 key 的 TTL |

**计数器：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Increment` | `(ctx, key, delta...) (int64, error)` | 原子递增默认 store 中的整数 |
| `IncrementFrom` | `(ctx, storeName, key, delta...) (int64, error)` | 原子递增指定 store 中的整数 |
| `Decrement` | `(ctx, key, delta...) (int64, error)` | 原子递减默认 store 中的整数 |
| `DecrementFrom` | `(ctx, storeName, key, delta...) (int64, error)` | 原子递减指定 store 中的整数 |

**读取与删除：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Pull[T]` | `(ctx, key, fallback...) (T, error)` | 读取值并立即删除 |
| `PullFrom[T]` | `(ctx, storeName, key, fallback...) (T, error)` | 从指定 store 读取并删除 |

**删除与清空：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Forget` | `(ctx, key) error` | 删除指定 key |
| `ForgetFrom` | `(ctx, storeName, key) error` | 删除指定 store 中的 key |
| `Delete` | `(ctx, key) error` | Forget 的别名 |
| `ForgetMany` | `(ctx, keys) error` | 批量删除 |
| `ForgetManyFrom` | `(ctx, storeName, keys) error` | 批量删除指定 store 中的 key |
| `DeleteMultiple` | `(ctx, keys) error` | ForgetMany 的别名 |
| `DeleteMultipleFrom` | `(ctx, storeName, keys) error` | ForgetManyFrom 的别名 |
| `Flush` | `(ctx) error` | 清空默认 store |
| `FlushFrom` | `(ctx, storeName) error` | 清空指定 store |
| `Clear` | `(ctx) error` | Flush 的别名 |
| `ClearFrom` | `(ctx, storeName) error` | FlushFrom 的别名 |

**原子锁：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Lock` | `(name string, ttl time.Duration) cachecontract.Lock` | 创建带 TTL 的锁 |
| `LockFrom` | `(storeName, name string, ttl time.Duration) cachecontract.Lock` | 基于指定 store 创建锁 |
| `LockWithOwner` | `(name string, ttl time.Duration, owner string) cachecontract.Lock` | 创建指定 owner 的锁 |
| `LockWithOwnerFrom` | `(storeName, name string, ttl time.Duration, owner string) cachecontract.Lock` | 基于指定 store 创建指定 owner 的锁 |
| `RestoreLock` | `(name, owner string) cachecontract.Lock` | 恢复一个可释放的锁 |
| `RestoreLockFrom` | `(storeName, name, owner string) cachecontract.Lock` | 恢复指定 store 的锁 |
| `FlushLocks` | `(ctx) error` | 清理锁命名空间 |
| `FlushLocksFrom` | `(ctx, storeName) error` | 清理指定 store 的锁命名空间 |

**并发限制：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Funnel` | `(name string) cachecontract.FunnelLimiter` | 创建并发限制器 |
| `FunnelFrom` | `(storeName, name string) cachecontract.FunnelLimiter` | 基于指定 store 创建并发限制器 |

**标签缓存：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Tags` | `(tags ...string) cachecontract.TaggedRepository` | 创建 tagged cache 操作入口 |
| `TagsFrom` | `(storeName string, tags ...string) cachecontract.TaggedRepository` | 基于指定 store 创建 tagged cache |

**记忆化缓存：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Memo` | `() cachecontract.MemoRepository` | 请求/任务内记忆化缓存入口 |
| `MemoFrom` | `(storeName string) cachecontract.MemoRepository` | 基于指定 store 的记忆化缓存 |

**关闭选项：**

```go
func ManagerCloseOption() containercontract.BindingOption
```

返回缓存 Manager 的关闭选项，供 bootstrap 注册时使用。

---

### Config Facade

**包路径：** `github.com/prismgo/framework/config`

**服务键名：** `"config.default"`

**底层类型：** `*Config`

Config Facade 提供对应用配置的便捷访问。配置数据来源于 `config/` 目录下的 Go 文件和 `.env` 文件。

#### 解析方法

```go
func Resolve() *Config
```

#### 可用函数

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Clone` | `() *Config` | 复制当前配置访问器，返回持有独立配置仓库的新实例 |
| `Empty` | `() bool` | 判断当前配置访问器是否尚未持有任何配置项 |
| `Reload` | `() error` | 从项目根目录 `.env` 重新加载当前配置对象 |
| `Get` | `(path string, defaultValue ...any) string` | 读取字符串配置，缺失时回退到默认值 |
| `GetString` | `(path string, defaultValue ...any) string` | 读取字符串配置 |
| `GetInt` | `(path string, defaultValue ...any) int` | 读取整型配置 |
| `GetFloat64` | `(path string, defaultValue ...any) float64` | 读取 float64 配置 |
| `GetInt64` | `(path string, defaultValue ...any) int64` | 读取 int64 配置 |
| `GetUint` | `(path string, defaultValue ...any) uint` | 读取 uint 配置 |
| `GetBool` | `(path string, defaultValue ...any) bool` | 读取布尔配置 |
| `GetStringMapString` | `(path string) map[string]string` | 读取 `map[string]string` 配置 |
| `GetStringMap` | `(path string) map[string]any` | 读取 `map[string]any` 配置 |

**使用示例：**

```go
import "github.com/prismgo/framework/config"

// 读取字符串配置
appName := config.Get("app.name", "PrismGo")

// 读取整数配置
port := config.GetInt("app.port", 8080)

// 读取布尔配置
debug := config.GetBool("app.debug", false)

// 重新加载 .env
if err := config.Reload(); err != nil {
    // 处理错误
}
```

---

### Route Facade

**包路径：** `github.com/prismgo/framework/route`

**服务键名：** `"route.router"`

**底层类型：** `*Router`

Route Facade 提供 HTTP 路由注册和管理的便捷访问。底层基于 Gin 框架。

#### 解析方法

```go
func Resolve() *Router
```

#### 可用函数

**路由注册：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Get` | `(uri string, handlers ...HandlerFunc) *Route` | 注册 GET 路由 |
| `Post` | `(uri string, handlers ...HandlerFunc) *Route` | 注册 POST 路由 |
| `Put` | `(uri string, handlers ...HandlerFunc) *Route` | 注册 PUT 路由 |
| `Patch` | `(uri string, handlers ...HandlerFunc) *Route` | 注册 PATCH 路由 |
| `Delete` | `(uri string, handlers ...HandlerFunc) *Route` | 注册 DELETE 路由 |
| `Options` | `(uri string, handlers ...HandlerFunc) *Route` | 注册 OPTIONS 路由 |
| `Match` | `(methods []string, uri string, handlers ...HandlerFunc) *Route` | 注册匹配多个方法的路由 |
| `Any` | `(uri string, handlers ...HandlerFunc) *Route` | 注册匹配所有 HTTP 方法的路由 |
| `Redirect` | `(uri, destination string, status ...int) *Route` | 注册重定向路由 |
| `PermanentRedirect` | `(uri, destination string) *Route` | 注册永久重定向路由 |
| `Static` | `(uri, root string) *Route` | 注册静态文件路由 |
| `Fallback` | `(handler HandlerFunc) *Route` | 注册 fallback 路由 |

**路由组与属性：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Prefix` | `(prefix string) *Registrar` | 设置路由前缀 |
| `Name` | `(name string) *Registrar` | 设置路由名称 |
| `Domain` | `(domain string) *Registrar` | 设置路由域名 |
| `Middleware` | `(handlers ...HandlerFunc) *Registrar` | 设置路由中间件 |
| `WithoutMiddleware` | `(names ...string) *Registrar` | 排除指定中间件 |
| `Controller` | `(controller any) *Registrar` | 绑定控制器 |
| `Group` | `(fn func())` | 创建路由组 |

**参数绑定：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Bind` | `(param string, binder Binder)` | 绑定参数解析器 |
| `Model` | `(param string, binder Binder)` | 绑定模型解析器 |
| `Pattern` | `(param, expr string)` | 设置参数正则约束 |

**路由信息：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Mount` | `(engine *gin.Engine) error` | 将路由挂载到 Gin 引擎 |
| `List` | `() []RouteInfo` | 列出所有已注册路由 |
| `URL` | `(name string, params map[string]any) (string, error)` | 根据路由名和参数生成 URL |

**使用示例：**

```go
import "github.com/prismgo/framework/route"

// 注册路由
route.Get("/users", func(ctx *gin.Context) {
    ctx.JSON(200, gin.H{"message": "Hello"})
})

// 路由组
route.Prefix("/api").Group(func() {
    route.Get("/users", ListUsers)
    route.Post("/users", CreateUser)
})

// 命名路由生成 URL
url, _ := route.URL("user.profile", map[string]any{"id": 123})
```

---

### Logger Facade

**包路径：** `github.com/prismgo/framework/logger`

**服务键名：** `"logger.manager"`

**底层类型：** `*Manager`

Logger Facade 提供结构化日志记录的便捷访问。底层基于 logrus，支持多通道（Channel）日志输出。

#### 解析方法

```go
func Resolve() *Manager
```

#### 可用函数

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `DefaultName` | `() string` | 返回默认通道名称 |
| `Close` | `() error` | 释放已构造通道的底层驱动资源 |
| `Channel` | `(name string) Logger` | 按名称获取通道 Logger |
| `Debug` | `(args ...any)` | 通过默认通道记录 debug 日志 |
| `Debugf` | `(format string, args ...any)` | 按格式记录 debug 日志 |
| `Info` | `(args ...any)` | 记录 info 日志 |
| `Infof` | `(format string, args ...any)` | 按格式记录 info 日志 |
| `Warn` | `(args ...any)` | 记录 warn 日志 |
| `Warnf` | `(format string, args ...any)` | 按格式记录 warn 日志 |
| `Error` | `(args ...any)` | 记录 error 日志 |
| `Errorf` | `(format string, args ...any)` | 按格式记录 error 日志 |
| `Fatal` | `(args ...any)` | 记录 fatal 日志 |
| `Fatalf` | `(format string, args ...any)` | 按格式记录 fatal 日志 |
| `WithField` | `(key string, value any) Logger` | 附加单个上下文字段 |
| `WithFields` | `(fields map[string]any) Logger` | 附加多个上下文字段 |
| `WithError` | `(err error) Logger` | 附加错误上下文 |
| `WithContext` | `(ctx context.Context) Logger` | 附加 context 关联字段 |

**使用示例：**

```go
import "github.com/prismgo/framework/logger"

// 基本日志
logger.Info("Server started on port", port)
logger.Infof("Server started on port %d", port)

// 带字段的结构化日志
logger.WithField("request_id", reqID).Info("Processing request")

// 使用指定通道
logger.Channel("stack").Debug("debug message")

// 错误日志
logger.WithError(err).Error("Failed to process")
```

---

### Database Facade

**包路径：** `github.com/prismgo/framework/database`

**服务键名：** `"database.default"`

**底层类型：** `*gorm.DB`

Database Facade 提供 GORM 数据库连接的便捷访问。

#### 解析方法

```go
func Resolve() *gorm.DB
```

#### 可用函数

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `DBCloseOption` | `() containercontract.BindingOption` | 返回数据库连接的关闭选项，供 bootstrap 注册时使用 |

**使用示例：**

```go
import "github.com/prismgo/framework/database"

// 获取 GORM DB 实例
db := database.Resolve()

// 执行查询
var users []User
db.Find(&users)
```

---

### Filesystem Facade

**包路径：** `github.com/prismgo/framework/filesystem`

**服务键名：** `"filesystem.manager"`

**底层类型：** `*Manager`

Filesystem Facade 提供文件存储操作的便捷访问。支持本地磁盘和云存储（如 S3、OSS 等）。

#### 解析方法

```go
func Resolve() *Manager
```

#### 可用函数

**磁盘选择与基本信息：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `DefaultName` | `() string` | 返回默认磁盘名称 |
| `CloudName` | `() string` | 返回配置的云磁盘名称 |
| `Default` | `() fscontract.Repository` | 返回默认磁盘对应的 Repository |
| `Disk` | `(name string) fscontract.Repository` | 返回指定名称的全局磁盘 |
| `Name` | `() string` | 返回默认磁盘的仓储名称 |
| `Close` | `() error` | 关闭全局管理器中已创建的磁盘实例 |

**写入操作：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Put` | `(ctx, key, value any, opts ...PutOptions) error` | 写入内容 |
| `PutReader` | `(ctx, key string, reader io.Reader, opts ...PutOptions) error` | 写入 Reader 内容 |
| `PutFile` | `(ctx, dir string, file *multipart.FileHeader, opts ...PutOptions) (string, error)` | 按原文件名保存上传文件 |
| `PutFileAs` | `(ctx, dir string, file *multipart.FileHeader, name string, opts ...PutOptions) (string, error)` | 按指定文件名保存上传文件 |

**读取操作：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Get` | `(ctx, key string) ([]byte, error)` | 读取文件内容 |
| `OpenStream` | `(ctx, key string) (io.ReadCloser, FileInfo, error)` | 以流式方式打开文件 |
| `Download` | `(ctx, key string, w io.Writer) error` | 将文件内容复制到指定 Writer |

**文件检查与操作：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `Exists` | `(ctx, key string) (bool, error)` | 判断文件是否存在 |
| `Delete` | `(ctx, keys ...string) error` | 删除文件 |
| `Copy` | `(ctx, src, dst string) error` | 复制文件 |
| `Move` | `(ctx, src, dst string) error` | 移动文件 |
| `Path` | `(key string) string` | 返回物理路径或逻辑路径 |
| `Size` | `(ctx, key string) (int64, error)` | 返回文件大小 |
| `LastModified` | `(ctx, key string) (time.Time, error)` | 返回最后修改时间 |
| `LastModifiedInfo` | `(ctx, key string) (FileInfo, error)` | 返回完整文件元信息 |

**目录操作：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `MakeDirectory` | `(ctx, dir string) error` | 创建目录 |
| `DeleteDirectory` | `(ctx, dir string) error` | 删除目录 |
| `Files` | `(ctx, dir string) ([]string, error)` | 列出当前层文件 |
| `AllFiles` | `(ctx, dir string) ([]string, error)` | 递归列出文件 |
| `Directories` | `(ctx, dir string) ([]string, error)` | 列出当前层目录 |
| `AllDirectories` | `(ctx, dir string) ([]string, error)` | 递归列出目录 |

**URL 与可见性：**

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `URL` | `(key string) (string, error)` | 生成公开访问地址 |
| `TemporaryURL` | `(ctx, key string, expiry time.Time) (string, error)` | 生成临时签名地址 |
| `SetVisibility` | `(ctx, key, visibility string) error` | 设置文件可见性 |
| `GetVisibility` | `(ctx, key string) (string, error)` | 获取文件可见性 |

**临时 URL 校验：**

```go
func VerifyTemporaryURL(disk, key string, expires time.Time, signature string) error
```

校验本地临时链接的签名和过期时间。

**关闭选项：**

```go
func ManagerCloseOption() containercontract.BindingOption
```

返回文件系统 Manager 的关闭选项，供 bootstrap 注册时使用。

**使用示例：**

```go
import "github.com/prismgo/framework/filesystem"

// 写入文件
if err := filesystem.Put(ctx, "avatars/user1.jpg", data); err != nil {
    return err
}

// 读取文件
content, err := filesystem.Get(ctx, "avatars/user1.jpg")

// 使用指定磁盘
repo := filesystem.Disk("s3")
if err := repo.Put(ctx, "docs/report.pdf", pdfData); err != nil {
    return err
}

// 生成临时 URL
url, err := filesystem.TemporaryURL(ctx, "docs/report.pdf", time.Now().Add(1*time.Hour))
```

---

## Facade 类参考

下表汇总了所有可用的 Facade 及其底层类和服务容器绑定键：

| Facade（包路径） | 底层类型 | 服务容器绑定键 |
| --- | --- | --- |
| `github.com/prismgo/framework/cache` | `*Manager` | `"cache.manager"` |
| `github.com/prismgo/framework/config` | `*Config` | `"config.default"` |
| `github.com/prismgo/framework/route` | `*Router` | `"route.router"` |
| `github.com/prismgo/framework/logger` | `*Manager` | `"logger.manager"` |
| `github.com/prismgo/framework/database` | `*gorm.DB` | `"database.default"` |
| `github.com/prismgo/framework/filesystem` | `*Manager` | `"filesystem.manager"` |

---

## Laravel Facade 映射

如果你熟悉 Laravel 的 Facade 系统，下表可以帮助你快速找到 PrismGo 中对应的 Facade：

| Laravel Facade | PrismGo 包 | 说明 |
| --- | --- | --- |
| `Cache` | `cache` | 缓存管理（Memory / Redis / File / Failover） |
| `Config` | `config` | 配置管理 |
| `Route` | `route` | 路由注册与管理 |
| `Log` | `logger` | 结构化日志 |
| `DB` | `database` | 数据库查询（GORM） |
| `Storage` | `filesystem` | 文件存储（本地 / 云存储） |