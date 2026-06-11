# Facades

- [Introduction](#introduction)
- [How Facades Work](#how-facades-work)
- [Core Facade: facade.Resolve](#core-facade-facaderesolve)
- [Available Facades](#available-facades)
    - [Cache Facade](#cache-facade)
    - [Config Facade](#config-facade)
    - [Route Facade](#route-facade)
    - [Logger Facade](#logger-facade)
    - [Database Facade](#database-facade)
    - [Filesystem Facade](#filesystem-facade)
- [Facade Class Reference](#facade-class-reference)
- [Laravel Facade Mapping](#laravel-facade-mapping)

---

PrismGo's Facades provide a "static" interface to services registered in the [service container](/docs/container). They serve as "static proxies" to underlying classes in the service container, offering a terse, expressive syntax while maintaining better testability and flexibility than traditional static methods.

---

## Introduction

Throughout PrismGo's documentation and source code, you will see examples that interact with framework features via package-level functions. For example:

```go
import "github.com/prismgo/framework/cache"

// Write to cache using the Cache Facade
if err := cache.Put(ctx, "site.name", "PrismGo", 10*time.Minute); err != nil {
    return err
}

// Read from cache using the Cache Facade
name, err := cache.Get[string](ctx, "site.name", cache.Value("Default Name"))
```

Here, `cache.Put` and `cache.Get` are not methods on a struct — they are package-level convenience functions provided by the `cache` package. Internally, they use `facade.Resolve` to resolve the underlying cache Manager from the current Application's container, delegating the actual operation to that resolved instance.

The core value of facades:

- **Concise syntax**: No need to manually inject or retrieve service instances — call package-level functions directly.
- **Type safety**: Strongly typed return values via Go generics.
- **Testability**: Underlying services are managed by the container and can be swapped in tests.
- **Unified entry point**: All modules follow the same resolution pattern, reducing the learning curve.

## How Facades Work

PrismGo's facade implementation lives in the `github.com/prismgo/framework/facade` package, with a single generic function at its core:

```go
// Resolve resolves a service from the current Application container.
// It panics when the container is not set up, the key is not bound,
// the type does not match, or the factory returns an error.
func Resolve[T any](key string) T
```

The resolution flow works as follows:

1. It calls `container.Make[T](key)` to resolve a service by key from the current Application's container.
2. If the container is not set up (no current Application), the key is not bound, the type doesn't match, or the factory returns an error, `container.Make` returns an error.
3. `facade.Resolve` converts these errors into panics, ensuring assembly issues are exposed immediately and preventing callers from proceeding with zero values.

Each functional module (cache, config, route, logger, etc.) defines a `facade.go` file within its package, which uses `facade.Resolve` to obtain the underlying service instance and exposes a set of package-level convenience functions. The call chain is:

```
Business code → cache.Put(ctx, key, val, ttl) 
              → cache.Default() → cache.Resolve().Default() 
              → facade.Resolve[*Manager]("cache.manager") 
              → container.Make[*Manager]("cache.manager") 
              → Current Application container returns the registered Manager instance
```

## Core Facade: facade.Resolve

`facade.Resolve` is the foundation of all module facades. If you need to directly obtain a service from the container:

```go
import "github.com/prismgo/framework/facade"

// Resolve *cache.Manager from the container
manager := facade.Resolve[*cache.Manager]("cache.manager")
```

**Parameter Reference:**

| Parameter | Type | Description |
| --- | --- | --- |
| `T` | Type parameter | The expected service type |
| `key` | `string` | The service key registered in the container |

**Behaviour:**

- Service exists and type matches: returns the service pointer/value.
- Service doesn't exist, type mismatch, or factory error: **panics** (does not return an error).
- No current Application container: **panics**.

> This is intentionally designed: Facades are strictly convenience entry points. Swallowing resolution errors would cause callers to proceed with zero values. Therefore, the facade layer consistently panics to expose assembly issues as early as possible.

## Available Facades

### Cache Facade

**Package:** `github.com/prismgo/framework/cache`

**Service Key:** `"cache.manager"`

**Underlying Type:** `*Manager`

The Cache Facade provides convenient access to the caching system. It manages multiple cache stores (Memory, Redis, File, Failover), each exposing read/write operations through a `Repository`.

#### Resolution Method

```go
// Resolve returns the cache Factory contract
func Resolve() cachecontract.Factory
```

#### Configuration Parameters

Cache configuration is registered in `config/cache.go`. Key parameters:

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `cache.default` | `CACHE_STORE` | `"memory"` | Default cache store name |
| `cache.encoding` | `CACHE_ENCODING` | `""` | Encoding method: `msgpack` or `json` |
| `cache.prefix` | `CACHE_PREFIX` | `"workorder_cache"` | Global cache key prefix |

For detailed configuration, refer to the [Cache documentation](/docs/cache).

#### Available Methods

**Store Selection & Info:**

| Method | Signature | Description |
| --- | --- | --- |
| `DefaultName` | `() string` | Get the default store name |
| `Default` | `() cachecontract.Repository` | Get the Repository for the default store |
| `Store` | `(name string) cachecontract.Repository` | Get Repository by name; empty name returns default store |
| `Name` | `() string` | Get the default store's Repository name |
| `Close` | `() error` | Release external resources held by built stores |

**Write Operations:**

| Method | Signature | Description |
| --- | --- | --- |
| `Put` | `(ctx, key, value, ttl) error` | Write to the default store |
| `PutFrom` | `(ctx, storeName, key, value, ttl) error` | Write to a specific store |
| `Set` | `(ctx, key, value, ttl) error` | Alias for Put |
| `SetFrom` | `(ctx, storeName, key, value, ttl) error` | Alias for PutFrom |
| `Forever` | `(ctx, key, value) error` | Write permanently to the default store |
| `ForeverFrom` | `(ctx, storeName, key, value) error` | Write permanently to a specific store |
| `Add` | `(ctx, key, value, ttl) (bool, error)` | Write only if the key doesn't exist |
| `AddFrom` | `(ctx, storeName, key, value, ttl) (bool, error)` | Write only if key doesn't exist in specific store |
| `PutMany` | `(ctx, values, ttl) error` | Write multiple items to the default store |
| `PutManyFrom` | `(ctx, storeName, values, ttl) error` | Write multiple items to a specific store |
| `SetMultiple` | `(ctx, values, ttl) error` | Alias for PutMany |
| `SetMultipleFrom` | `(ctx, storeName, values, ttl) error` | Alias for PutManyFrom |

**Read Operations:**

| Method | Signature | Description |
| --- | --- | --- |
| `Get[T]` | `(ctx, key, fallback...) (T, error)` | Read and decode as generic type T |
| `GetFrom[T]` | `(ctx, storeName, key, fallback...) (T, error)` | Read and decode from a specific store |
| `String` | `(ctx, key, fallback...) (string, error)` | Read a string value |
| `StringFrom` | `(ctx, storeName, key, fallback...) (string, error)` | Read a string from a specific store |
| `Integer` | `(ctx, key, fallback...) (int, error)` | Read an integer value |
| `IntegerFrom` | `(ctx, storeName, key, fallback...) (int, error)` | Read an integer from a specific store |
| `Float` | `(ctx, key, fallback...) (float64, error)` | Read a float64 value |
| `FloatFrom` | `(ctx, storeName, key, fallback...) (float64, error)` | Read a float64 from a specific store |
| `Boolean` | `(ctx, key, fallback...) (bool, error)` | Read a boolean value |
| `BooleanFrom` | `(ctx, storeName, key, fallback...) (bool, error)` | Read a boolean from a specific store |
| `Has` | `(ctx, key) (bool, error)` | Check if a key exists |
| `HasFrom` | `(ctx, storeName, key) (bool, error)` | Check if a key exists in a specific store |
| `Missing` | `(ctx, key) (bool, error)` | Check if a key is missing |
| `MissingFrom` | `(ctx, storeName, key) (bool, error)` | Check if a key is missing in a specific store |
| `Many[T]` | `(ctx, keys, fallback...) (map[string]T, error)` | Read and decode multiple items |
| `ManyFrom[T]` | `(ctx, storeName, keys, fallback...) (map[string]T, error)` | Read multiple items from a specific store |
| `GetMultiple[T]` | `(ctx, keys, fallback...) (map[string]T, error)` | Alias for Many |
| `GetMultipleFrom[T]` | `(ctx, storeName, keys, fallback...) (map[string]T, error)` | Alias for ManyFrom |

**Retrieve & Store (Remember Pattern):**

| Method | Signature | Description |
| --- | --- | --- |
| `Remember[T]` | `(ctx, key, ttl, loader) (T, error)` | Read from default store; on miss, execute loader and write |
| `RememberFrom[T]` | `(ctx, storeName, key, ttl, loader) (T, error)` | Read from specific store; on miss, execute loader and write |
| `RememberForever[T]` | `(ctx, key, loader) (T, error)` | Read; on miss, execute loader and write permanently |
| `RememberForeverFrom[T]` | `(ctx, storeName, key, loader) (T, error)` | Read from specific store; on miss, write permanently |
| `Sear[T]` | `(ctx, key, loader) (T, error)` | Alias for RememberForever |
| `SearFrom[T]` | `(ctx, storeName, key, loader) (T, error)` | Alias for RememberForeverFrom |
| `Flexible[T]` | `(ctx, key, window, loader) (T, error)` | Stale-while-revalidate hot cache |
| `FlexibleFrom[T]` | `(ctx, storeName, key, window, loader) (T, error)` | Stale-while-revalidate on specific store |

**TTL Operations:**

| Method | Signature | Description |
| --- | --- | --- |
| `Touch` | `(ctx, key, ttl) (bool, error)` | Extend TTL of an existing key |
| `TouchFrom` | `(ctx, storeName, key, ttl) (bool, error)` | Extend TTL of an existing key in specific store |

**Counters:**

| Method | Signature | Description |
| --- | --- | --- |
| `Increment` | `(ctx, key, delta...) (int64, error)` | Atomically increment an integer in the default store |
| `IncrementFrom` | `(ctx, storeName, key, delta...) (int64, error)` | Atomically increment in a specific store |
| `Decrement` | `(ctx, key, delta...) (int64, error)` | Atomically decrement in the default store |
| `DecrementFrom` | `(ctx, storeName, key, delta...) (int64, error)` | Atomically decrement in a specific store |

**Read & Delete:**

| Method | Signature | Description |
| --- | --- | --- |
| `Pull[T]` | `(ctx, key, fallback...) (T, error)` | Read a value and immediately delete it |
| `PullFrom[T]` | `(ctx, storeName, key, fallback...) (T, error)` | Read and delete from a specific store |

**Delete & Clear:**

| Method | Signature | Description |
| --- | --- | --- |
| `Forget` | `(ctx, key) error` | Delete a specific key |
| `ForgetFrom` | `(ctx, storeName, key) error` | Delete a key from a specific store |
| `Delete` | `(ctx, key) error` | Alias for Forget |
| `ForgetMany` | `(ctx, keys) error` | Delete multiple keys |
| `ForgetManyFrom` | `(ctx, storeName, keys) error` | Delete multiple keys from a specific store |
| `DeleteMultiple` | `(ctx, keys) error` | Alias for ForgetMany |
| `DeleteMultipleFrom` | `(ctx, storeName, keys) error` | Alias for ForgetManyFrom |
| `Flush` | `(ctx) error` | Clear all data in the default store |
| `FlushFrom` | `(ctx, storeName) error` | Clear all data in a specific store |
| `Clear` | `(ctx) error` | Alias for Flush |
| `ClearFrom` | `(ctx, storeName) error` | Alias for FlushFrom |

**Atomic Locks:**

| Method | Signature | Description |
| --- | --- | --- |
| `Lock` | `(name string, ttl time.Duration) cachecontract.Lock` | Create a lock with TTL |
| `LockFrom` | `(storeName, name string, ttl time.Duration) cachecontract.Lock` | Create a lock based on a specific store |
| `LockWithOwner` | `(name string, ttl time.Duration, owner string) cachecontract.Lock` | Create a lock with a specific owner |
| `LockWithOwnerFrom` | `(storeName, name string, ttl time.Duration, owner string) cachecontract.Lock` | Create an owner-specific lock on a specific store |
| `RestoreLock` | `(name, owner string) cachecontract.Lock` | Restore a releasable lock by owner token |
| `RestoreLockFrom` | `(storeName, name, owner string) cachecontract.Lock` | Restore a lock on a specific store |
| `FlushLocks` | `(ctx) error` | Clear the lock namespace |
| `FlushLocksFrom` | `(ctx, storeName) error` | Clear the lock namespace on a specific store |

**Concurrency Limiting:**

| Method | Signature | Description |
| --- | --- | --- |
| `Funnel` | `(name string) cachecontract.FunnelLimiter` | Create a funnel limiter |
| `FunnelFrom` | `(storeName, name string) cachecontract.FunnelLimiter` | Create a funnel limiter on a specific store |

**Tagged Cache:**

| Method | Signature | Description |
| --- | --- | --- |
| `Tags` | `(tags ...string) cachecontract.TaggedRepository` | Create a tagged cache entry point |
| `TagsFrom` | `(storeName string, tags ...string) cachecontract.TaggedRepository` | Create a tagged cache on a specific store |

**Memoization:**

| Method | Signature | Description |
| --- | --- | --- |
| `Memo` | `() cachecontract.MemoRepository` | Request/task-scoped memoization entry point |
| `MemoFrom` | `(storeName string) cachecontract.MemoRepository` | Memoization entry point on a specific store |

**Close Option:**

```go
func ManagerCloseOption() containercontract.BindingOption
```

Returns the cache Manager's close option for use during bootstrap registration.

---

### Config Facade

**Package:** `github.com/prismgo/framework/config`

**Service Key:** `"config.default"`

**Underlying Type:** `*Config`

The Config Facade provides convenient access to application configuration. Configuration data comes from Go files in the `config/` directory and the `.env` file.

#### Resolution Method

```go
func Resolve() *Config
```

#### Available Methods

| Method | Signature | Description |
| --- | --- | --- |
| `Clone` | `() *Config` | Clone the config accessor with an independent config repository |
| `Empty` | `() bool` | Check if the config accessor holds no configuration items |
| `Reload` | `() error` | Reload the config object from the project root `.env` |
| `Get` | `(path string, defaultValue ...any) string` | Read a string config, falling back to default |
| `GetString` | `(path string, defaultValue ...any) string` | Read a string config |
| `GetInt` | `(path string, defaultValue ...any) int` | Read an integer config |
| `GetFloat64` | `(path string, defaultValue ...any) float64` | Read a float64 config |
| `GetInt64` | `(path string, defaultValue ...any) int64` | Read an int64 config |
| `GetUint` | `(path string, defaultValue ...any) uint` | Read a uint config |
| `GetBool` | `(path string, defaultValue ...any) bool` | Read a boolean config |
| `GetStringMapString` | `(path string) map[string]string` | Read a `map[string]string` config |
| `GetStringMap` | `(path string) map[string]any` | Read a `map[string]any` config |

**Usage Example:**

```go
import "github.com/prismgo/framework/config"

// Read a string config
appName := config.Get("app.name", "PrismGo")

// Read an integer config
port := config.GetInt("app.port", 8080)

// Read a boolean config
debug := config.GetBool("app.debug", false)

// Reload .env
if err := config.Reload(); err != nil {
    // Handle error
}
```

---

### Route Facade

**Package:** `github.com/prismgo/framework/route`

**Service Key:** `"route.router"`

**Underlying Type:** `*Router`

The Route Facade provides convenient access to HTTP route registration and management. It is built on top of the Gin framework.

#### Resolution Method

```go
func Resolve() *Router
```

#### Available Methods

**Route Registration:**

| Method | Signature | Description |
| --- | --- | --- |
| `Get` | `(uri string, handlers ...HandlerFunc) *Route` | Register a GET route |
| `Post` | `(uri string, handlers ...HandlerFunc) *Route` | Register a POST route |
| `Put` | `(uri string, handlers ...HandlerFunc) *Route` | Register a PUT route |
| `Patch` | `(uri string, handlers ...HandlerFunc) *Route` | Register a PATCH route |
| `Delete` | `(uri string, handlers ...HandlerFunc) *Route` | Register a DELETE route |
| `Options` | `(uri string, handlers ...HandlerFunc) *Route` | Register an OPTIONS route |
| `Match` | `(methods []string, uri string, handlers ...HandlerFunc) *Route` | Register a route matching multiple methods |
| `Any` | `(uri string, handlers ...HandlerFunc) *Route` | Register a route matching all HTTP methods |
| `Redirect` | `(uri, destination string, status ...int) *Route` | Register a redirect route |
| `PermanentRedirect` | `(uri, destination string) *Route` | Register a permanent redirect route |
| `Static` | `(uri, root string) *Route` | Register a static file route |
| `Fallback` | `(handler HandlerFunc) *Route` | Register a fallback route |

**Route Groups & Attributes:**

| Method | Signature | Description |
| --- | --- | --- |
| `Prefix` | `(prefix string) *Registrar` | Set a route prefix |
| `Name` | `(name string) *Registrar` | Set a route name |
| `Domain` | `(domain string) *Registrar` | Set a route domain |
| `Middleware` | `(handlers ...HandlerFunc) *Registrar` | Set route middleware |
| `WithoutMiddleware` | `(names ...string) *Registrar` | Exclude specific middleware |
| `Controller` | `(controller any) *Registrar` | Bind a controller |
| `Group` | `(fn func())` | Create a route group |

**Parameter Binding:**

| Method | Signature | Description |
| --- | --- | --- |
| `Bind` | `(param string, binder Binder)` | Bind a parameter binder |
| `Model` | `(param string, binder Binder)` | Bind a model binder |
| `Pattern` | `(param, expr string)` | Set a regex constraint for a parameter |

**Route Information:**

| Method | Signature | Description |
| --- | --- | --- |
| `Mount` | `(engine *gin.Engine) error` | Mount routes to a Gin engine |
| `List` | `() []RouteInfo` | List all registered routes |
| `URL` | `(name string, params map[string]any) (string, error)` | Generate a URL from a named route |

**Usage Example:**

```go
import "github.com/prismgo/framework/route"

// Register a route
route.Get("/users", func(ctx *gin.Context) {
    ctx.JSON(200, gin.H{"message": "Hello"})
})

// Route group
route.Prefix("/api").Group(func() {
    route.Get("/users", ListUsers)
    route.Post("/users", CreateUser)
})

// Named route URL generation
url, _ := route.URL("user.profile", map[string]any{"id": 123})
```

---

### Logger Facade

**Package:** `github.com/prismgo/framework/logger`

**Service Key:** `"logger.manager"`

**Underlying Type:** `*Manager`

The Logger Facade provides convenient access to structured logging. It is built on logrus and supports multi-channel log output.

#### Resolution Method

```go
func Resolve() *Manager
```

#### Available Methods

| Method | Signature | Description |
| --- | --- | --- |
| `DefaultName` | `() string` | Get the default channel name |
| `Close` | `() error` | Release underlying driver resources for built channels |
| `Channel` | `(name string) Logger` | Get a Logger by channel name |
| `Debug` | `(args ...any)` | Log at debug level via the default channel |
| `Debugf` | `(format string, args ...any)` | Log a formatted debug message |
| `Info` | `(args ...any)` | Log at info level |
| `Infof` | `(format string, args ...any)` | Log a formatted info message |
| `Warn` | `(args ...any)` | Log at warn level |
| `Warnf` | `(format string, args ...any)` | Log a formatted warn message |
| `Error` | `(args ...any)` | Log at error level |
| `Errorf` | `(format string, args ...any)` | Log a formatted error message |
| `Fatal` | `(args ...any)` | Log at fatal level |
| `Fatalf` | `(format string, args ...any)` | Log a formatted fatal message |
| `WithField` | `(key string, value any) Logger` | Attach a single context field |
| `WithFields` | `(fields map[string]any) Logger` | Attach multiple context fields |
| `WithError` | `(err error) Logger` | Attach an error context |
| `WithContext` | `(ctx context.Context) Logger` | Attach context-associated fields |

**Usage Example:**

```go
import "github.com/prismgo/framework/logger"

// Basic logging
logger.Info("Server started on port", port)
logger.Infof("Server started on port %d", port)

// Structured logging with fields
logger.WithField("request_id", reqID).Info("Processing request")

// Using a specific channel
logger.Channel("stack").Debug("debug message")

// Error logging
logger.WithError(err).Error("Failed to process")
```

---

### Database Facade

**Package:** `github.com/prismgo/framework/database`

**Service Key:** `"database.default"`

**Underlying Type:** `*gorm.DB`

The Database Facade provides convenient access to the GORM database connection.

#### Resolution Method

```go
func Resolve() *gorm.DB
```

#### Available Methods

| Method | Signature | Description |
| --- | --- | --- |
| `DBCloseOption` | `() containercontract.BindingOption` | Returns the close option for the database connection, for use during bootstrap registration |

**Usage Example:**

```go
import "github.com/prismgo/framework/database"

// Get the GORM DB instance
db := database.Resolve()

// Execute a query
var users []User
db.Find(&users)
```

---

### Filesystem Facade

**Package:** `github.com/prismgo/framework/filesystem`

**Service Key:** `"filesystem.manager"`

**Underlying Type:** `*Manager`

The Filesystem Facade provides convenient access to file storage operations. It supports local disks and cloud storage (S3, OSS, etc.).

#### Resolution Method

```go
func Resolve() *Manager
```

#### Available Methods

**Disk Selection & Info:**

| Method | Signature | Description |
| --- | --- | --- |
| `DefaultName` | `() string` | Get the default disk name |
| `CloudName` | `() string` | Get the configured cloud disk name |
| `Default` | `() fscontract.Repository` | Get the Repository for the default disk |
| `Disk` | `(name string) fscontract.Repository` | Get a disk by name |
| `Name` | `() string` | Get the default disk's repository name |
| `Close` | `() error` | Close all created disk instances |

**Write Operations:**

| Method | Signature | Description |
| --- | --- | --- |
| `Put` | `(ctx, key, value any, opts ...PutOptions) error` | Write content |
| `PutReader` | `(ctx, key string, reader io.Reader, opts ...PutOptions) error` | Write from a Reader |
| `PutFile` | `(ctx, dir string, file *multipart.FileHeader, opts ...PutOptions) (string, error)` | Save an uploaded file with its original name |
| `PutFileAs` | `(ctx, dir string, file *multipart.FileHeader, name string, opts ...PutOptions) (string, error)` | Save an uploaded file with a specified name |

**Read Operations:**

| Method | Signature | Description |
| --- | --- | --- |
| `Get` | `(ctx, key string) ([]byte, error)` | Read file content |
| `OpenStream` | `(ctx, key string) (io.ReadCloser, FileInfo, error)` | Open a file as a stream |
| `Download` | `(ctx, key string, w io.Writer) error` | Copy file content to a Writer |

**File Inspection & Operations:**

| Method | Signature | Description |
| --- | --- | --- |
| `Exists` | `(ctx, key string) (bool, error)` | Check if a file exists |
| `Delete` | `(ctx, keys ...string) error` | Delete files |
| `Copy` | `(ctx, src, dst string) error` | Copy a file |
| `Move` | `(ctx, src, dst string) error` | Move a file |
| `Path` | `(key string) string` | Get the physical or logical path |
| `Size` | `(ctx, key string) (int64, error)` | Get the file size |
| `LastModified` | `(ctx, key string) (time.Time, error)` | Get the last modified time |
| `LastModifiedInfo` | `(ctx, key string) (FileInfo, error)` | Get full file metadata |

**Directory Operations:**

| Method | Signature | Description |
| --- | --- | --- |
| `MakeDirectory` | `(ctx, dir string) error` | Create a directory |
| `DeleteDirectory` | `(ctx, dir string) error` | Delete a directory |
| `Files` | `(ctx, dir string) ([]string, error)` | List files in the current directory level |
| `AllFiles` | `(ctx, dir string) ([]string, error)` | Recursively list all files |
| `Directories` | `(ctx, dir string) ([]string, error)` | List directories in the current level |
| `AllDirectories` | `(ctx, dir string) ([]string, error)` | Recursively list all directories |

**URL & Visibility:**

| Method | Signature | Description |
| --- | --- | --- |
| `URL` | `(key string) (string, error)` | Generate a public access URL |
| `TemporaryURL` | `(ctx, key string, expiry time.Time) (string, error)` | Generate a temporary signed URL |
| `SetVisibility` | `(ctx, key, visibility string) error` | Set file visibility |
| `GetVisibility` | `(ctx, key string) (string, error)` | Get file visibility |

**Temporary URL Verification:**

```go
func VerifyTemporaryURL(disk, key string, expires time.Time, signature string) error
```

Verifies the signature and expiration of a local temporary URL.

**Close Option:**

```go
func ManagerCloseOption() containercontract.BindingOption
```

Returns the filesystem Manager's close option for use during bootstrap registration.

**Usage Example:**

```go
import "github.com/prismgo/framework/filesystem"

// Write a file
if err := filesystem.Put(ctx, "avatars/user1.jpg", data); err != nil {
    return err
}

// Read a file
content, err := filesystem.Get(ctx, "avatars/user1.jpg")

// Use a specific disk
repo := filesystem.Disk("s3")
if err := repo.Put(ctx, "docs/report.pdf", pdfData); err != nil {
    return err
}

// Generate a temporary URL
url, err := filesystem.TemporaryURL(ctx, "docs/report.pdf", time.Now().Add(1*time.Hour))
```

---

## Facade Class Reference

The following table summarizes all available facades along with their underlying types and service container binding keys:

| Facade (Package) | Underlying Type | Service Container Binding Key |
| --- | --- | --- |
| `github.com/prismgo/framework/cache` | `*Manager` | `"cache.manager"` |
| `github.com/prismgo/framework/config` | `*Config` | `"config.default"` |
| `github.com/prismgo/framework/route` | `*Router` | `"route.router"` |
| `github.com/prismgo/framework/logger` | `*Manager` | `"logger.manager"` |
| `github.com/prismgo/framework/database` | `*gorm.DB` | `"database.default"` |
| `github.com/prismgo/framework/filesystem` | `*Manager` | `"filesystem.manager"` |

---

## Laravel Facade Mapping

If you are familiar with Laravel's Facade system, the following table will help you quickly find the corresponding facade in PrismGo:

| Laravel Facade | PrismGo Package | Description |
| --- | --- | --- |
| `Cache` | `cache` | Cache management (Memory / Redis / File / Failover) |
| `Config` | `config` | Configuration management |
| `Route` | `route` | Route registration and management |
| `Log` | `logger` | Structured logging |
| `DB` | `database` | Database queries (GORM) |
| `Storage` | `filesystem` | File storage (Local / Cloud) |
