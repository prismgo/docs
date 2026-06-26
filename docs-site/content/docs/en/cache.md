---
title: "Cache"
---

# Cache

- [Introduction](#introduction)
- [Configuration](#configuration)
  - [Config File](#config-file)
  - [Driver Prerequisites](#driver-prerequisites)
  - [Configuration Parameters](#configuration-parameters)
- [Cache Usage](#cache-usage)
  - [Obtaining a Cache Instance](#obtaining-a-cache-instance)
  - [Retrieving Items](#retrieving-items)
  - [Storing Items](#storing-items)
  - [Retrieve and Store](#retrieve-and-store)
  - [Stale-While-Revalidate (Flexible)](#stale-while-revalidate-flexible)
  - [Touch TTL](#touch-ttl)
  - [Retrieving Multiple Items](#retrieving-multiple-items)
  - [Retrieve and Delete](#retrieve-and-delete)
  - [Removing and Clearing](#removing-and-clearing)
  - [Counters](#counters)
- [Advanced Features](#advanced-features)
  - [Atomic Locks](#atomic-locks)
  - [Tagged Cache](#tagged-cache)
  - [Memoization](#memoization)
  - [Failover](#failover)
  - [Custom Drivers](#custom-drivers)
  - [Resource Lifecycle](#resource-lifecycle)
- [Cache Events](#cache-events)
- [Deferred Context](#deferred-context)
- [Key Prefixes](#key-prefixes)
- [Data Encoding Conventions](#data-encoding-conventions)
- [Error Constants](#error-constants)
- [Built-in Store Capability Matrix](#built-in-store-capability-matrix)
- [Laravel Cache Mapping](#laravel-cache-mapping)

---

PrismGo's cache component provides a unified and flexible caching experience, supporting multiple backend stores (Memory, Redis, File, Failover), with built-in distributed locks, tagged cache, stale-while-revalidate, and other advanced capabilities.

---

## Introduction

The cache system uses a `Manager` to manage multiple cache stores, each exposing read/write operations through a `Repository`. Business code can directly use the package-level generic facade (e.g., `cache.Get[T]`, `cache.Remember`), or obtain a `Repository` instance for a specific store via `cache.Store("redis")`.

All operations explicitly accept `context.Context`, use `time.Duration` for TTLs, and return an `error`.

## Configuration

### Config File

Cache configuration is registered in `config/cache.go`. You can override any parameter via environment variables:

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

### Driver Prerequisites

#### Memory

No additional dependencies. Suitable for local development and single-process testing. Data is stored in an in-process map and lost on restart.

#### Redis

Requires the `github.com/prismgo/framework/redis` package to have registered a connection pool. Specify the named connection via the `connection` field, e.g., `"cache"`. Connection pool configuration is managed in `config/redis.go`.

#### File

No additional dependencies. Data is stored as files on local disk. Default directories are `storage/framework/cache/data` for cache data and `storage/framework/cache/locks` for lock files. Ensure the application process has read/write access to these directories.

#### Failover

No additional dependencies. Attempts child stores in configured order. A cache miss (key does not exist) is a normal result and does not trigger failover; only errors from the underlying store cause a switch to a fallback store, and a `cache.failed_over` event is dispatched.

### Configuration Parameters

#### Top-Level Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `cache.default` | `CACHE_STORE` | `"memory"` | Default store name |
| `cache.encoding` | `CACHE_ENCODING` | `""` (inherits `encoding.default`) | Payload encoding method: `msgpack` or `json` |
| `cache.prefix` | `CACHE_PREFIX` | `"workorder_cache"` | Global prefix for all cache keys |

#### Memory Store

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `cache.stores.memory.driver` | — | `"memory"` | Driver type |
| `cache.stores.memory.prefix` | `CACHE_MEMORY_PREFIX` | `"memory"` | Store-level key prefix, appended after the global prefix |
| `cache.stores.memory.default_ttl` | `CACHE_MEMORY_TTL` | `0` (no expiry) | Default TTL when writing (seconds) |
| `cache.stores.memory.cleanup_interval` | `CACHE_MEMORY_CLEANUP_INTERVAL` | `60` | Interval for cleaning up expired keys (seconds) |
| `cache.stores.memory.events` | `CACHE_MEMORY_EVENTS` | `true` | Whether to dispatch cache lifecycle events |

#### Redis Store

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `cache.stores.redis.driver` | — | `"redis"` | Driver type |
| `cache.stores.redis.prefix` | `CACHE_REDIS_PREFIX` | `"redis"` | Store-level key prefix |
| `cache.stores.redis.connection` | `CACHE_REDIS_CONNECTION` | `"cache"` | Redis connection pool name to use |
| `cache.stores.redis.events` | `CACHE_REDIS_EVENTS` | `true` | Whether to dispatch cache lifecycle events |

#### File Store

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `cache.stores.file.driver` | — | `"file"` | Driver type |
| `cache.stores.file.prefix` | `CACHE_FILE_PREFIX` | `"file"` | Store-level key prefix |
| `cache.stores.file.path` | `CACHE_FILE_PATH` | `"storage/framework/cache/data"` | Root directory for cache data files |
| `cache.stores.file.lock_path` | `CACHE_FILE_LOCK_PATH` | `"storage/framework/cache/locks"` | Root directory for cache lock files |
| `cache.stores.file.default_ttl` | `CACHE_FILE_TTL` | `0` (no expiry) | Default TTL when writing (seconds) |
| `cache.stores.file.events` | `CACHE_FILE_EVENTS` | `true` | Whether to dispatch cache lifecycle events |

#### Failover Store

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `cache.stores.failover.driver` | — | `"failover"` | Driver type |
| `cache.stores.failover.stores` | `CACHE_FAILOVER_STORES` | `"redis,memory"` | Child store names in priority order, comma-separated |
| `cache.stores.failover.events` | `CACHE_FAILOVER_EVENTS` | `true` | Whether to dispatch cache lifecycle events |

#### Lock Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `cache.lock.prefix` | `CACHE_LOCK_PREFIX` | `"locks"` | Secondary prefix for lock keys |
| `cache.lock.retry_sleep_ms` | `CACHE_LOCK_RETRY_SLEEP_MS` | `50` | Retry interval when `Block` is waiting for a lock (milliseconds) |

#### Hot Key Refresh Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `cache.flexible.refresh_timeout` | `CACHE_FLEXIBLE_REFRESH_TIMEOUT` | `30` | Maximum execution time for stale-phase async loader (seconds) |

## Cache Usage

### Obtaining a Cache Instance

#### Using the Package-Level Facade

The most common approach in business code:

```go
// Write to the default store
if err := cache.Put(ctx, "site.name", "PrismGo", 10*time.Minute); err != nil {
	return err
}

// Read from the default store
name, err := cache.Get[string](ctx, "site.name", cache.Value("Default Name"))
```

#### Using a Specific Store

```go
// Write to a specific store
if err := cache.PutFrom(ctx, "redis", "site.name", "PrismGo", 10*time.Minute); err != nil {
	return err
}

// Read from a specific store
token, err := cache.GetFrom[string](ctx, "redis", "wechat:access_token", cache.Value(""))
```

#### Obtaining a Repository Instance

When passing a cache repository as a dependency to a business service, prefer the contract interface:

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

Get a `Repository` for a specific store:

```go
redisCache := cache.Store("redis")
if err := redisCache.Put(ctx, "bar", "baz", 10*time.Minute); err != nil {
	return err
}
```

> **Note**: Accessing an unconfigured store name does not fall back to the default store. Subsequent operations will return `cache.ErrStoreNotFound`.

### Retrieving Items

#### Basic Retrieval

`Get[T]` reads and decodes to the target type. If the key is missing and no fallback is provided, it returns `cache.ErrCacheMiss`:

```go
name, err := cache.Get[string](ctx, "site.name")
switch {
case errors.Is(err, cache.ErrCacheMiss):
	name = "PrismGo"
case err != nil:
	return err
}
```

#### Retrieval with Default Value

Provide a fixed default value:

```go
count, err := cache.Get[int](ctx, "users.count", cache.Value(0))
```

Provide a lazy default value (executed only on a miss):

```go
users, err := cache.Get[[]User](ctx, "users.list", cache.Lazy(func(ctx context.Context) ([]User, error) {
	return userRepo.List(ctx)
}))
```

> `cache.Value` and `cache.Lazy` only serve as return values and do not write to the cache. Use `Remember` if you want to write the loaded value on a miss.

#### Typed Convenience Methods

For commonly used types, you can use non-generic methods directly:

```go
name, err := cache.String(ctx, "site.name", cache.Value("default"))
count, err := cache.Integer(ctx, "users.count", cache.Value(0))
ratio, err := cache.Float(ctx, "conversion.ratio", cache.Value(0.0))
active, err := cache.Boolean(ctx, "feature.enabled", cache.Value(false))
```

The `*From` variants support specifying a store:

```go
name, err := cache.StringFrom(ctx, "redis", "site.name", cache.Value("default"))
```

#### Checking Existence

```go
ok, err := cache.Has(ctx, "site.name")
missing, err := cache.Missing(ctx, "site.name")
```

### Storing Items

#### Basic Storage

```go
if err := cache.Put(ctx, "site.name", "PrismGo", 10*time.Minute); err != nil {
	return err
}
```

> `cache.Set` is an alias for `Put`.

#### Permanent Storage

```go
if err := cache.Forever(ctx, "permissions:catalog", permissions); err != nil {
	return err
}
```

#### Conditional Storage (Write Only If Key Does Not Exist)

`Add` writes only if the key does not exist, returning `true` on success and `false` if the key already exists. The atomicity depends on the underlying store:

```go
ok, err := cache.Add(ctx, "sms:lock:13800138000", 1, time.Minute)
if err != nil {
	return err
}
if !ok {
	return errors.New("Do not resend the verification code within one minute")
}
```

#### Bulk Storage

```go
err := cache.PutMany(ctx, map[string]int{"a": 1, "b": 2}, time.Minute)
```

> `cache.SetMultiple` is an alias for `PutMany`.

### Retrieve and Store

`Remember` is the most commonly used caching pattern: if the key exists, return the cached value; otherwise, execute the loader function and write the result to the cache:

```go
posts, err := cache.Remember(ctx, "posts:index:page:1", 5*time.Minute, func(ctx context.Context) ([]Post, error) {
	return postRepo.PublishedLatest(ctx, 20)
})
```

#### Remember Forever

```go
permissions, err := cache.RememberForever(ctx, "permissions:catalog", func(ctx context.Context) ([]Permission, error) {
	return permissionRepo.All(ctx)
})
```

> `cache.Sear` is the Laravel-style alias for `RememberForever`.

### Stale-While-Revalidate (Flexible)

`Flexible` divides the cache lifecycle into `fresh` and `stale` windows, suitable for hot data scenarios:

| Window | Behavior |
| --- | --- |
| `Fresh` | Return the cached value directly, no refresh triggered |
| `Stale` | Return the old value first, then refresh asynchronously |
| Beyond `Stale` | Execute the loader synchronously; the caller waits for recalculation |

```go
stats, err := cache.Flexible(ctx, "dashboard:stats", cache.FlexibleWindow{
	Fresh: 30 * time.Second,
	Stale: 2 * time.Minute,
}, func(ctx context.Context) (DashboardStats, error) {
	return statService.Build(ctx)
})
```

**In HTTP services**: Mount the deferred middleware so that stale refreshes execute after the response is written:

```go
engine.Use(middleware.Deferred())
```

**Non-HTTP scenarios**: Manually mount the deferred queue:

```go
ctx, runDeferred := cache.WithDeferred(context.Background())
defer runDeferred()
```

Without a deferred context, stale refresh degrades to a background goroutine.

### Touch TTL

`Touch` updates the expiry time of an existing key without re-reading or writing back the value:

```go
ok, err := cache.Touch(ctx, "user:1001:session", time.Hour)
```

When `ttl <= 0`, Memory/File stores set the key to never expire; Redis uses the `PERSIST` semantic.

### Retrieving Multiple Items

```go
values, err := cache.Many[int](ctx, []string{"a", "b", "missing"}, cache.Value(0))
```

Keys that miss will use the provided fallback value. `cache.GetMultiple` is an alias for `Many`.

### Retrieve and Delete

`Pull` reads a cache value and immediately deletes it, suitable for one-time credential scenarios:

```go
ticket, err := cache.Pull[string](ctx, "miniapp:ticket:"+ticketID)
if errors.Is(err, cache.ErrCacheMiss) {
	return errors.New("ticket has expired")
}
```

### Removing and Clearing

#### Removing a Single Key

```go
if err := cache.Forget(ctx, "posts:index:page:1"); err != nil {
	return err
}
```

> `cache.Delete` is an alias for `Forget`.

#### Bulk Removal

```go
if err := cache.ForgetMany(ctx, []string{"a", "b"}); err != nil {
	return err
}
```

#### Clearing an Entire Store

```go
if err := cache.Flush(ctx); err != nil {
	return err
}
```

> `cache.Clear` is an alias for `Flush`. `Flush` clears data under the current Repository prefix. For the Redis store, if the prefix is empty it will flush the entire Redis DB; business code should avoid using an empty prefix in a shared DB.

### Counters

`Increment` and `Decrement` provide atomic integer counting:

```go
views, err := cache.Increment(ctx, "page:1001:views")
views, err = cache.Increment(ctx, "page:1001:views", 5)
views, err = cache.Decrement(ctx, "page:1001:views")
```

If the existing value is not an integer, it returns `cache.ErrInvalidCounter`. Initialize a counter with `Put(ctx, key, 1)` or `Put(ctx, key, "1")`; floating-point values like `1.5` or `"1.5"` cannot be used as counter initial values.

## Advanced Features

### Atomic Locks

Distributed locks provide mutual exclusion with a TTL. The Memory store is an in-process lock; Redis/File stores are cross-process locks.

#### Basic Usage

```go
lock := cache.Lock("order:submit:42", 10*time.Second)

ok, err := lock.Get(ctx)
if err != nil {
	return err
}
if !ok {
	return errors.New("Order is being submitted, please try again later")
}
defer lock.Release(context.Background())

return orderService.Submit(ctx, 42)
```

#### Automatic Release via Callback

```go
ok, err := cache.Lock("order:submit:42", 10*time.Second).Get(ctx, func(ctx context.Context) error {
	return orderService.Submit(ctx, 42)
})
```

#### Blocking Wait

Poll and wait for the lock within a specified duration:

```go
ok, err := cache.Lock("order:submit:42", 10*time.Second).Block(ctx, 2*time.Second, func(ctx context.Context) error {
	return orderService.Submit(ctx, 42)
})
if errors.Is(err, cache.ErrLockTimeout) {
	return errors.New("System is busy, please try again later")
}
```

Customize the Block wait rhythm:

```go
lock := cache.Lock("order:submit:42", 10*time.Second)
lock.BetweenBlockedAttemptsSleepFor(100 * time.Millisecond)

ok, err := lock.Block(ctx, 2*time.Second, func(ctx context.Context) error {
	return orderService.Submit(ctx, 42)
})
```

#### Cross-Process Release

The lock's owner token can be passed between processes:

```go
lock := cache.Lock("report:build", 30*time.Second)
ok, err := lock.Get(ctx)
if err != nil || !ok {
	return err
}

owner := lock.Owner()
// Pass the owner to another process...

// In the other process, restore the lock and release
if err := cache.RestoreLock("report:build", owner).Release(ctx); err != nil {
	return err
}
```

> `Release` validates the owner token to prevent accidental deletion; `ForceRelease` skips the owner validation and releases directly.

#### Bulk Lock Cleanup

```go
if err := cache.FlushLocks(ctx); err != nil {
	return err
}
```

`FlushLocks` only cleans up the lock namespace, not regular cache data.

#### Concurrency Limiter (Funnel)

`Funnel` implements concurrency channel control based on atomic locks:

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
			// Optional: executed when slot cannot be acquired
			return nil
		},
	)
```

| Method | Default | Description |
| --- | --- | --- |
| `Limit(n)` | `1` | Maximum concurrency |
| `ExpireAfter(ttl)` | `1s` | Maximum hold time for a single slot lock |
| `BlockFor(wait)` | No wait | Maximum wait time when a slot cannot be acquired |
| `SleepFor(sleep)` | `50ms` | Sleep interval between attempts while waiting |

#### Preventing Task Overlap (WithoutOverlapping)

A lock-based shortcut for preventing overlapping execution of identically-named tasks:

```go
ok, err := cache.WithoutOverlapping(ctx, "sync:tenant:1", func(ctx context.Context) error {
	return syncTenant(ctx, 1)
})
```

Customize behavior via option functions:

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

| Option | Default | Description |
| --- | --- | --- |
| `WithOverlapWait` | `10s` | Maximum time to wait for acquiring the lock |
| `WithOverlapLock` | `10s` | Expiry time of the lock |
| `WithOverlapSleep` | `50ms` | Interval between attempts while waiting for the lock |

### Tagged Cache

Tags allow you to invalidate a group of cache items by a business label in bulk. The built-in `memory` and `redis` stores support tags; `file` does not.

```go
tenantCache := cache.Tags("tenant:1", "settings")

if err := tenantCache.Put(ctx, "theme", "dark", time.Hour); err != nil {
	return err
}

// Read
value, err := tenantCache.Get(ctx, "theme")

// Bulk flush all cache items under this tag
if err := tenantCache.Flush(ctx); err != nil {
	return err
}
```

Tags are normalized (deduplicated, sorted, trimmed), and data keys use SHA1(tagSetHash) to generate a stable path. Redis uses a Sorted Set to manage tag indices, supporting expired entry cleanup.

> `cache.TagsFrom(storeName, tags...)` supports creating a tagged cache based on a specific store.

### Memoization

`Memo` provides request-level or task-level memoization. Read results are cached in the `MemoRepository` instance's in-memory map, including miss markers. Write, delete, count, and flush operations synchronously clean the local memo to prevent stale reads:

```go
memo := cache.Memo()

// First read: miss, execute the loader
profile, err := memo.Get(ctx, "user:1001:profile", cache.Lazy(func(ctx context.Context) (*Profile, error) {
	return userRepo.Profile(ctx, 1001)
}))

// Second read within the same instance: return the in-memory cache directly
profile2, err := memo.Get(ctx, "user:1001:profile")
```

> `cache.MemoFrom(storeName)` supports creating memoization based on a specific store.

### Failover

The `failover` store attempts child stores in configured order. Only errors from the underlying store trigger a switch to a fallback store; a cache miss does not trigger failover.

**Environment configuration**:

```env
CACHE_STORE=failover
CACHE_FAILOVER_STORES=redis,memory
```

**Code configuration**:

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

A `cache.failed_over` event is dispatched each time a switch to a fallback store occurs, suitable for monitoring and alerting.

### Custom Drivers

Custom drivers follow the Laravel `Cache::extend` approach: first register a driver factory, then use the driver name in `cache.stores.*.driver`. Registration must happen before the cache manager parses any store for the first time.

**Register the driver**:

```go
cache.Extend("tenant-memory", func(ctx cache.StoreFactoryContext) (cache.StoreDriver, error) {
	store := newTenantMemoryStore(ctx.Config.Options)
	return cache.NewStoreDriver(store), nil
})
```

**Add configuration in `config/cache.go`**:

```go
"tenant": map[string]interface{}{
	"driver": "tenant-memory",
	"prefix": "tenant:1001",
	"options": map[string]any{
		"default_ttl": 300,
	},
},
```

Then use the store via `cache.Store("tenant")` or facade methods in business code.

If you need to explicitly create a Manager in a standalone program or test:

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

**StoreFactoryContext Fields**:

| Field | Description |
| --- | --- |
| `Name` | The configured store name, e.g., `"tenant"` |
| `Driver` | The normalized driver name, e.g., `"tenant-memory"` |
| `Config` | A full copy of the current store's configuration, including `Options` extension parameters |
| `GlobalPrefix` | Global key prefix (resolved from `Config.Prefix`) |
| `StorePrefix` | Current store's key prefix (resolved from `StoreConfig.Prefix`) |
| `Prefix` | The full prefix used when writing cache keys |
| `LockPrefix` | The full prefix used when writing lock keys |

**StoreDriver Structure**:

A custom driver must return a `StoreDriver`, where `Store` is required and other extension capabilities are optional:

| Field | Capability | Description |
| --- | --- | --- |
| `Store` | Required | Must implement gocache's `StoreInterface` |
| `Touch` | `Touch` | Support extending TTL for existing keys |
| `Atomic` | `Add` / `Increment` / `Decrement` / `Pull` | Support atomic operations |
| `Bulk` | `Many` / `PutMany` / `ForgetMany` | Support bulk operations |
| `Flush` | `Flush` | Support flushing by Repository prefix |
| `Tags` | `Tags` | Support tagged cache |
| `Lock` | `Lock` / `RestoreLock` / `Funnel` | Support distributed locks |
| `LockFlush` | `FlushLocks` | Support bulk lock key cleanup |
| `Close` | `Manager.Close` | Support releasing external resources |

The Manager automatically checks if the `Store` itself implements any of the above extension interfaces. If extension capabilities are not on the store itself, you can provide them explicitly:

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

### Resource Lifecycle

`cache.ServiceProvider` registers a close callback via `container.WithCloser` during registration. When the application exits normally, the framework calls `Manager.Close()` to release all external resources held by constructed stores (e.g., Redis connections). Developers do not need to handle this manually.

When explicitly creating a Manager in a **standalone program or test**, ensure resources are released on close:

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

Or register the close option through bootstrap for the Application to manage the lifecycle:

```go
app.Instance("cache.manager", manager, cache.ManagerCloseOption())
```

## Cache Events

With `cache.stores.*.events` enabled, the Repository dispatches cache lifecycle events. Events are distributed through the `github.com/prismgo/framework/event` bus, suitable for auditing, metrics collection, and troubleshooting.

Set an event sink via `cache.UseEventSink`:

```go
cache.UseEventSink(func(ctx context.Context, event cache.CacheEvent) {
	log.Printf("[%s] store=%s key=%s", event.Name(), event.Store, event.Key)
})
```

Pass `nil` to disable event forwarding.

### Event List

| Event Constant | Event Name | Triggered When |
| --- | --- | --- |
| `EventCacheRetrieving` | `cache.retrieving` | About to read from cache |
| `EventCacheHit` | `cache.hit` | Cache hit |
| `EventCacheMissed` | `cache.missed` | Cache miss |
| `EventCacheWriting` | `cache.writing` | About to write to cache |
| `EventCacheWritten` | `cache.written` | Write succeeded |
| `EventCacheWriteFailed` | `cache.write_failed` | Write failed |
| `EventCacheForgetting` | `cache.forgetting` | About to delete from cache |
| `EventCacheForgotten` | `cache.forgotten` | Delete succeeded |
| `EventCacheForgetFailed` | `cache.forget_failed` | Delete failed |
| `EventCacheFlushing` | `cache.flushing` | About to flush cache |
| `EventCacheFlushed` | `cache.flushed` | Flush succeeded |
| `EventCacheFlushFailed` | `cache.flush_failed` | Flush failed |
| `EventCacheLocksFlushed` | `cache.locks_flushed` | Lock namespace cleanup succeeded |
| `EventCacheLockFlushFailed` | `cache.lock_flush_failed` | Lock namespace cleanup failed |
| `EventCacheFailedOver` | `cache.failed_over` | Failover switched to a fallback store |

`CacheEvent` struct fields:

| Field | Type | Description |
| --- | --- | --- |
| `Event` | `string` | Event name |
| `Store` | `string` | Store name |
| `Key` | `string` | Single cache key |
| `Keys` | `[]string` | Keys involved in a bulk operation |
| `Tags` | `[]string` | Tag list (tagged cache operations) |
| `Error` | `error` | Operation error |
| `From` | `string` | Failover source store |
| `To` | `string` | Failover target store |

## Deferred Context

`WithDeferred` attaches a deferred task queue to a context, allowing asynchronous operations like stale refresh to execute after the response is written:

```go
ctx, runDeferred := cache.WithDeferred(context.Background())
defer runDeferred()
```

When used in HTTP middleware:

```go
engine.Use(middleware.Deferred())
```

## Key Prefixes

The final cache key is composed of multiple prefix segments, colon-separated, with empty segments omitted:

**Regular cache key**:

```text
{cache.prefix}:{store.prefix}:{key}
```

**Lock key**:

```text
{cache.prefix}:{store.prefix}:{cache.lock.prefix}:{name}
```

Business keys should use stable, readable namespaces:

```text
tenant:1:permissions
workorder:1001:detail
wechat:corp:access_token
sms:lock:13800138000
```

## Data Encoding Conventions

Semantic numeric values (int, uint, float, numeric strings) are written directly as decimal ASCII bytes; other values are encoded to `[]byte` via the Payload Encoding and decoded back on read. The default encoding is `msgpack`; explicitly setting `cache.encoding=json` uses JSON for easier rollback and manual inspection.

**Recommendations**:

- Use serializable structs, slices, maps, strings, numbers, or `[]byte` for cache values
- Keep stable `json` tags on struct fields to avoid field name drift across encoding switches or version upgrades
- Do not cache `context.Context`, database connections, transactions, HTTP requests, functions, channels, or other runtime resources
- When modifying cached struct fields, bump the key version, e.g., `dashboard:stats:v2`

## Error Constants

| Error Constant | Description |
| --- | --- |
| `cache.ErrCacheMiss` | Key does not exist or has expired |
| `cache.ErrStoreNotFound` | Specified store is not configured or registered |
| `cache.ErrLockTimeout` | `Block` wait for lock timed out |
| `cache.ErrLockNotHeld` | Current lock instance does not hold a releasable lock |
| `cache.ErrInvalidCounter` | Counter's existing value is not an integer |
| `cache.ErrTagsUnsupported` | Current store does not support tagged cache |

## Built-in Store Capability Matrix

| Capability | memory | redis | file | failover |
| --- | --- | --- | --- | --- |
| Touch (extend TTL) | Supported | Supported | Supported | Supported (delegates to child store) |
| Atomic (Add/Increment/Pull) | Supported | Supported | Supported | Supported |
| Bulk (GetMany/PutMany/ForgetMany) | Supported | Supported | Supported | Supported |
| PrefixFlush (flush by prefix) | Supported | Supported | Supported | Supported (delegates to child store) |
| Tags (tagged cache) | Supported | Supported | Not supported | Supported (delegates to tag-capable child store) |
| Lock (distributed lock) | Supported | Supported | Supported | Supported (delegates to child store) |
| LockFlush (bulk lock cleanup) | Supported | Supported | Supported | Supported (delegates to child store) |
| Close (release resources) | Supported | No (managed by `github.com/prismgo/framework/redis`) | No | No |

## Laravel Cache Mapping

| Laravel Method | PrismGo Equivalent |
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
