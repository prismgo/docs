---
title: "Rate Limiting"
---

# Rate Limiting

- [功能概览](#功能概览)
- [架构概览](#架构概览)
- [配置](#配置)
- [快速开始](#快速开始)
- [命名限流器](#命名限流器)
- [Limit 构造器](#limit-构造器)
- [Limit 链式方法](#limit-链式方法)
- [Gin 中间件](#gin-中间件)
- [route 包兼容用法](#route-包兼容用法)
- [手动计数 API](#手动计数-api)
- [哈希 key](#哈希-key)
- [Key 设计建议](#key-设计建议)
- [工作机制](#工作机制)
- [错误处理](#错误处理)
- [与 Laravel 13 的边界](#与-laravel-13-的边界)

`github.com/prismgo/framework/ratelimit` 提供 Laravel RateLimiter 风格的固定窗口限流能力。它通过 `github.com/prismgo/framework/cache` 管理限流状态，复用已有的 memory / redis 缓存配置，同时提供 Gin 中间件和手动计数 API 两种使用方式。

本文档按 Laravel 13 Rate Limiting 文档的能力模型组织：配置、使用方式、命名限流器、中间件、手动计数 API 和最佳实践。PrismGo 保持 Go 的显式 `context.Context`、`time.Duration` 和错误返回语义。

## 功能概览

| 能力 | PrismGo 入口 | Laravel 对应 |
| --- | --- | --- |
| 命名限流器 | `ratelimit.For("login", fn)` | `RateLimiter::for("login", fn)` |
| 中间件挂载 | `middleware.Throttle("login")` | `throttle:login` 中间件 |
| 固定窗口 | `PerMinute(5)` / `Every(30s, 10)` | `Limit::perMinute(5)` |
| 按维度限流 | `By("user:" + userID)` | `->by($request->user()->id)` |
| 后置计数 | `After(fn)` | `->after(fn)` |
| 自定义响应 | `Response(fn)` | `->response(fn)` |
| 手动计数 | `Hit` / `Increment` / `Attempts` | `RateLimiter::hit()` / `->attempts()` |
| 原子操作 | `Attempt` | `RateLimiter::attempt()` |
| 响应头 | `X-RateLimit-Limit` / `Remaining` / `Retry-After` | 对齐 Laravel 响应头 |

## 架构概览

限流模块的依赖关系：

```
┌─────────────────────────────────────────────────────┐
│                   routes/api.go                      │
│  route.Post("/login", middleware.Throttle("login"))  │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│      github.com/prismgo/framework/http/middleware    │
│           Throttle / ThrottleFor 中间件              │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│          github.com/prismgo/framework/ratelimit      │
│         RateLimiter 核心：计数、窗口、判断           │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│      github.com/prismgo/framework/cache (Repository) │
│   memory / redis / file / failover store            │
└─────────────────────────────────────────────────────┘
```

- **路由层**：在 `routes/api.go` 中通过 `middleware.Throttle("login")` 挂载到路由或分组。
- **中间件层**：`github.com/prismgo/framework/http/middleware` 将命名限流器转换为 Gin 中间件，处理限流判断、响应头写入和超限响应。
- **限流核心**：`github.com/prismgo/framework/ratelimit` 管理命名限流器注册表、固定窗口计数和手动 API。
- **缓存层**：限流状态通过 `github.com/prismgo/framework/cache` 持久化，支持 memory（单进程）和 redis（多实例）两种 store。

## 配置

### 环境变量

限流器使用的缓存 store 通过 `CACHE_LIMITER_DRIVER` 环境变量控制：

```dotenv
# 默认缓存 store（全局限流器 fallback 时使用）
CACHE_STORE=memory

# 限流器专用缓存 store 名称
# 留空时回退到 CACHE_STORE 的值
CACHE_LIMITER_DRIVER=memory

# 当使用 Redis 作为限流缓存时需要的 Redis 配置
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_CACHE_DB=0
```

### 配置项说明

| 配置项 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cache.default` | `CACHE_STORE` | `memory` | 默认缓存 store，限流器在未配置专用 store 时回退使用 |
| `cache.limiter.driver` | `CACHE_LIMITER_DRIVER` | `memory` | 限流器专用缓存 store 名称。与 `cache.default` 独立配置，可让限流器使用不同 store |

### 配置行为

限流器缓存 store 的解析优先级：

1. 如果 `cache.limiter.driver` 配置了非空值，使用该名称对应的 store。
2. 如果 `cache.limiter.driver` 为空，回退使用 `cache.default` 对应的默认 store。

**生产环境建议**：多实例部署时，将 `CACHE_LIMITER_DRIVER` 设为 `redis`，确保限流状态在所有实例间共享。如果使用 `memory` 驱动，限流只对当前进程生效，无法阻止其他实例上的请求。

```dotenv
# 生产环境：限流器使用 Redis，其他缓存可用 memory
CACHE_STORE=memory
CACHE_LIMITER_DRIVER=redis
REDIS_HOST=redis-cluster.internal
REDIS_PORT=6379
REDIS_CACHE_DB=2
```

### 配置注册

限流器配置在 `config/cache.go` 中注册：

```go
// config/cache.go
func init() {
    Add("cache", func() map[string]interface{} {
        return map[string]interface{}{
            "default": Env("CACHE_STORE", "memory"),
            "limiter": map[string]interface{}{
                "driver": Env("CACHE_LIMITER_DRIVER", "memory"),
            },
            "stores": map[string]interface{}{
                "memory": map[string]interface{}{
                    "driver": "memory",
                    "prefix": Env("CACHE_MEMORY_PREFIX", "memory"),
                },
                "redis": map[string]interface{}{
                    "driver":     "redis",
                    "prefix":     Env("CACHE_REDIS_PREFIX", "redis"),
                    "connection": Env("CACHE_REDIS_CONNECTION", "cache"),
                },
            },
        }
    })
}
```

## 快速开始

### 应用启动时自动初始化

应用启动时 `cache.ServiceProvider` 已完成注册，`ratelimit` 会自动使用 `cache.limiter.driver` 指定（或回退到默认）的 cache store。无需手动初始化。

### 注册命名限流器并挂载到路由

最常见的用法：

```go
// app/providers/rate_limit_service_provider.go
// 在服务提供者的 Boot 方法中注册命名限流器

import (
    "github.com/gin-gonic/gin"
    providercontract "github.com/prismgo/framework/contracts/provider"
    "github.com/prismgo/framework/ratelimit"
)

type RateLimitServiceProvider struct{}

func (p RateLimitServiceProvider) Register(app providercontract.Application) error {
    return nil
}

func (p RateLimitServiceProvider) Boot(app providercontract.Application) error {
    // 注册登录限流器：每个 IP 每分钟最多 5 次尝试
    ratelimit.For("login", func(c *gin.Context) []ratelimit.Limit {
        return []ratelimit.Limit{
            ratelimit.PerMinute(5).By(c.ClientIP()),
        }
    })
    return nil
}
```

```go
// routes/api.go
// 在路由注册时通过中间件引用命名限流器

import (
    "github.com/gin-gonic/gin"
    httpmiddleware "github.com/prismgo/framework/http/middleware"
)

func RegisterRoutes(route *gin.RouterGroup) {
    route.POST("/auth/login", httpmiddleware.Throttle("login"), loginHandler)
}
```

### 独立程序或测试中显式创建

```go
manager, err := cache.NewManager(cache.Config{
    Default: "memory",
    Prefix:  "ratelimit_test",
    Stores: map[string]cache.StoreConfig{
        "memory": {Driver: "memory"},
    },
})
if err != nil {
    return err
}
defer manager.Close()

limiter := ratelimit.New(manager.Default())

// 注册为全局默认限流器
ratelimit.Use(limiter)
```

## 命名限流器

命名限流器是核心概念。通过 `For` 注册一个命名限流器，在中间件中通过名称引用。

### 注册命名限流器

```go
ratelimit.For("login", func(c *gin.Context) []ratelimit.Limit {
    return []ratelimit.Limit{
        ratelimit.PerMinute(5).By(c.ClientIP()),
    }
})
```

**参数说明**：
- `name`：限流器名称，用于在中间件中引用。命名应简短且语义明确，如 `login`、`api`、`sms`。
- `limiter`：类型为 `LimiterFunc`，接收 `*gin.Context`，返回 `[]Limit`（一组限流规则）。

### 读取已注册的命名限流器

```go
registered := ratelimit.Limiter("login")
```

返回值：如果名称存在，返回对应的 `LimiterFunc`；未注册返回 `nil`。中间件中遇到 `nil` 会直接放行。

### 多条规则同时生效

同一个命名限流器可以返回多条规则，每条规则独立计数和判断，任一命中即拦截：

```go
ratelimit.For("api", func(c *gin.Context) []ratelimit.Limit {
    userID := c.GetString("user_id")

    return []ratelimit.Limit{
        // 单用户每分钟最多 60 次
        ratelimit.PerMinute(60).By("user:" + userID),
        // 单 IP 每分钟最多 300 次
        ratelimit.PerMinute(300).By("ip:" + c.ClientIP()),
    }
})
```

## Limit 构造器

`Limit` 描述一次固定窗口限流规则。通过构造器创建，通过链式方法配置。

### Limit 结构体

```go
type Limit struct {
    MaxAttempts  int           // 窗口内允许的最大尝试次数
    Decay        time.Duration // 窗口长度
    Key          string        // 限流维度 key（通过 By 设置）
    Fallback     string        // 备用 key（通过 FallbackKey 设置）
    AfterFunc    AfterFunc     // 后置计数判断（通过 After 设置）
    ResponseFunc ResponseFunc  // 自定义超限响应（通过 Response 设置）
}
```

### 构造器列表

| 构造器 | 签名 | 说明 |
| --- | --- | --- |
| `Every` | `Every(decay time.Duration, maxAttempts int) Limit` | 自定义窗口长度和最大次数。`decay` 为窗口长度，`maxAttempts` 为窗口内最大允许次数 |
| `PerSecond` | `PerSecond(maxAttempts int) Limit` | 每秒最多 `maxAttempts` 次。内部等价于 `Every(time.Second, maxAttempts)` |
| `PerMinute` | `PerMinute(maxAttempts int) Limit` | 每分钟最多 `maxAttempts` 次。内部等价于 `Every(time.Minute, maxAttempts)` |
| `PerMinutes` | `PerMinutes(decayMinutes int, maxAttempts int) Limit` | 每 `decayMinutes` 分钟最多 `maxAttempts` 次。参数顺序与 Laravel `Limit::perMinutes` 保持一致 |
| `PerHour` | `PerHour(maxAttempts int) Limit` | 每小时最多 `maxAttempts` 次。内部等价于 `Every(time.Hour, maxAttempts)` |
| `PerDay` | `PerDay(maxAttempts int) Limit` | 每天最多 `maxAttempts` 次。内部等价于 `Every(24*time.Hour, maxAttempts)` |
| `None` | `None() Limit` | 不限制。常用于按条件关闭某个命名限流器，返回的 `MaxAttempts` 和 `Decay` 均为零值 |

### 构造器使用示例

```go
// 30 秒内最多 10 次
ratelimit.Every(30*time.Second, 10).By("sms:phone:13800138000")

// 每秒最多 2 次
ratelimit.PerSecond(2).By("webhook:tenant:1")

// 每 10 分钟最多 20 次
ratelimit.PerMinutes(10, 20).By("export:user:42")

// 每小时最多 100 次
ratelimit.PerHour(100).By("api:tenant:8")

// 每天最多 1000 次
ratelimit.PerDay(1000).By("report:tenant:8")
```

## Limit 链式方法

构造器返回的 `Limit` 通过链式方法进一步配置行为。

### By

`By` 设置限流维度 key。不同 key 独立计数，不会互相影响。

```go
ratelimit.PerMinute(5).By("login:ip:" + c.ClientIP())
ratelimit.PerHour(100).By("tenant:" + c.GetString("tenant_id"))
```

**参数说明**：
- `key`：限流维度的唯一标识字符串。应包含业务语义和隔离维度（如 IP、用户 ID、租户 ID）。

**返回值**：返回 `Limit` 自身，支持链式调用。

### FallbackKey

`FallbackKey` 为同一条规则设置备用 key。当同一个命名限流器内多条规则使用了相同的 key 时，`FallbackKey` 会在后续规则中替换重复 key，避免计数冲突。

```go
ratelimit.For("mixed", func(c *gin.Context) []ratelimit.Limit {
    return []ratelimit.Limit{
        ratelimit.PerMinute(10).By("same"),
        ratelimit.PerMinute(20).By("same").FallbackKey("same:fallback"),
    }
})
```

**参数说明**：
- `key`：备用 key 字符串。当主 key 在前面的规则中已被使用时，中间件会使用此值。

**返回值**：返回 `Limit` 自身，支持链式调用。

### After

`After` 设置后置计数判断逻辑。回调在业务 handler 执行完之后执行，只有回调返回 `true` 时才记录本次尝试。

适合只统计失败响应的场景：

```go
ratelimit.PerMinute(10).
    By("login:" + c.ClientIP()).
    After(func(c *gin.Context) bool {
        // 只在登录失败（返回 401）时计数
        return c.Writer.Status() == http.StatusUnauthorized
    })
```

**参数说明**：
- `fn`：类型为 `AfterFunc`，接收 `*gin.Context`，返回 `bool`。返回 `true` 时计入本次尝试。

**返回值**：返回 `Limit` 自身，支持链式调用。

**注意事项**：
- `After` 设置的规则在 handler 执行前不计入尝试次数，而是先计算剩余次数并写入响应头，等 handler 返回后再判断是否计数。
- 如果 `After` 未设置，规则默认在 handler 执行前就计入尝试次数。

### Response

`Response` 设置命中限流上限后的自定义响应。未设置时使用默认响应 `{"message":"too many requests"}`。

```go
ratelimit.PerMinute(5).
    By("sms:" + phone).
    Response(func(c *gin.Context, result ratelimit.Result) {
        c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
            "message":     "请求过于频繁，请稍后再试",
            "retry_after": result.RetryAfter,
        })
    })
```

**参数说明**：
- `fn`：类型为 `ResponseFunc`，接收 `*gin.Context` 和 `Result`。回调中应自行调用 `c.Abort` 或 `c.AbortWithStatusJSON` 等方法终止请求。

**返回值**：返回 `Limit` 自身，支持链式调用。

### Result 结构体

`Result` 在中间件和自定义响应中传递限流检查的运行时结果：

```go
type Result struct {
    Limit       Limit  // 触发本次结果的限流规则
    Key         string // 中间件生成的实际缓存 key
    MaxAttempts int    // 窗口内允许的最大次数
    Attempts    int64  // 当前窗口内已尝试次数
    Remaining   int    // 当前窗口剩余次数
    RetryAfter  int    // 超限后还需等待的秒数
    ResetAt     int64  // 恢复可用的 Unix 时间戳
}
```

## Gin 中间件

### 使用全局限流器

全局限流器在应用启动时已自动初始化，中间件直接引用命名限流器即可：

```go
import httpmiddleware "github.com/prismgo/framework/http/middleware"

route.Post("/auth/login", httpmiddleware.Throttle("login"), loginHandler)
```

### 使用显式限流器实例

测试或独立程序中需要隔离限流器时，使用 `ThrottleFor`：

```go
limiter := ratelimit.New(cache.Default())

router.POST("/auth/login", httpmiddleware.ThrottleFor(limiter, "login"), loginHandler)
```

### 中间件行为

中间件处理流程：

1. 通过名称查找命名限流器。如果未注册，直接 `c.Next()` 放行。
2. 执行命名限流器函数，获取 `[]Limit` 规则列表。
3. 遍历每条规则：
   - 跳过未启用的规则（`None()` 或 `MaxAttempts <= 0`）。
   - 计算实际的缓存 key（含命名空间前缀和可选的 SHA1 哈希）。
   - 检查是否已超限。如果超限：
     - 写入 `X-RateLimit-Limit`、`X-RateLimit-Remaining`、`Retry-After`、`X-RateLimit-Reset` 响应头。
     - 如果规则配置了 `Response`，执行自定义响应；否则返回默认 `429` 响应。
     - 中断请求。
   - 如果未超限，记录一次尝试（或根据 `After` 延迟记录）。
4. 所有规则通过后，写入成功响应头，执行后续 handler。

### 默认响应

超限时默认返回 HTTP `429 Too Many Requests`，响应体为：

```json
{"message":"too many requests"}
```

### 响应头

| Header | 说明 | 何时返回 |
| --- | --- | --- |
| `X-RateLimit-Limit` | 当前规则允许的最大次数 | 始终返回 |
| `X-RateLimit-Remaining` | 当前窗口剩余次数 | 始终返回 |
| `Retry-After` | 超限后还需等待的秒数 | 仅超限时返回 |
| `X-RateLimit-Reset` | 恢复可用的 Unix 时间戳 | 仅超限时返回 |

当一条命名限流器返回多条规则时，成功响应头中 `X-RateLimit-Limit` 和 `X-RateLimit-Remaining` 取所有规则中剩余次数最小的那条规则的值。

### 分组挂载

中间件可以挂载到路由分组上，批量保护一组路由：

```go
route.Prefix("/api/v1").
    Middleware(httpmiddleware.Throttle("api")).
    Group(func() {
        route.Get("/profile", profileHandler)
        route.Get("/orders", ordersHandler)
    })
```

## route 包兼容用法

`github.com/prismgo/framework/route` 保留旧的限流写法，内部委托到 `github.com/prismgo/framework/ratelimit`。新代码建议直接使用 `ratelimit.For` 和 `middleware.Throttle`，但已有代码可以继续使用 `route` 包的写法。

```go
route.RateLimiter("login", func(c *gin.Context) []route.Limit {
    return []route.Limit{
        route.PerMinute(5).By(func(c *gin.Context) string {
            return c.ClientIP()
        }),
    }
})

route.Post("/auth/login", route.Throttle("login"), loginHandler)
```

`route.Limit` 与 `ratelimit.Limit` 的差异：

| 特性 | `route.Limit` | `ratelimit.Limit` |
| --- | --- | --- |
| Key 设置 | `By(func(*gin.Context) string)` | `By(string)` |
| 窗口构造 | 仅 `PerMinute` | `Every` / `PerSecond` / `PerMinute` / `PerMinutes` / `PerHour` / `PerDay` |
| 后置计数 | 不支持 | `After` 支持 |
| 自定义响应 | 不支持 | `Response` 支持 |
| Fallback key | 不支持 | `FallbackKey` 支持 |

## 手动计数 API

除了通过 Gin 中间件自动限流外，也支持在业务代码中手动控制限流。适合不限流但需要记录尝试次数、或需要更精细控制计数时机的场景。

### 包级 facade

以下所有方法都有包级 facade 版本，自动使用全局默认限流器：

```go
ratelimit.Hit(ctx, key, decay)
ratelimit.TooManyAttempts(ctx, key, maxAttempts)
ratelimit.Attempts(ctx, key)
// ... 等等
```

如果使用显式限流器实例，调用对应的方法：

```go
limiter.Hit(ctx, key, decay)
limiter.TooManyAttempts(ctx, key, maxAttempts)
// ... 等等
```

### Hit

`Hit` 记录一次尝试，返回当前尝试次数。

```go
count, err := ratelimit.Hit(ctx, "login:ip:127.0.0.1", time.Minute)
if err != nil {
    return err
}
// count 为当前窗口内的累计尝试次数（含本次）
```

**参数说明**：
- `ctx`：上下文，用于传递请求链路信息。
- `key`：限流维度 key。建议使用 `CleanRateLimiterKey` 清理控制字符。
- `decay`：窗口长度。如果 `decay <= 0`，默认使用 1 分钟。

**返回值**：
- `int64`：当前窗口内的累计尝试次数。
- `error`：缓存操作失败时返回错误。

### Increment

`Increment` 按指定步长递增尝试次数。

```go
count, err := ratelimit.Increment(ctx, "export:user:42", time.Hour, 3)
```

**参数说明**：
- `ctx`：上下文。
- `key`：限流维度 key。
- `decay`：窗口长度。
- `amount`：递增步长，可选参数。未传时默认递增 1。

**返回值**：
- `int64`：递增后的累计尝试次数。
- `error`：缓存操作失败时返回错误。

### Decrement

`Decrement` 按指定步长递减尝试次数。

```go
count, err := ratelimit.Decrement(ctx, "export:user:42", 1)
```

**参数说明**：
- `ctx`：上下文。
- `key`：限流维度 key。
- `amount`：递减步长，可选参数。未传时默认递减 1。

**返回值**：
- `int64`：递减后的累计尝试次数。
- `error`：缓存操作失败时返回错误。

### Attempts

`Attempts` 返回当前 key 已尝试的次数。

```go
attempts, err := ratelimit.Attempts(ctx, "login:ip:127.0.0.1")
```

**参数说明**：
- `ctx`：上下文。
- `key`：限流维度 key。

**返回值**：
- `int64`：当前尝试次数。key 不存在时返回 `0`。
- `error`：缓存操作失败时返回错误。

### TooManyAttempts

`TooManyAttempts` 判断当前 key 是否已达到最大尝试次数上限。

```go
limited, err := ratelimit.TooManyAttempts(ctx, "login:ip:127.0.0.1", 5)
if err != nil {
    return err
}
if limited {
    return errors.New("too many attempts")
}
```

**参数说明**：
- `ctx`：上下文。
- `key`：限流维度 key。
- `maxAttempts`：最大允许尝试次数。如果 `maxAttempts <= 0`，直接返回 `false`（不限制）。

**返回值**：
- `bool`：`true` 表示已超限，`false` 表示未超限。
- `error`：缓存操作失败时返回错误。

**逻辑说明**：该方法会先读取当前尝试次数，如果次数未达上限则返回 `false`。如果次数已达上限，再检查 timer 是否存在。timer 存在说明窗口未过期，返回 `true`。timer 不存在说明窗口已过期，自动清理计数后返回 `false`。

### Remaining / RetriesLeft

`Remaining` 和 `RetriesLeft` 返回当前窗口剩余可用次数（两者语义相同，`RetriesLeft` 是 `Remaining` 的别名）。

```go
remaining, err := ratelimit.Remaining(ctx, "login:ip:127.0.0.1", 5)
retries, err := ratelimit.RetriesLeft(ctx, "login:ip:127.0.0.1", 5)
```

**参数说明**：
- `ctx`：上下文。
- `key`：限流维度 key。
- `maxAttempts`：最大允许次数。

**返回值**：
- `int`：剩余可用次数。最小值为 `0`。
- `error`：缓存操作失败时返回错误。

### AvailableIn

`AvailableIn` 返回当前 key 距离恢复可用还需要等待的秒数。

```go
retryAfter, err := ratelimit.AvailableIn(ctx, "login:ip:127.0.0.1")
```

**参数说明**：
- `ctx`：上下文。
- `key`：限流维度 key。

**返回值**：
- `int`：还需等待的秒数。如果截至当前时间已恢复可用，返回 `0`。
- `error`：缓存操作失败时返回错误。

### ResetAttempts

`ResetAttempts` 清理尝试次数，但保留 timer。适用于需要重置计数但保留窗口的场景。

```go
err := ratelimit.ResetAttempts(ctx, "login:ip:127.0.0.1")
```

**参数说明**：
- `ctx`：上下文。
- `key`：限流维度 key。

**返回值**：`error`，缓存操作失败时返回错误。

### Clear

`Clear` 同时清理尝试次数和 timer，使 key 立即恢复可用。

```go
err := ratelimit.Clear(ctx, "login:ip:127.0.0.1")
```

**参数说明**：
- `ctx`：上下文。
- `key`：限流维度 key。

**返回值**：`error`，缓存操作失败时返回错误。

**适用场景**：用户完成验证后手动清除限流、测试中重置限流状态、管理员手动解封。

### Attempt

`Attempt` 在未超限时执行回调，回调成功后才计数。回调返回错误时不会计数，适合把"检查是否超限、执行操作、成功后计数"合并到一个调用中。

```go
value, allowed, err := ratelimit.Attempt(ctx, "send:sms:13800138000", 3, time.Minute, func(ctx context.Context) (any, error) {
    return smsService.Send(ctx, "13800138000")
})
if err != nil {
    return err
}
if !allowed {
    return errors.New("too many attempts")
}
// value 是短信发送的返回结果
```

**参数说明**：
- `ctx`：上下文。
- `key`：限流维度 key。
- `maxAttempts`：最大允许尝试次数。
- `decay`：窗口长度。
- `callback`：类型为 `AttemptFunc`，接收 `context.Context`，返回 `(any, error)`。返回 `nil` 时回调未执行（已超限）。

**返回值**：
- `any`：回调的返回值。如果未执行回调，返回 `nil`。
- `bool`：`true` 表示回调已执行且成功，`false` 表示未执行回调（已超限或回调为 nil）。
- `error`：回调返回的错误，或缓存操作失败时的错误。

### CleanRateLimiterKey

`CleanRateLimiterKey` 去除 key 中的控制字符（ASCII 码小于 32 或等于 127 的字符），避免异常字符进入底层缓存。

```go
key := ratelimit.CleanRateLimiterKey(" login\nip\t127.0.0.1 ")
// key == "loginip127.0.0.1"
```

**参数说明**：
- `key`：原始 key 字符串。

**返回值**：
- `string`：清理后的 key 字符串。

## 哈希 key

`ShouldHashKeys(true)` 会让中间件生成的请求维度 key 使用 SHA1 哈希，适合隐藏邮箱、手机号、token 等敏感信息。

```go
ratelimit.ShouldHashKeys(true)
```

**参数说明**：
- `shouldHash`：`true` 时启用哈希，`false` 时关闭。

**注意事项**：
- 该设置只影响中间件通过 `MiddlewareKey` 生成的 key，不影响手动传给 `Hit`、`Increment`、`Attempt` 等方法的 key。
- 手动调用 API 时如需对 key 做哈希，需自行处理。

## Key 设计建议

限流 key 应包含业务语义和必要的隔离维度，格式建议：

```text
{业务}:{维度}:{值}
```

### 常见场景

| 场景 | Key 示例 | 说明 |
| --- | --- | --- |
| 登录防刷 | `login:ip:127.0.0.1` | 按 IP 限制 |
| 登录防刷（用户） | `login:user:42` | 按用户 ID 限制 |
| 短信验证码 | `sms:phone:13800138000` | 按手机号限制 |
| 导出操作 | `export:tenant:8:user:42` | 按租户和用户限制 |
| Webhook | `webhook:tenant:8:ip:127.0.0.1` | 按租户和 IP 限制 |
| API 调用 | `api:tenant:8:user:42` | 按租户和用户限制 |

### 设计原则

- **多租户隔离**：多租户接口必须在 key 中包含 `tenant_id`，避免不同租户之间互相影响。
- **维度明确**：key 应清楚表达限流维度，例如 `By("user:" + userID)` 比 `By(userID)` 更清晰。
- **避免碰撞**：不同业务场景使用不同的业务前缀，防止不同业务的 key 碰撞。
- **可读性**：key 应便于排查和调试，使用 `:` 分隔各段。

## 工作机制

每个限流 key 在缓存中对应两个条目：

| 缓存 key | 用途 | 说明 |
| --- | --- | --- |
| `{key}` | 当前窗口内的尝试次数 | 使用 cache counter 语义存储，通过 `Increment` 写入 |
| `{key}:timer` | 当前窗口恢复可用的 Unix 时间戳 | 用于判断窗口是否过期 |

### 判断流程

1. 读取 `{key}` 的当前尝试次数。
2. 如果次数未达到上限，允许通过并 `Increment` 计数。
3. 如果次数达到上限，检查 `{key}:timer` 是否存在：
   - timer 存在 → 窗口未过期，拒绝请求。
   - timer 不存在 → 窗口已过期，自动清理计数，允许通过。

### 中间件 key 格式

中间件生成的完整缓存 key 格式为：

```text
ratelimit:{name}:{dimension_key}
```

如果启用了 `ShouldHashKeys(true)`，`dimension_key` 部分会替换为 SHA1 哈希值。手动 API 的 key 格式由调用方自行决定。

## 错误处理

所有涉及缓存读写的方法都会返回 `error`。常见错误来源：

| 错误来源 | 说明 |
| --- | --- |
| 缓存 store 配置错误 | store 未注册或配置不完整 |
| Redis 连接失败 | Redis 不可达或认证失败 |
| 计数器类型错误 | 计数 key 已被外部写入非整数值 |

### 推荐处理方式

```go
limited, err := ratelimit.TooManyAttempts(ctx, key, 5)
if err != nil {
    // 缓存异常时，根据业务需求决定是放行还是拒绝
    // 建议记录错误日志并根据安全策略决定
    return err
}
if limited {
    retryAfter, _ := ratelimit.AvailableIn(ctx, key)
    return fmt.Errorf("too many attempts, retry after %d seconds", retryAfter)
}
```

## 与 Laravel 13 的边界

PrismGo 对齐 Laravel 13 Rate Limiting 的核心使用体验，但不是逐项复制：

- PrismGo 所有操作显式接收 `context.Context`，TTL 使用 `time.Duration`。
- PrismGo 的 `Attempt` 在回调失败时不会计数，与 Laravel 行为一致。
- PrismGo 的 `After` 逻辑与 Laravel `Limit::after` 语义对齐：handler 执行后判断是否计数。
- PrismGo 的 `Response` 与 Laravel `Limit::response` 对齐：自定义超限响应。
- PrismGo 的多规则命中策略与 Laravel 一致：任一规则命中即拦截。
- PrismGo 的响应头与 Laravel 对齐：`X-RateLimit-Limit`、`X-RateLimit-Remaining`、`Retry-After`、`X-RateLimit-Reset`。
- PrismGo 当前不支持 Laravel 的 `Limit::perSecond` 的 `$decay` 参数变体（`PerSecond` 固定为每秒）。
- PrismGo 当前不支持 Laravel 的 `RateLimiter::availableIn` 返回 `Carbon` 对象（PrismGo 返回秒数）。
