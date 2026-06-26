---
title: "Cache"
---

# Cache

- [简介](#简介)
- [配置](#配置)
  - [配置文件](#配置文件)
  - [驱动前置条件](#驱动前置条件)
  - [配置参数说明](#配置参数说明)
- [缓存操作](#缓存操作)
  - [获取缓存实例](#获取缓存实例)
  - [读取缓存](#读取缓存)
  - [写入缓存](#写入缓存)
  - [读穿缓存（Remember）](#读穿缓存remember)
  - [Stale-While-Revalidate（Flexible）](#stale-while-revalidateflexible)
  - [延长 TTL](#延长-ttl)
  - [批量读取](#批量读取)
  - [取后删除](#取后删除)
  - [删除与清空](#删除与清空)
  - [计数器](#计数器)
- [高级功能](#高级功能)
  - [Atomic Locks](#atomic-locks)
  - [Tagged Cache](#tagged-cache)
  - [Memoization](#memoization)
  - [Failover](#failover)
  - [自定义 Driver](#自定义-driver)
  - [资源生命周期](#资源生命周期)
- [Cache Events](#cache-events)
- [Deferred Context](#deferred-context)
- [Key 前缀](#key-前缀)
- [数据编码约定](#数据编码约定)
- [错误常量](#错误常量)
- [内置 Store 能力矩阵](#内置-store-能力矩阵)
- [与 Laravel Cache 的对应关系](#与-laravel-cache-的对应关系)

---

PrismGo 的缓存组件提供了一套统一、灵活的缓存操作体验，支持多种后端存储（Memory、Redis、File、Failover），并内置分布式锁、Tagged Cache、Stale-While-Revalidate 等高级能力。

---

## 简介

缓存系统以 `Manager` 管理多个缓存 store，每个 store 通过 `Repository` 暴露读写操作。业务代码可以直接使用包级泛型 facade（如 `cache.Get[T]`、`cache.Remember`），也可以通过 `cache.Store("redis")` 获取指定 store 的 `Repository` 实例。

所有操作都显式接收 `context.Context`，TTL 使用 `time.Duration`，返回值携带 `error`。

## 配置

### 配置文件

缓存的配置集中注册在 `config/cache.go`。你可以使用环境变量覆盖各项参数：

```go
// config/cache.go
func init() {
	config.Add("cache", func() map[string]interface{} {
		return map[string]interface{}{
			"default":  config.Env("CACHE_STORE", "memory"),
			"encoding": config.Env("CACHE_ENCODING", ""),
			"prefix":   config.Env("CACHE_PREFIX", "workorder_cache"),
			"stores": map[string]interface{}{
				"memory": map[string]interface{}{
					"driver":           "memory",
					"prefix":           config.Env("CACHE_MEMORY_PREFIX", "memory"),
					"default_ttl":      config.Env("CACHE_MEMORY_TTL", 0),
					"cleanup_interval": config.Env("CACHE_MEMORY_CLEANUP_INTERVAL", 60),
					"events":           config.Env("CACHE_MEMORY_EVENTS", true),
				},
				"redis": map[string]interface{}{
					"driver":     "redis",
					"prefix":     config.Env("CACHE_REDIS_PREFIX", "redis"),
					"connection": config.Env("CACHE_REDIS_CONNECTION", "cache"),
					"events":     config.Env("CACHE_REDIS_EVENTS", true),
				},
				"file": map[string]interface{}{
					"driver":      "file",
					"prefix":      config.Env("CACHE_FILE_PREFIX", "file"),
					"path":        config.Env("CACHE_FILE_PATH", "storage/framework/cache/data"),
					"lock_path":   config.Env("CACHE_FILE_LOCK_PATH", "storage/framework/cache/locks"),
					"default_ttl": config.Env("CACHE_FILE_TTL", 0),
					"events":      config.Env("CACHE_FILE_EVENTS", true),
				},
				"failover": map[string]interface{}{
					"driver": "failover",
					"stores": config.Env("CACHE_FAILOVER_STORES", "redis,memory"),
					"events": config.Env("CACHE_FAILOVER_EVENTS", true),
				},
			},
			"lock": map[string]interface{}{
				"prefix":         config.Env("CACHE_LOCK_PREFIX", "locks"),
				"retry_sleep_ms": config.Env("CACHE_LOCK_RETRY_SLEEP_MS", 50),
			},
			"flexible": map[string]interface{}{
				"refresh_timeout": config.Env("CACHE_FLEXIBLE_REFRESH_TIMEOUT", 30),
			},
		}
	})
}
```

### 驱动前置条件

#### Memory

无需额外依赖，适合本地开发、单进程测试场景。数据存储在进程内 map 中，重启后丢失。

#### Redis

需要 `github.com/prismgo/framework/redis` 包已注册连接池。在配置中通过 `connection` 字段指定使用的命名连接名，例如 `"cache"`。连接池配置在 `config/redis.go` 中管理。

#### File

无需额外依赖，数据以文件形式存储在本地磁盘。默认目录为 `storage/framework/cache/data`，锁文件目录为 `storage/framework/cache/locks`。确保应用进程对该目录有读写权限。

#### Failover

无需额外依赖，按配置顺序尝试多个子 store。缓存未命中（key 不存在）属于正常结果，不会触发 failover；只有底层 store 操作返回错误时，才会切换到后备 store，并派发 `cache.failed_over` 事件。

### 配置参数说明

#### 顶层配置

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cache.default` | `CACHE_STORE` | `"memory"` | 默认使用的 store 名称 |
| `cache.encoding` | `CACHE_ENCODING` | `""`（继承 `encoding.default`） | Payload 编码方式，支持 `msgpack` 或 `json` |
| `cache.prefix` | `CACHE_PREFIX` | `"workorder_cache"` | 所有缓存 key 的全局前缀 |

#### Memory Store

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cache.stores.memory.driver` | — | `"memory"` | 驱动类型 |
| `cache.stores.memory.prefix` | `CACHE_MEMORY_PREFIX` | `"memory"` | 该 store 的 key 前缀，拼接在全局前缀之后 |
| `cache.stores.memory.default_ttl` | `CACHE_MEMORY_TTL` | `0`（不过期） | 写入缓存时的默认 TTL（秒） |
| `cache.stores.memory.cleanup_interval` | `CACHE_MEMORY_CLEANUP_INTERVAL` | `60` | 定期清理过期 key 的间隔（秒） |
| `cache.stores.memory.events` | `CACHE_MEMORY_EVENTS` | `true` | 是否派发 cache 生命周期事件 |

#### Redis Store

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cache.stores.redis.driver` | — | `"redis"` | 驱动类型 |
| `cache.stores.redis.prefix` | `CACHE_REDIS_PREFIX` | `"redis"` | 该 store 的 key 前缀 |
| `cache.stores.redis.connection` | `CACHE_REDIS_CONNECTION` | `"cache"` | 使用的 Redis 连接池名称 |
| `cache.stores.redis.events` | `CACHE_REDIS_EVENTS` | `true` | 是否派发 cache 生命周期事件 |

#### File Store

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cache.stores.file.driver` | — | `"file"` | 驱动类型 |
| `cache.stores.file.prefix` | `CACHE_FILE_PREFIX` | `"file"` | 该 store 的 key 前缀 |
| `cache.stores.file.path` | `CACHE_FILE_PATH` | `"storage/framework/cache/data"` | 缓存数据文件根目录 |
| `cache.stores.file.lock_path` | `CACHE_FILE_LOCK_PATH` | `"storage/framework/cache/locks"` | 缓存锁文件根目录 |
| `cache.stores.file.default_ttl` | `CACHE_FILE_TTL` | `0`（不过期） | 写入缓存时的默认 TTL（秒） |
| `cache.stores.file.events` | `CACHE_FILE_EVENTS` | `true` | 是否派发 cache 生命周期事件 |

#### Failover Store

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cache.stores.failover.driver` | — | `"failover"` | 驱动类型 |
| `cache.stores.failover.stores` | `CACHE_FAILOVER_STORES` | `"redis,memory"` | 按优先级排列的子 store 名称，逗号分隔 |
| `cache.stores.failover.events` | `CACHE_FAILOVER_EVENTS` | `true` | 是否派发 cache 生命周期事件 |

#### 锁配置

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cache.lock.prefix` | `CACHE_LOCK_PREFIX` | `"locks"` | 锁 key 的二级前缀 |
| `cache.lock.retry_sleep_ms` | `CACHE_LOCK_RETRY_SLEEP_MS` | `50` | `Block` 等待锁时两次重试之间的间隔（毫秒） |

#### 热点刷新配置

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cache.flexible.refresh_timeout` | `CACHE_FLEXIBLE_REFRESH_TIMEOUT` | `30` | stale 期异步刷新 loader 的最大执行时间（秒） |

## 缓存操作

### 获取缓存实例

#### 使用包级 Facade

业务代码中最常用的方式：

```go
// 写入默认 store
if err := cache.Put(ctx, "site.name", "PrismGo", 10*time.Minute); err != nil {
	return err
}

// 从默认 store 读取
name, err := cache.Get[string](ctx, "site.name", cache.Value("默认名称"))
```

#### 使用指定 Store

```go
// 写入指定 store
if err := cache.PutFrom(ctx, "redis", "site.name", "PrismGo", 10*time.Minute); err != nil {
	return err
}

// 从指定 store 读取
token, err := cache.GetFrom[string](ctx, "redis", "wechat:access_token", cache.Value(""))
```

#### 获取 Repository 实例

需要把缓存仓库作为依赖传给业务服务时，优先依赖契约接口：

```go
import cachecontract "github.com/prismgo/framework/contracts/cache"

type TenantCacheService struct {
	repo cachecontract.Repository
}

func NewTenantCacheService(repo cachecontract.Repository) *TenantCacheService {
	if repo == nil {
		repo = cache.Default()
	}
	return &TenantCacheService{repo: repo}
}
```

获取指定 store 的 `Repository`：

```go
redisCache := cache.Store("redis")
if err := redisCache.Put(ctx, "bar", "baz", 10*time.Minute); err != nil {
	return err
}
```

> **注意**：访问未配置的 store 名称不会回退到默认 store，后续操作会返回 `cache.ErrStoreNotFound`。

### 读取缓存

#### 基础读取

`Get[T]` 读取并解码到目标类型。未命中且没有 fallback 时返回 `cache.ErrCacheMiss`：

```go
name, err := cache.Get[string](ctx, "site.name")
switch {
case errors.Is(err, cache.ErrCacheMiss):
	name = "PrismGo"
case err != nil:
	return err
}
```

#### 带默认值读取

提供固定默认值：

```go
count, err := cache.Get[int](ctx, "users.count", cache.Value(0))
```

提供延迟加载的默认值（仅在未命中时执行）：

```go
users, err := cache.Get[[]User](ctx, "users.list", cache.Lazy(func(ctx context.Context) ([]User, error) {
	return userRepo.List(ctx)
}))
```

> `cache.Value` 和 `cache.Lazy` 仅作为返回值，不会写入缓存。需要未命中后写入时使用 `Remember`。

#### 便捷类型读取

针对常用类型，可以直接使用非泛型方法：

```go
name, err := cache.String(ctx, "site.name", cache.Value("默认"))
count, err := cache.Integer(ctx, "users.count", cache.Value(0))
ratio, err := cache.Float(ctx, "conversion.ratio", cache.Value(0.0))
active, err := cache.Boolean(ctx, "feature.enabled", cache.Value(false))
```

对应的 `*From` 变体支持指定 store：

```go
name, err := cache.StringFrom(ctx, "redis", "site.name", cache.Value("默认"))
```

#### 判断存在性

```go
ok, err := cache.Has(ctx, "site.name")
missing, err := cache.Missing(ctx, "site.name")
```

### 写入缓存

#### 基础写入

```go
if err := cache.Put(ctx, "site.name", "PrismGo", 10*time.Minute); err != nil {
	return err
}
```

> `cache.Set` 是 `Put` 的别名。

#### 永久写入

```go
if err := cache.Forever(ctx, "permissions:catalog", permissions); err != nil {
	return err
}
```

#### 条件写入（仅当 key 不存在）

`Add` 在 key 不存在时写入，并返回 `true`；key 已存在时返回 `false`，依赖底层 store 保证原子性：

```go
ok, err := cache.Add(ctx, "sms:lock:13800138000", 1, time.Minute)
if err != nil {
	return err
}
if !ok {
	return errors.New("一分钟内不要重复发送验证码")
}
```

#### 批量写入

```go
err := cache.PutMany(ctx, map[string]int{"a": 1, "b": 2}, time.Minute)
```

> `cache.SetMultiple` 是 `PutMany` 的别名。

### 读穿缓存（Remember）

`Remember` 是缓存系统最常用的模式：命中时直接返回缓存值，未命中时执行 loader 函数并将结果写入缓存：

```go
posts, err := cache.Remember(ctx, "posts:index:page:1", 5*time.Minute, func(ctx context.Context) ([]Post, error) {
	return postRepo.PublishedLatest(ctx, 20)
})
```

#### 永久读穿

```go
permissions, err := cache.RememberForever(ctx, "permissions:catalog", func(ctx context.Context) ([]Permission, error) {
	return permissionRepo.All(ctx)
})
```

> `cache.Sear` 是 `RememberForever` 的 Laravel 风格别名。

### Stale-While-Revalidate（Flexible）

`Flexible` 将缓存生命周期分为 `fresh` 和 `stale` 两段窗口，适合热点数据场景：

| 窗口 | 行为 |
| --- | --- |
| `Fresh` | 直接返回缓存值，不触发刷新 |
| `Stale` | 先返回旧值，再异步刷新缓存 |
| 超过 `Stale` | 同步执行 loader，调用方等待重算 |

```go
stats, err := cache.Flexible(ctx, "dashboard:stats", cache.FlexibleWindow{
	Fresh: 30 * time.Second,
	Stale: 2 * time.Minute,
}, func(ctx context.Context) (DashboardStats, error) {
	return statService.Build(ctx)
})
```

**HTTP 服务中的使用**：应挂载 deferred middleware，让 stale 刷新在响应写出后执行：

```go
engine.Use(middleware.Deferred())
```

**非 HTTP 场景**：可手动挂载 deferred 队列：

```go
ctx, runDeferred := cache.WithDeferred(context.Background())
defer runDeferred()
```

没有 deferred context 时，stale 刷新会退化为后台 goroutine。

### 延长 TTL

`Touch` 只更新已有 key 的过期时间，不重新读取或写回 value：

```go
ok, err := cache.Touch(ctx, "user:1001:session", time.Hour)
```

传入 `ttl <= 0` 时，Memory/File 会改为不过期；Redis 使用 `PERSIST` 语义。

### 批量读取

```go
values, err := cache.Many[int](ctx, []string{"a", "b", "missing"}, cache.Value(0))
```

未命中的 key 会使用提供的 fallback 值。`cache.GetMultiple` 是 `Many` 的别名。

### 取后删除

`Pull` 读取缓存值后立即删除，适合一次性凭证场景：

```go
ticket, err := cache.Pull[string](ctx, "miniapp:ticket:"+ticketID)
if errors.Is(err, cache.ErrCacheMiss) {
	return errors.New("ticket 已失效")
}
```

### 删除与清空

#### 删除单个 key

```go
if err := cache.Forget(ctx, "posts:index:page:1"); err != nil {
	return err
}
```

> `cache.Delete` 是 `Forget` 的别名。

#### 批量删除

```go
if err := cache.ForgetMany(ctx, []string{"a", "b"}); err != nil {
	return err
}
```

#### 清空整个 store

```go
if err := cache.Flush(ctx); err != nil {
	return err
}
```

> `cache.Clear` 是 `Flush` 的别名。`Flush` 清空当前 Repository 前缀下的数据。Redis store 在前缀为空时会清空当前 Redis DB，业务代码不应在共享 DB 中使用空前缀。

### 计数器

`Increment` 和 `Decrement` 提供原子整数计数能力：

```go
views, err := cache.Increment(ctx, "page:1001:views")
views, err = cache.Increment(ctx, "page:1001:views", 5)
views, err = cache.Decrement(ctx, "page:1001:views")
```

已有值不是整数时返回 `cache.ErrInvalidCounter`。写入初始值可以用 `Put(ctx, key, 1)` 或 `Put(ctx, key, "1")`；浮点数 `1.5` 或 `"1.5"` 不能作为计数器初始值。

## 高级功能

### Atomic Locks

分布式锁提供带 TTL 的互斥机制。Memory store 是进程内锁；Redis/File store 是跨进程锁。

#### 基础用法

```go
lock := cache.Lock("order:submit:42", 10*time.Second)

ok, err := lock.Get(ctx)
if err != nil {
	return err
}
if !ok {
	return errors.New("订单正在提交，请稍后再试")
}
defer lock.Release(context.Background())

return orderService.Submit(ctx, 42)
```

#### 回调自动释放

```go
ok, err := cache.Lock("order:submit:42", 10*time.Second).Get(ctx, func(ctx context.Context) error {
	return orderService.Submit(ctx, 42)
})
```

#### 阻塞等待

在指定时间内轮询等待锁：

```go
ok, err := cache.Lock("order:submit:42", 10*time.Second).Block(ctx, 2*time.Second, func(ctx context.Context) error {
	return orderService.Submit(ctx, 42)
})
if errors.Is(err, cache.ErrLockTimeout) {
	return errors.New("系统繁忙，请稍后再试")
}
```

自定义 Block 等待节奏：

```go
lock := cache.Lock("order:submit:42", 10*time.Second)
lock.BetweenBlockedAttemptsSleepFor(100 * time.Millisecond)

ok, err := lock.Block(ctx, 2*time.Second, func(ctx context.Context) error {
	return orderService.Submit(ctx, 42)
})
```

#### 跨流程释放

锁的 owner token 可以在不同流程间传递：

```go
lock := cache.Lock("report:build", 30*time.Second)
ok, err := lock.Get(ctx)
if err != nil || !ok {
	return err
}

owner := lock.Owner()
// 将 owner 传递给其他流程...

// 在其他流程中恢复锁并释放
if err := cache.RestoreLock("report:build", owner).Release(ctx); err != nil {
	return err
}
```

> `Release` 会校验 owner token，防止误删；`ForceRelease` 会跳过 owner 校验直接释放。

#### 批量清理锁

```go
if err := cache.FlushLocks(ctx); err != nil {
	return err
}
```

`FlushLocks` 只清理锁命名空间，不删除普通缓存数据。

#### 并发限制器（Funnel）

`Funnel` 基于原子锁实现并发通道控制：

```go
ok, err := cache.Funnel("report:export").
	Limit(2).
	ExpireAfter(30 * time.Second).
	BlockFor(2 * time.Second).
	Then(ctx,
		func(ctx context.Context) error {
			return reportService.Export(ctx)
		},
		func(ctx context.Context) error {
			// 可选：拿不到 slot 时执行
			return nil
		},
	)
```

| 方法 | 默认值 | 说明 |
| --- | --- | --- |
| `Limit(n)` | `1` | 最大并发数 |
| `ExpireAfter(ttl)` | `1s` | 单个 slot 锁的最长持有时间 |
| `BlockFor(wait)` | 不等待 | 拿不到 slot 时的最长等待时间 |
| `SleepFor(sleep)` | `50ms` | 等待时两次尝试之间的休眠时间 |

#### 防止任务重叠（WithoutOverlapping）

基于锁的快捷入口，适合防止同名任务重叠执行：

```go
ok, err := cache.WithoutOverlapping(ctx, "sync:tenant:1", func(ctx context.Context) error {
	return syncTenant(ctx, 1)
})
```

通过选项函数自定义行为：

```go
ok, err := cache.WithoutOverlapping(
	ctx,
	"sync:tenant:1",
	func(ctx context.Context) error {
		return syncTenant(ctx, 1)
	},
	cache.WithOverlapWait(5*time.Second),
	cache.WithOverlapLock(15*time.Second),
	cache.WithOverlapSleep(100*time.Millisecond),
)
```

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `WithOverlapWait` | `10s` | 等待获取锁的最长时间 |
| `WithOverlapLock` | `10s` | 锁的过期时间 |
| `WithOverlapSleep` | `50ms` | 等待锁时两次尝试之间的间隔 |

### Tagged Cache

Tags 允许你按业务标签批量失效一组缓存项。内置 `memory` 和 `redis` 支持 tags，`file` 不支持 tags。

```go
tenantCache := cache.Tags("tenant:1", "settings")

if err := tenantCache.Put(ctx, "theme", "dark", time.Hour); err != nil {
	return err
}

// 读取
value, err := tenantCache.Get(ctx, "theme")

// 批量清理该标签下的所有缓存
if err := tenantCache.Flush(ctx); err != nil {
	return err
}
```

标签会被规范化（去重、排序、trim），数据 key 使用 SHA1(tagSetHash) 生成稳定路径。Redis 使用 Sorted Set 管理标签索引，支持过期清理。

> `cache.TagsFrom(storeName, tags...)` 支持基于指定 store 创建 tagged cache。

### Memoization

`Memo` 提供单次请求或任务内的记忆化能力。读取结果缓存在 `MemoRepository` 实例的内存 map 中，包括 miss 标记。写入、删除、计数和清空操作会同步清理本地 memo，避免读到旧值：

```go
memo := cache.Memo()

// 第一次读取：未命中，执行 loader
profile, err := memo.Get(ctx, "user:1001:profile", cache.Lazy(func(ctx context.Context) (*Profile, error) {
	return userRepo.Profile(ctx, 1001)
}))

// 同一实例内再次读取：直接返回内存缓存
profile2, err := memo.Get(ctx, "user:1001:profile")
```

> `cache.MemoFrom(storeName)` 支持基于指定 store 创建记忆化缓存。

### Failover

`failover` store 按配置顺序尝试子 store。只有底层 store 操作错误会切换到后备 store；缓存未命中不会触发 failover。

**配置示例**：

```env
CACHE_STORE=failover
CACHE_FAILOVER_STORES=redis,memory
```

**代码配置**：

```go
manager, err := cache.NewManager(cache.Config{
	Default: "failover",
	Stores: map[string]cache.StoreConfig{
		"failover": {Driver: "failover", Stores: []string{"redis", "memory"}},
		"redis":    {Driver: "redis", Redis: cache.RedisConfig{Connection: "cache"}},
		"memory":   {Driver: "memory"},
	},
})
```

每次切换后备 store 时会派发 `cache.failed_over` 事件，适合用于监控告警。

### 自定义 Driver

自定义 driver 对齐 Laravel `Cache::extend` 的思路：先注册 driver 工厂，再在 `cache.stores.*.driver` 中使用该 driver 名称。注册必须发生在 cache manager 第一次解析 store 之前。

**注册 driver**：

```go
cache.Extend("tenant-memory", func(ctx cache.StoreFactoryContext) (cache.StoreDriver, error) {
	store := newTenantMemoryStore(ctx.Config.Options)
	return cache.NewStoreDriver(store), nil
})
```

**在 `config/cache.go` 中添加配置**：

```go
"tenant": map[string]interface{}{
	"driver": "tenant-memory",
	"prefix": "tenant:1001",
	"options": map[string]any{
		"default_ttl": 300,
	},
},
```

然后在业务代码中通过 `cache.Store("tenant")` 或 facade 方法使用该 store。

如果需要在独立程序或测试中显式创建 Manager：

```go
manager, err := cache.NewManager(cache.Config{
	Default: "tenant",
	Stores: map[string]cache.StoreConfig{
		"tenant": {
			Driver: "tenant-memory",
			Prefix: "tenant:1001",
			Options: map[string]any{
				"default_ttl": 300,
			},
		},
	},
})
```

**StoreFactoryContext 字段说明**：

| 字段 | 说明 |
| --- | --- |
| `Name` | 当前 store 的配置名称，例如 `"tenant"` |
| `Driver` | 标准化后的 driver 名称，例如 `"tenant-memory"` |
| `Config` | 当前 store 的完整配置副本，包含 `Options` 扩展参数 |
| `GlobalPrefix` | 全局 key 前缀（`Config.Prefix` 解析后） |
| `StorePrefix` | 当前 store 的 key 前缀（`StoreConfig.Prefix` 解析后） |
| `Prefix` | 最终写入缓存 key 时使用的完整前缀 |
| `LockPrefix` | 最终写入锁 key 时使用的完整前缀 |

**StoreDriver 结构**：

自定义 driver 必须返回 `StoreDriver`，其中 `Store` 字段是必需的，其余扩展能力为可选：

| 字段 | 对应能力 | 说明 |
| --- | --- | --- |
| `Store` | 必需 | 必须实现 `gocache` 的 `StoreInterface` |
| `Touch` | `Touch` | 支持延长已有 key 的 TTL |
| `Atomic` | `Add` / `Increment` / `Decrement` / `Pull` | 支持原子操作 |
| `Bulk` | `Many` / `PutMany` / `ForgetMany` | 支持批量操作 |
| `Flush` | `Flush` | 支持按 Repository 前缀清理缓存 |
| `Tags` | `Tags` | 支持 tagged cache |
| `Lock` | `Lock` / `RestoreLock` / `Funnel` | 支持分布式锁 |
| `LockFlush` | `FlushLocks` | 支持批量清理锁 key |
| `Close` | `Manager.Close` | 支持释放外部资源 |

Manager 会自动检查 `Store` 本身是否实现了上述扩展接口。如果扩展能力不在 store 本身上，可以显式提供：

```go
cache.Extend("custom", func(ctx cache.StoreFactoryContext) (cache.StoreDriver, error) {
	store := newCustomStore(ctx.Config.Options)
	return cache.StoreDriver{
		Store: store,
		Lock:  newCustomLockProvider(store),
		Close: store,
	}, nil
})
```

### 资源生命周期

`cache.ServiceProvider` 在注册时已通过 `container.WithCloser` 绑定了关闭回调。应用正常退出时，框架会调用 `Manager.Close()` 释放所有已构建 store 持有的外部资源（如 Redis 连接），开发者无需手动处理。

**独立程序或测试**中显式创建 Manager 时，应确保关闭时释放资源：

```go
manager, err := cache.NewManager(cache.Config{
	Default: "memory",
	Prefix:  "test_cache",
	Stores:  map[string]cache.StoreConfig{
		"memory": {Driver: "memory"},
	},
})
if err != nil {
	return err
}
defer manager.Close()
```

或者通过 bootstrap 注册关闭选项，由 Application 统一管理生命周期：

```go
app.Instance("cache.manager", manager, cache.ManagerCloseOption())
```

## Cache Events

开启 `cache.stores.*.events` 后，Repository 会派发缓存生命周期事件。事件通过 `github.com/prismgo/framework/event` 总线分发，适合用于审计、指标收集和排障。

事件接收器通过 `cache.UseEventSink` 设置：

```go
cache.UseEventSink(func(ctx context.Context, event cache.CacheEvent) {
	log.Printf("[%s] store=%s key=%s", event.Name(), event.Store, event.Key)
})
```

传入 `nil` 可以关闭事件转发。

### 事件列表

| 事件常量 | 事件名 | 触发时机 |
| --- | --- | --- |
| `EventCacheRetrieving` | `cache.retrieving` | 即将读取缓存 |
| `EventCacheHit` | `cache.hit` | 缓存命中 |
| `EventCacheMissed` | `cache.missed` | 缓存未命中 |
| `EventCacheWriting` | `cache.writing` | 即将写入缓存 |
| `EventCacheWritten` | `cache.written` | 写入成功 |
| `EventCacheWriteFailed` | `cache.write_failed` | 写入失败 |
| `EventCacheForgetting` | `cache.forgetting` | 即将删除缓存 |
| `EventCacheForgotten` | `cache.forgotten` | 删除成功 |
| `EventCacheForgetFailed` | `cache.forget_failed` | 删除失败 |
| `EventCacheFlushing` | `cache.flushing` | 即将清空缓存 |
| `EventCacheFlushed` | `cache.flushed` | 清空成功 |
| `EventCacheFlushFailed` | `cache.flush_failed` | 清空失败 |
| `EventCacheLocksFlushed` | `cache.locks_flushed` | 锁命名空间清理成功 |
| `EventCacheLockFlushFailed` | `cache.lock_flush_failed` | 锁命名空间清理失败 |
| `EventCacheFailedOver` | `cache.failed_over` | failover 切换后备 store |

`CacheEvent` 结构体字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Event` | `string` | 事件名 |
| `Store` | `string` | store 名称 |
| `Key` | `string` | 单个缓存 key |
| `Keys` | `[]string` | 批量操作的 key 列表 |
| `Tags` | `[]string` | 标签列表（tagged cache 操作） |
| `Error` | `error` | 操作错误 |
| `From` | `string` | failover 来源 store |
| `To` | `string` | failover 目标 store |

## Deferred Context

`WithDeferred` 给 context 挂载后置任务队列，让 stale 刷新等异步操作在响应写出后执行：

```go
ctx, runDeferred := cache.WithDeferred(context.Background())
defer runDeferred()
```

在 HTTP 中间件中使用时：

```go
engine.Use(middleware.Deferred())
```

## Key 前缀

最终写入缓存的 key 由多段前缀拼接而成，冒号分隔，空段省略：

**普通缓存 key**：

```text
{cache.prefix}:{store.prefix}:{key}
```

**锁 key**：

```text
{cache.prefix}:{store.prefix}:{cache.lock.prefix}:{name}
```

建议业务 key 使用稳定、可读的命名空间：

```text
tenant:1:permissions
workorder:1001:detail
wechat:corp:access_token
sms:lock:13800138000
```

## 数据编码约定

数值语义 value（int、uint、float、数值 string）会直写为十进制 ASCII bytes；其他 value 会按 Payload Encoding 编码为 `[]byte`，读取时再解码。默认编码为 `msgpack`；显式 `cache.encoding=json` 时使用 JSON，便于回滚和人工排障。

**建议**：

- 缓存 value 使用可序列化的结构体、slice、map、字符串、数字或 `[]byte`
- 结构体字段保留稳定的 `json` tag，避免编码切换或跨版本读取时字段名漂移
- 不要缓存 `context.Context`、数据库连接、事务、HTTP request、函数、channel 等运行时资源
- 修改缓存结构体字段时同步调整 key 版本，例如 `dashboard:stats:v2`

## 错误常量

| 错误常量 | 说明 |
| --- | --- |
| `cache.ErrCacheMiss` | key 不存在或已过期 |
| `cache.ErrStoreNotFound` | 指定 store 未配置或未注册 |
| `cache.ErrLockTimeout` | `Block` 等待锁超时 |
| `cache.ErrLockNotHeld` | 当前 lock 实例未持有可释放的锁 |
| `cache.ErrInvalidCounter` | 计数器已有值不是整数 |
| `cache.ErrTagsUnsupported` | 当前 store 不支持 tagged cache |

## 内置 Store 能力矩阵

| 能力 | memory | redis | file | failover |
| --- | --- | --- | --- | --- |
| Touch（延长 TTL） | 支持 | 支持 | 支持 | 支持（委托子 store） |
| Atomic（Add/Increment/Pull） | 支持 | 支持 | 支持 | 支持 |
| Bulk（GetMany/PutMany/ForgetMany） | 支持 | 支持 | 支持 | 支持 |
| PrefixFlush（按前缀清空） | 支持 | 支持 | 支持 | 支持（委托子 store） |
| Tags（标签缓存） | 支持 | 支持 | 不支持 | 支持（委托支持 tags 的子 store） |
| Lock（分布式锁） | 支持 | 支持 | 支持 | 支持（委托子 store） |
| LockFlush（批量清理锁） | 支持 | 支持 | 支持 | 支持（委托子 store） |
| Close（释放资源） | 支持 | 否（由 `github.com/prismgo/framework/redis` 管理） | 否 | 否 |

## 与 Laravel Cache 的对应关系

| Laravel 方法 | PrismGo 等价 |
| --- | --- |
| `Cache::get($key, $default)` | `cache.Get[T](ctx, key, cache.Value(default))` |
| `Cache::store('redis')` | `cache.Store("redis")` |
| `Cache::put($key, $value, $ttl)` | `cache.Put(ctx, key, value, ttl)` |
| `Cache::remember($key, $ttl, $callback)` | `cache.Remember(ctx, key, ttl, loader)` |
| `Cache::rememberForever($key, $callback)` | `cache.RememberForever(ctx, key, loader)` |
| `Cache::sear($key, $callback)` | `cache.Sear(ctx, key, loader)` |
| `Cache::flexible($key, $window, $callback)` | `cache.Flexible(ctx, key, window, loader)` |
| `Cache::increment($key)` | `cache.Increment(ctx, key)` |
| `Cache::decrement($key)` | `cache.Decrement(ctx, key)` |
| `Cache::add($key, $value, $ttl)` | `cache.Add(ctx, key, value, ttl)` |
| `Cache::pull($key)` | `cache.Pull[T](ctx, key)` |
| `Cache::forget($key)` | `cache.Forget(ctx, key)` |
| `Cache::flush()` | `cache.Flush(ctx)` |
| `Cache::lock($name, $ttl)` | `cache.Lock(name, ttl)` |
| `Cache::tags(...$tags)` | `cache.Tags(tags...)` |
| `Cache::memo()` | `cache.Memo()` |
| `Cache::extend($name, $factory)` | `cache.Extend(name, factory)` |
| `Cache::many($keys)` | `cache.Many[T](ctx, keys)` |
| `Cache::putMany($values, $ttl)` | `cache.PutMany(ctx, values, ttl)` |
