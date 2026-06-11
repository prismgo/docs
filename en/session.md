# Session

- [Introduction](#introduction)
- [Configuration](#configuration)
  - [Config File](#config-file)
  - [Driver Prerequisites](#driver-prerequisites)
  - [Configuration Parameters](#configuration-parameters)
- [Session Usage](#session-usage)
  - [Middleware](#middleware)
  - [Retrieving Data](#retrieving-data)
  - [Storing Data](#storing-data)
  - [Flash Data](#flash-data)
  - [Deleting Data](#deleting-data)
  - [Regenerating the Session ID](#regenerating-the-session-id)
- [Session Blocking](#session-blocking)
- [Cookie Handling](#cookie-handling)
- [Encryption](#encryption)
- [Adding Custom Session Drivers](#adding-custom-session-drivers)
  - [Implementing the Driver](#implementing-the-driver)
  - [Registering the Driver](#registering-the-driver)
- [Error Constants](#error-constants)
- [Laravel Session Mapping](#laravel-session-mapping)

---

## Introduction

Since HTTP driven applications are stateless, sessions provide a way to store information about the user across multiple requests. PrismGo's session component provides Laravel-style server-side session capabilities. The client cookie only stores an opaque session ID; the actual business data is persisted in a server-side driver. By default, the `file` driver is used, storing data in `storage/framework/sessions`.

The session system uses a `Manager` to orchestrate session lifecycle (start, restore, save), a `Store` to provide per-request read/write operations, and package-level facade functions for quick access in Gin handlers. All operations that interact with the driver explicitly accept `context.Context`.

## Configuration

### Config File

Session configuration is registered in `config/session.go`. You can override any parameter via environment variables:

```go
// config/session.go
func init() {
    config.Add("session", func() map[string]interface{} {
        return map[string]interface{}{
            "driver":          config.Env("SESSION_DRIVER", "file"),
            "lifetime":        config.Env("SESSION_LIFETIME", 120),
            "expire_on_close": config.Env("SESSION_EXPIRE_ON_CLOSE", false),
            "encrypt":         config.Env("SESSION_ENCRYPT", false),
            "encoding":        config.Env("SESSION_ENCODING", ""),
            "connection":      config.Env("SESSION_CONNECTION", "default"),
            "prefix":          config.Env("SESSION_PREFIX", "prismgo_session"),
            "cookie":          config.Env("SESSION_COOKIE", "prismgo_session"),
            "path":            config.Env("SESSION_PATH", "/"),
            "domain":          config.Env("SESSION_DOMAIN", ""),
            "secure":          config.Env("SESSION_SECURE_COOKIE", false),
            "http_only":       config.Env("SESSION_HTTP_ONLY", true),
            "same_site":       config.Env("SESSION_SAME_SITE", "lax"),
            "files":           config.Env("SESSION_FILES", "storage/framework/sessions"),
            "lock_seconds":    config.Env("SESSION_LOCK_SECONDS", 10),
            "lock_wait":       config.Env("SESSION_LOCK_WAIT_SECONDS", 10),
        }
    })
}
```

### Driver Prerequisites

#### File

No additional dependencies. Sessions are stored as individual files in the `storage/framework/sessions` directory. Each session ID maps to one file. Ensure the application process has read/write access to this directory. This driver is suitable for local development and single-instance deployments.

#### Redis

Requires the `github.com/prismgo/framework/redis` package to have registered a connection pool. Specify the named connection via the `SESSION_CONNECTION` environment variable (default: `"default"`). Connection pool configuration is managed in `config/redis.go`. This driver is recommended for multi-instance deployments where session data must be shared across processes.

### Configuration Parameters

#### Top-Level Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `session.driver` | `SESSION_DRIVER` | `"file"` | Session persistence driver name. Built-in drivers: `file`, `redis` |
| `session.lifetime` | `SESSION_LIFETIME` | `120` | Server-side session validity period, in minutes |
| `session.expire_on_close` | `SESSION_EXPIRE_ON_CLOSE` | `false` | When `true`, the browser cookie omits `Expires` and `Max-Age`, making it a session cookie |
| `session.encrypt` | `SESSION_ENCRYPT` | `false` | When `true`, server-side payloads are encrypted before storage. Does not affect the session ID cookie |
| `session.encoding` | `SESSION_ENCODING` | `""` (inherits `encoding.default`) | Payload encoding method: `msgpack` or `json` |

#### Cookie Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `session.cookie` | `SESSION_COOKIE` | `"prismgo_session"` | Cookie name that carries the session ID |
| `session.path` | `SESSION_PATH` | `"/"` | Cookie `Path` attribute |
| `session.domain` | `SESSION_DOMAIN` | `""` | Cookie `Domain` attribute |
| `session.secure` | `SESSION_SECURE_COOKIE` | `false` | Whether the cookie should only be sent over HTTPS |
| `session.http_only` | `SESSION_HTTP_ONLY` | `true` | Whether the cookie is inaccessible to JavaScript |
| `session.same_site` | `SESSION_SAME_SITE` | `"lax"` | Cookie `SameSite` attribute. Values: `lax`, `strict`, `none` |

#### File Driver Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `session.files` | `SESSION_FILES` | `"storage/framework/sessions"` | Root directory for session data files |

#### Redis Driver Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `session.connection` | `SESSION_CONNECTION` | `"default"` | Redis connection pool name to use |
| `session.prefix` | `SESSION_PREFIX` | `"prismgo_session"` | Redis key prefix for session data, isolated from cache keys |

#### Lock Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `session.lock_seconds` | `SESSION_LOCK_SECONDS` | `10` | Maximum time a session lock may be held, in seconds |
| `session.lock_wait` | `SESSION_LOCK_WAIT_SECONDS` | `10` | Maximum time a request waits to acquire a session lock, in seconds |

You can also construct configuration programmatically:

```go
cfg := session.DefaultConfig()
cfg.Lifetime = 30 * time.Minute
cfg.Cookie.Name = "admin_session"
cfg.Cookie.Secure = true
cfg.Cookie.SameSite = "lax"
cfg.Files = "storage/framework/admin_sessions"

manager, err := session.NewManager(cfg, nil)
if err != nil {
    return err
}
```

## Session Usage

### Middleware

The `StartSession` middleware handles the full session lifecycle for a request. Mount it on route groups that need session support:

```go
package routes

import (
    "net/http"

    "github.com/gin-gonic/gin"
    httpkit "github.com/prismgo/framework/http"
    "github.com/prismgo/framework/http/middleware"
    "github.com/prismgo/framework/route"
    "github.com/prismgo/framework/session"
)

func RegisterWebRoutes() {
    route.Prefix("/web").
        Middleware(middleware.StartSession()).
        Group(func() {
            route.Get("/profile", profile)
            route.Post("/profile", updateProfile)
        })
}

func profile(c *gin.Context) {
    userID := session.Get(c, "user_id", int64(0))
    notice := session.Pull(c, "notice", "")

    httpkit.Ok(c, gin.H{
        "user_id": userID,
        "notice":  notice,
    })
}

func updateProfile(c *gin.Context) {
    _ = session.Put(c, "user_id", int64(1001))
    _ = session.Flash(c, "notice", "Profile saved")

    c.Status(http.StatusNoContent)
}
```

The middleware execution flow:

1. Read the session ID from the request cookie.
2. Call `Manager.Start` to restore the server-side payload; create a new `Store` if the session is missing, expired, corrupted, or has an invalid ID.
3. Store the `*session.Store` in `gin.Context` so subsequent handlers can use it via `StoreFrom` or package-level convenience functions.
4. Create a `github.com/prismgo/framework/cookie` request-level queue, allowing business code to queue regular cookies in the same middleware chain.
5. After the handler returns, automatically save the session.
6. Write the session ID cookie, then flush the regular cookie queue.
7. Commit the business response.

> **Warning**: The middleware buffers response headers and body to ensure `Set-Cookie` can be written after the handler returns. It is not suitable for SSE, streaming downloads, or long-lived connections that require immediate flushing.

#### Using a Custom Manager

The `WithManager` option lets you inject a specific `Manager` into the middleware, useful for testing, isolated configurations, or special route groups:

```go
cfg := session.DefaultConfig()
cfg.Cookie.Name = "admin_session"
cfg.Files = "storage/framework/admin_sessions"

manager, err := session.NewManager(cfg, nil)
if err != nil {
    return err
}

route.Prefix("/admin").
    Middleware(middleware.StartSession(session.WithManager(manager))).
    Group(func() {
        route.Get("/dashboard", dashboard)
    })
```

If `WithManager` is not provided, the middleware uses `session.Default()`. After normal application startup, the default manager is created by the facade's lazy factory.

### Retrieving Data

#### Basic Retrieval

`Get` reads a value from the session. If the key does not exist, it returns the first default value; if no default is provided, it returns `nil`:

```go
name := session.Get(c, "name", "guest").(string)
```

#### Retrieving All Session Data

`All` returns a shallow copy of all session values. Modifying the returned map does not affect the Store:

```go
store, ok := session.StoreFrom(c)
if ok {
    values := store.All()
}
```

#### Retrieving a Portion of the Session Data

The `Only` and `Except` methods retrieve a subset of the session data:

```go
store, _ := session.StoreFrom(c)
profile := store.Only("user_id", "nickname", "avatar")
safeValues := store.Except("csrf_token", "notice")
```

#### Determining If an Item Exists in the Session

The `Has` method returns `true` if the item is present and its value is not `nil`:

```go
if session.Has(c, "user_id") {
    // The key exists with a non-nil value
}
```

The `Exists` method returns `true` if the item is present, even if its value is `nil`:

```go
if session.Exists(c, "draft") {
    // The key exists (value may be nil)
}
```

The `Missing` method returns `true` if the item is not present:

```go
if session.Missing(c, "csrf_token") {
    _ = session.Put(c, "csrf_token", newToken())
}
```

### Storing Data

#### Basic Storage

`Put` stores a value in the session. Values must be serializable by the underlying driver; the file driver uses JSON, so strings, numbers, booleans, arrays, maps, and simple structs are recommended:

```go
_ = session.Put(c, "user_id", int64(1001))
_ = session.Put(c, "filters", map[string]any{
    "status": "open",
    "page":   1,
})
```

#### Incrementing and Decrementing Session Values

If your session data contains an integer you wish to increment or decrement, you may use the `Increment` and `Decrement` methods:

```go
store, _ := session.StoreFrom(c)
count, err := store.Increment("retry_count")
if err != nil {
    return err
}

remaining, err := store.Decrement("quota", 2)
if err != nil {
    return err
}
```

Only integer values are supported. Non-numeric or floating-point values will return an error.

### Flash Data

Sometimes you may wish to store items in the session only for the next request. Flash data is primarily useful for short-lived status messages, such as form submission confirmations.

Flash data lifecycle:

- `Flash` writes a value that is readable in the current request and the next request.
- After the next request, the flashed data is automatically deleted unless `Keep` or `Reflash` is called.

#### `Flash(key string, value any)`

Write a temporary value readable in the current and next request:

```go
_ = session.Flash(c, "status", "Task was successful!")
```

#### `Now(key string, value any)`

Write a temporary value readable only in the current request. It will be deleted when the session is saved:

```go
_ = session.Now(c, "preview_error", "Only visible this request")
```

#### `Reflash()`

Extend all flash data for an additional request:

```go
if shouldRedirectAgain {
    _ = session.Reflash(c)
}
```

#### `Keep(keys ...string)`

Extend only specific flash keys for an additional request:

```go
_ = session.Keep(c, "status")
```

### Deleting Data

#### `Forget(keys ...string)`

Remove one or more keys from the session:

```go
_ = session.Forget(c, "draft", "notice")
```

#### `Flush()`

Remove all data from the session, including flash metadata, but do not regenerate the session ID:

```go
_ = session.Flush(c)
```

> For logout or security boundary transitions, prefer `Invalidate`, which also regenerates the session ID.

#### `Pull(key string, def ...any) any`

Retrieve and delete an item in a single operation, useful for one-time notices, redirect state, or temporary drafts:

```go
notice := session.Pull(c, "notice", "")
```

If the deleted key is flash data, the flash metadata is also cleaned up.

### Regenerating the Session ID

Regenerating the session ID is often done to prevent [session fixation](https://owasp.org/www-community/attacks/Session_fixation) attacks on your application.

#### `Regenerate(ctx context.Context) error`

Generate a new session ID while preserving all current session data. The old session ID is destroyed in the driver. Typical use case: after a successful login:

```go
func login(c *gin.Context) {
    // After verifying credentials...
    _ = session.Put(c, "user_id", int64(1001))

    if err := session.Regenerate(c); err != nil {
        httpkit.Fail(c, err)
        return
    }

    httpkit.Ok(c, gin.H{"ok": true})
}
```

#### `Invalidate(ctx context.Context) error`

Flush all session data and regenerate the session ID in a single operation. Typical use case: logout, identity switching, or risk detection:

```go
func logout(c *gin.Context) {
    if err := session.Invalidate(c); err != nil {
        httpkit.Fail(c, err)
        return
    }

    c.Status(http.StatusNoContent)
}
```

## Session Blocking

By default, PrismGo allows requests using the same session to execute concurrently. For many applications, this is not a problem; however, session data loss can occur when concurrent requests to different endpoints both write data to the session.

To mitigate this, PrismGo's session system acquires an exclusive lock per session ID when the driver implements the `Locker` interface. Both the `file` and `redis` built-in drivers support locking.

Lock behavior is controlled by two configuration parameters:

| Parameter | Default | Description |
| --- | --- | --- |
| `SESSION_LOCK_SECONDS` | `10` | Maximum time a session lock may be held before it is automatically released |
| `SESSION_LOCK_WAIT_SECONDS` | `10` | Maximum time a request waits to acquire a session lock. If the lock cannot be acquired within this time, `ErrLockTimeout` is returned |

**File driver locks**: Uses `O_CREATE|O_EXCL` lock files with token validation. Stale locks (whose mtime exceeds TTL) are detected and removed before retry. Polls at 10ms intervals.

**Redis driver locks**: Uses `SET NX PX` (SET if Not eXists with millisecond TTL). Release uses a Lua script that validates the owner token before deleting, preventing accidental release of a lock acquired by another request after TTL expiry. Polls at 10ms intervals.

## Cookie Handling

The `StartSession` middleware writes the session ID cookie with attributes from the session configuration:

- `Name` — cookie key carrying the opaque session ID
- `Path` — cookie scope
- `Domain` — cookie domain
- `Secure` — HTTPS-only transmission
- `HTTPOnly` — inaccessible to JavaScript
- `SameSite` — `lax`, `strict`, or `none`
- `Expires` / `Max-Age` — derived from `SESSION_LIFETIME`

If `SESSION_EXPIRE_ON_CLOSE=true`, the browser cookie omits `Expires` and `Max-Age` (becoming a session cookie), but the server-side payload still expires according to `SESSION_LIFETIME`.

The middleware also installs a `github.com/prismgo/framework/cookie` request-level queue. Business code can queue regular cookies in the same request, and they will be flushed after the session is saved:

```go
import cookiepkg "github.com/prismgo/framework/cookie"

func rememberLocale(c *gin.Context) {
    if _, err := cookiepkg.QueueMakeFrom(c, "locale", "zh-CN", 60*24,
        cookiepkg.Path("/"),
        cookiepkg.HTTPOnly(false),
        cookiepkg.SameSite(cookiepkg.SameSiteLax),
    ); err != nil {
        httpkit.Fail(c, err)
        return
    }

    c.Status(http.StatusNoContent)
}
```

> The session ID cookie and the regular cookie queue are separate concepts: the former only carries the session ID and is written by the session manager; the latter is queued by business code explicitly. Since `StartSession` already includes cookie queue capability, do not add `QueuedCookies()` middleware on the same route group.

## Encryption

When `SESSION_ENCRYPT=true`, server-side payloads are encrypted before storage. This does not affect the session ID cookie.

The encryption extension point is the `Encryptor` interface:

```go
type Encryptor interface {
    Encrypt(ctx context.Context, plaintext []byte) ([]byte, error)
    Decrypt(ctx context.Context, ciphertext []byte) ([]byte, error)
}
```

By default, `NopEncryptor` is used, which copies and returns input bytes without transformation. To use a custom encryptor:

```go
type AppEncryptor struct{}

func (AppEncryptor) Encrypt(ctx context.Context, plaintext []byte) ([]byte, error) {
    return encryptWithAppKey(ctx, plaintext)
}

func (AppEncryptor) Decrypt(ctx context.Context, ciphertext []byte) ([]byte, error) {
    return decryptWithAppKey(ctx, ciphertext)
}

cfg := session.DefaultConfig()
cfg.Encrypt = true
cfg.Encryptor = AppEncryptor{}

manager, err := session.NewManager(cfg, nil)
if err != nil {
    return err
}
```

Encryption or decryption failures are wrapped in a `SensitiveError` that never includes payload content, ciphertext, or plaintext fragments in its error message.

## Adding Custom Session Drivers

### Implementing the Driver

If none of the existing session drivers fit your application's needs, you can write your own. Your custom driver must implement the `Driver` interface:

```go
type Driver interface {
    Read(ctx context.Context, id string) (session.Payload, error)
    Write(ctx context.Context, id string, payload session.Payload, expiresAt *time.Time) error
    Destroy(ctx context.Context, id string) error
    GC(ctx context.Context, before time.Time) error
}
```

Method semantics:

- `Read` — Read the payload for the given session ID.
- `Write` — Write the payload, using `expiresAt` for server-side expiration.
- `Destroy` — Delete the session record for the given ID.
- `GC` — Clean up sessions expired before the given time.

To support session blocking, optionally implement the `Locker` interface:

```go
type Locker interface {
    Lock(ctx context.Context, id string, ttl time.Duration, wait time.Duration) (session.Lock, error)
}
```

The `Lock` interface for the acquired lock:

```go
type Lock interface {
    Release(ctx context.Context) error
}
```

### Registering the Driver

Register a named driver factory using `session.Extend`. Registration must happen before the session manager resolves any driver for the first time:

```go
func init() {
    session.Extend("memory", func(cfg session.Config) (session.Driver, error) {
        return NewMemoryDriver(cfg), nil
    })
}
```

Then enable it via environment variable:

```env
SESSION_DRIVER=memory
```

Or construct a manager explicitly:

```go
cfg := session.DefaultConfig()
cfg.Driver = "memory"

manager, err := session.NewManager(cfg, nil)
if err != nil {
    return err
}
```

> Registering a driver with the same name overwrites the previous factory. Empty names or nil factories are ignored. Unknown driver names return `ErrDriverNotFound`.

## Error Constants

| Error Constant | Description |
| --- | --- |
| `ErrInvalidConfig` | Configuration is invalid, Store is missing, or Manager/driver is nil |
| `ErrDriverNotFound` | The specified driver name is not registered |
| `ErrInvalidSessionID` | The session ID format is invalid |
| `ErrSessionNotFound` | No record found in the persistence layer |
| `ErrSessionExpired` | Session has exceeded its server-side validity period |
| `ErrPayloadMalformed` | Payload structure does not conform to the expected format |
| `ErrPayloadSerialize` | Serialization failed before write |
| `ErrPayloadDeserialize` | Deserialization failed after read |
| `ErrEncryptionFailed` | Payload encryption failed |
| `ErrDecryptionFailed` | Payload decryption failed |
| `ErrLockTimeout` | Timed out waiting for a session lock |
| `ErrLockNotHeld` | Attempted to release a lock not held by the current caller |

The Manager treats the following read errors as recoverable and creates a new session instead of propagating the error:

- `ErrSessionNotFound`
- `ErrSessionExpired`
- `ErrPayloadMalformed`
- `ErrPayloadDeserialize`
- `ErrDecryptionFailed`
- `ErrInvalidSessionID`

## Laravel Session Mapping

| Laravel Method | PrismGo Equivalent |
| --- | --- |
| `$request->session()->get('key', 'default')` | `session.Get(c, "key", "default")` |
| `$request->session()->all()` | `store.All()` |
| `$request->session()->only(['key'])` | `store.Only("key")` |
| `$request->session()->except(['key'])` | `store.Except("key")` |
| `$request->session()->has('key')` | `session.Has(c, "key")` |
| `$request->session()->exists('key')` | `session.Exists(c, "key")` |
| `$request->session()->missing('key')` | `session.Missing(c, "key")` |
| `$request->session()->put('key', 'value')` | `session.Put(c, "key", "value")` |
| `$request->session()->increment('key')` | `store.Increment("key")` |
| `$request->session()->decrement('key')` | `store.Decrement("key")` |
| `$request->session()->flash('key', 'value')` | `session.Flash(c, "key", "value")` |
| `$request->session()->now('key', 'value')` | `session.Now(c, "key", "value")` |
| `$request->session()->reflash()` | `session.Reflash(c)` |
| `$request->session()->keep(['key'])` | `session.Keep(c, "key")` |
| `$request->session()->pull('key', 'default')` | `session.Pull(c, "key", "default")` |
| `$request->session()->forget('key')` | `session.Forget(c, "key")` |
| `$request->session()->flush()` | `session.Flush(c)` |
| `$request->session()->regenerate()` | `session.Regenerate(c)` |
| `$request->session()->invalidate()` | `session.Invalidate(c)` |
| `Route::get('/profile', ...)->block(10, 10)` | `SESSION_LOCK_SECONDS=10` + `SESSION_LOCK_WAIT_SECONDS=10` |
| `Session::extend($name, $factory)` | `session.Extend(name, factory)` |
