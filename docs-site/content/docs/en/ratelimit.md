---
title: "Rate Limiting"
---

# Rate Limiting

- [Feature Overview](#feature-overview)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Quick Start](#quick-start)
- [Named Limiters](#named-limiters)
- [Limit Builders](#limit-builders)
- [Limit Chain Methods](#limit-chain-methods)
- [Gin Middleware](#gin-middleware)
- [Compatibility Through the route Package](#compatibility-through-the-route-package)
- [Manual Counting API](#manual-counting-api)
- [Hashed Keys](#hashed-keys)
- [Key Design](#key-design)
- [How It Works](#how-it-works)
- [Error Handling](#error-handling)
- [Boundaries Compared With Laravel 13](#boundaries-compared-with-laravel-13)

`github.com/prismgo/framework/ratelimit` provides Laravel RateLimiter-style fixed-window rate limiting. It stores limiter state through `github.com/prismgo/framework/cache`, reuses the existing memory / redis cache configuration, and exposes both Gin middleware and manual counting APIs.

This document follows the capability model of Laravel 13 Rate Limiting: configuration, usage, named limiters, middleware, manual counting APIs, and best practices. PrismGo keeps Go's explicit `context.Context`, `time.Duration`, and error-return semantics.

## Feature Overview

| Capability | PrismGo entry point | Laravel equivalent |
| --- | --- | --- |
| Named limiters | `ratelimit.For("login", fn)` | `RateLimiter::for("login", fn)` |
| Middleware | `middleware.Throttle("login")` | `throttle:login` middleware |
| Fixed windows | `PerMinute(5)` / `Every(30s, 10)` | `Limit::perMinute(5)` |
| Per-dimension limits | `By("user:" + userID)` | `->by($request->user()->id)` |
| After-response counting | `After(fn)` | `->after(fn)` |
| Custom responses | `Response(fn)` | `->response(fn)` |
| Manual counting | `Hit` / `Increment` / `Attempts` | `RateLimiter::hit()` / `->attempts()` |
| Atomic operation | `Attempt` | `RateLimiter::attempt()` |
| Response headers | `X-RateLimit-Limit` / `Remaining` / `Retry-After` | Aligned with Laravel headers |

## Architecture

The rate limiting module depends on the following layers:

```text
routes/api.go
  -> github.com/prismgo/framework/http/middleware
  -> github.com/prismgo/framework/ratelimit
  -> github.com/prismgo/framework/cache (memory / redis / file / failover store)
```

- **Route layer**: attaches middleware such as `middleware.Throttle("login")` in `routes/api.go`.
- **Middleware layer**: converts named limiters into Gin middleware, writes headers, and returns over-limit responses.
- **Limiter core**: manages named limiter registration, fixed-window counting, and manual APIs.
- **Cache layer**: persists limiter state through `github.com/prismgo/framework/cache`; `memory` is single-process, while `redis` works across instances.

## Configuration

### Environment Variables

The cache store used by the limiter is controlled by `CACHE_LIMITER_DRIVER`:

```dotenv
# Default cache store, used as the limiter fallback
CACHE_STORE=memory

# Dedicated cache store name for rate limiting
# When empty, falls back to CACHE_STORE
CACHE_LIMITER_DRIVER=memory

# Redis configuration when Redis is used for limiter state
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_CACHE_DB=0
```

### Configuration Items

| Item | Environment variable | Default | Description |
| --- | --- | --- | --- |
| `cache.default` | `CACHE_STORE` | `memory` | Default cache store, used when no dedicated limiter store is configured |
| `cache.limiter.driver` | `CACHE_LIMITER_DRIVER` | `memory` | Dedicated limiter cache store name; configured independently from `cache.default` |

Limiter store resolution priority:

1. If `cache.limiter.driver` is non-empty, use that store.
2. If `cache.limiter.driver` is empty, fall back to `cache.default`.

For production multi-instance deployments, set `CACHE_LIMITER_DRIVER=redis` so limiter state is shared by all instances. With the `memory` driver, limits only apply to the current process.

```dotenv
CACHE_STORE=memory
CACHE_LIMITER_DRIVER=redis
REDIS_HOST=redis-cluster.internal
REDIS_PORT=6379
REDIS_CACHE_DB=2
```

Limiter configuration is registered in `config/cache.go`:

```go
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

## Quick Start

The application initializes the cache service provider at startup. `ratelimit` automatically uses the store specified by `cache.limiter.driver`, or the default cache store when no limiter-specific store is configured.

Register a named limiter in a service provider:

```go
func (p RateLimitServiceProvider) Boot(app providercontract.Application) error {
    ratelimit.For("login", func(c *gin.Context) []ratelimit.Limit {
        return []ratelimit.Limit{
            ratelimit.PerMinute(5).By(c.ClientIP()),
        }
    })
    return nil
}
```

Attach it to a route:

```go
func RegisterRoutes(route *gin.RouterGroup) {
    route.POST("/auth/login", httpmiddleware.Throttle("login"), loginHandler)
}
```

For standalone programs or tests, create an explicit limiter:

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
ratelimit.Use(limiter)
```

## Named Limiters

Named limiters are registered with `For` and referenced by name from middleware:

```go
ratelimit.For("login", func(c *gin.Context) []ratelimit.Limit {
    return []ratelimit.Limit{
        ratelimit.PerMinute(5).By(c.ClientIP()),
    }
})
```

- `name`: short semantic name such as `login`, `api`, or `sms`.
- `limiter`: a `LimiterFunc` that receives `*gin.Context` and returns a list of `Limit` rules.

Read a registered limiter:

```go
registered := ratelimit.Limiter("login")
```

If the name exists, the corresponding `LimiterFunc` is returned. If it is not registered, `nil` is returned, and middleware will allow the request through.

A named limiter may return multiple rules. Each rule is counted independently, and any over-limit rule blocks the request:

```go
ratelimit.For("api", func(c *gin.Context) []ratelimit.Limit {
    userID := c.GetString("user_id")

    return []ratelimit.Limit{
        ratelimit.PerMinute(60).By("user:" + userID),
        ratelimit.PerMinute(300).By("ip:" + c.ClientIP()),
    }
})
```

## Limit Builders

`Limit` describes one fixed-window limiter rule. It is created by builders and configured with chain methods.

```go
type Limit struct {
    MaxAttempts  int
    Decay        time.Duration
    Key          string
    Fallback     string
    AfterFunc    AfterFunc
    ResponseFunc ResponseFunc
}
```

| Builder | Signature | Description |
| --- | --- | --- |
| `Every` | `Every(decay time.Duration, maxAttempts int) Limit` | Custom window length and maximum attempts |
| `PerSecond` | `PerSecond(maxAttempts int) Limit` | At most `maxAttempts` per second |
| `PerMinute` | `PerMinute(maxAttempts int) Limit` | At most `maxAttempts` per minute |
| `PerMinutes` | `PerMinutes(decayMinutes int, maxAttempts int) Limit` | At most `maxAttempts` per `decayMinutes` minutes |
| `PerHour` | `PerHour(maxAttempts int) Limit` | At most `maxAttempts` per hour |
| `PerDay` | `PerDay(maxAttempts int) Limit` | At most `maxAttempts` per day |
| `None` | `None() Limit` | Disable a rule; `MaxAttempts` and `Decay` are zero |

Examples:

```go
ratelimit.Every(30*time.Second, 10).By("sms:phone:13800138000")
ratelimit.PerSecond(2).By("webhook:tenant:1")
ratelimit.PerMinutes(10, 20).By("export:user:42")
ratelimit.PerHour(100).By("api:tenant:8")
ratelimit.PerDay(1000).By("report:tenant:8")
```

## Limit Chain Methods

### By

`By` sets the limiter dimension key. Different keys are counted independently.

```go
ratelimit.PerMinute(5).By("login:ip:" + c.ClientIP())
ratelimit.PerHour(100).By("tenant:" + c.GetString("tenant_id"))
```

The key should include business meaning and isolation dimensions such as IP, user ID, or tenant ID.

### FallbackKey

`FallbackKey` sets a backup key for the same rule. When multiple rules in one named limiter use the same key, middleware can use the fallback key for later rules to avoid counter conflicts.

```go
ratelimit.For("mixed", func(c *gin.Context) []ratelimit.Limit {
    return []ratelimit.Limit{
        ratelimit.PerMinute(10).By("same"),
        ratelimit.PerMinute(20).By("same").FallbackKey("same:fallback"),
    }
})
```

### After

`After` delays counting until the business handler has finished. The attempt is recorded only when the callback returns `true`.

```go
ratelimit.PerMinute(10).
    By("login:" + c.ClientIP()).
    After(func(c *gin.Context) bool {
        return c.Writer.Status() == http.StatusUnauthorized
    })
```

This is useful when only failed responses should be counted. Without `After`, the attempt is counted before the handler runs.

### Response

`Response` sets a custom response for over-limit requests. Without it, the default response is `{"message":"too many requests"}`.

```go
ratelimit.PerMinute(5).
    By("sms:" + phone).
    Response(func(c *gin.Context, result ratelimit.Result) {
        c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
            "message":     "too many requests, please try again later",
            "retry_after": result.RetryAfter,
        })
    })
```

The callback receives `*gin.Context` and `Result`, and should abort the request itself.

### Result

`Result` carries runtime limiter check information:

```go
type Result struct {
    Limit       Limit
    Key         string
    MaxAttempts int
    Attempts    int64
    Remaining   int
    RetryAfter  int
    ResetAt     int64
}
```

## Gin Middleware

Use the global limiter:

```go
route.Post("/auth/login", httpmiddleware.Throttle("login"), loginHandler)
```

Use an explicit limiter instance in tests or standalone programs:

```go
limiter := ratelimit.New(cache.Default())
router.POST("/auth/login", httpmiddleware.ThrottleFor(limiter, "login"), loginHandler)
```

Middleware flow:

1. Look up the named limiter. If it is not registered, call `c.Next()`.
2. Execute the limiter function and get `[]Limit`.
3. For each rule, skip disabled rules, build the cache key, check over-limit state, and record attempts immediately or after the handler.
4. On over-limit, write `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`, and `X-RateLimit-Reset`, then return the custom response or default `429`.
5. If all rules pass, write success headers and continue to the next handler.

Default over-limit response:

```json
{"message":"too many requests"}
```

Response headers:

| Header | Description | When returned |
| --- | --- | --- |
| `X-RateLimit-Limit` | Maximum attempts for the current rule | Always |
| `X-RateLimit-Remaining` | Remaining attempts in the current window | Always |
| `Retry-After` | Seconds to wait after exceeding the limit | Only over-limit |
| `X-RateLimit-Reset` | Unix timestamp when the key becomes available | Only over-limit |

When a named limiter returns multiple rules, successful responses use the rule with the smallest remaining count for `X-RateLimit-Limit` and `X-RateLimit-Remaining`.

Middleware can be attached to groups:

```go
route.Prefix("/api/v1").
    Middleware(httpmiddleware.Throttle("api")).
    Group(func() {
        route.Get("/profile", profileHandler)
        route.Get("/orders", ordersHandler)
    })
```

## Compatibility Through the route Package

`github.com/prismgo/framework/route` keeps the older rate limiting style and delegates internally to `github.com/prismgo/framework/ratelimit`. New code should prefer `ratelimit.For` and `middleware.Throttle`, but existing code may continue using the route package:

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

| Feature | `route.Limit` | `ratelimit.Limit` |
| --- | --- | --- |
| Key setup | `By(func(*gin.Context) string)` | `By(string)` |
| Window builders | `PerMinute` only | `Every` / `PerSecond` / `PerMinute` / `PerMinutes` / `PerHour` / `PerDay` |
| After-response counting | Not supported | `After` |
| Custom response | Not supported | `Response` |
| Fallback key | Not supported | `FallbackKey` |

## Manual Counting API

All manual methods have package-level facade versions that use the global limiter:

```go
ratelimit.Hit(ctx, key, decay)
ratelimit.TooManyAttempts(ctx, key, maxAttempts)
ratelimit.Attempts(ctx, key)
```

Explicit limiter instances expose the same methods:

```go
limiter.Hit(ctx, key, decay)
limiter.TooManyAttempts(ctx, key, maxAttempts)
```

### Hit

Records one attempt and returns the current attempt count:

```go
count, err := ratelimit.Hit(ctx, "login:ip:127.0.0.1", time.Minute)
```

If `decay <= 0`, the default window is one minute.

### Increment / Decrement

`Increment` increases attempts by the given amount. Without an amount, it increments by one.

```go
count, err := ratelimit.Increment(ctx, "export:user:42", time.Hour, 3)
```

`Decrement` decreases attempts by the given amount. Without an amount, it decrements by one.

```go
count, err := ratelimit.Decrement(ctx, "export:user:42", 1)
```

### Attempts

Returns the current attempt count for a key. Missing keys return `0`.

```go
attempts, err := ratelimit.Attempts(ctx, "login:ip:127.0.0.1")
```

### TooManyAttempts

Checks whether the key has reached the maximum attempts:

```go
limited, err := ratelimit.TooManyAttempts(ctx, "login:ip:127.0.0.1", 5)
if limited {
    return errors.New("too many attempts")
}
```

If `maxAttempts <= 0`, it returns `false`. When the count has reached the limit, the timer key is checked: if it exists, the request is still limited; if it is missing, the window has expired and the count is cleaned up.

### Remaining / RetriesLeft

Returns the remaining attempts in the current window. `RetriesLeft` is an alias of `Remaining`.

```go
remaining, err := ratelimit.Remaining(ctx, "login:ip:127.0.0.1", 5)
retries, err := ratelimit.RetriesLeft(ctx, "login:ip:127.0.0.1", 5)
```

### AvailableIn

Returns the number of seconds until the key becomes available again:

```go
retryAfter, err := ratelimit.AvailableIn(ctx, "login:ip:127.0.0.1")
```

If the key is already available, it returns `0`.

### ResetAttempts / Clear

`ResetAttempts` clears the attempt count but keeps the timer:

```go
err := ratelimit.ResetAttempts(ctx, "login:ip:127.0.0.1")
```

`Clear` removes both attempts and timer, making the key immediately available:

```go
err := ratelimit.Clear(ctx, "login:ip:127.0.0.1")
```

Use `Clear` after verification succeeds, in tests, or when an administrator manually unblocks a subject.

### Attempt

`Attempt` runs a callback only when the key is not over the limit. It counts the attempt only after the callback succeeds. Callback errors are not counted.

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
```

It returns the callback value, whether the callback ran and succeeded, and any callback or cache error.

### CleanRateLimiterKey

Removes control characters from a key, preventing invalid characters from reaching the cache backend:

```go
key := ratelimit.CleanRateLimiterKey(" login\nip\t127.0.0.1 ")
// key == "loginip127.0.0.1"
```

## Hashed Keys

`ShouldHashKeys(true)` makes middleware-generated dimension keys use SHA1 hashes. This is useful for hiding emails, phone numbers, tokens, and other sensitive values.

```go
ratelimit.ShouldHashKeys(true)
```

This only affects keys generated by middleware through `MiddlewareKey`. It does not affect keys manually passed to `Hit`, `Increment`, `Attempt`, and similar methods.

## Key Design

Limiter keys should include business meaning and necessary isolation dimensions:

```text
{business}:{dimension}:{value}
```

| Scenario | Key example | Description |
| --- | --- | --- |
| Login protection | `login:ip:127.0.0.1` | Limit by IP |
| Login protection by user | `login:user:42` | Limit by user ID |
| SMS verification | `sms:phone:13800138000` | Limit by phone number |
| Export operation | `export:tenant:8:user:42` | Limit by tenant and user |
| Webhook | `webhook:tenant:8:ip:127.0.0.1` | Limit by tenant and IP |
| API calls | `api:tenant:8:user:42` | Limit by tenant and user |

Design principles:

- Include `tenant_id` for multi-tenant APIs so tenants do not affect each other.
- Make the dimension explicit: `By("user:" + userID)` is clearer than `By(userID)`.
- Use different business prefixes to avoid collisions between features.
- Keep keys readable for debugging, with `:` between segments.

## How It Works

Each limiter key maps to two cache entries:

| Cache key | Purpose |
| --- | --- |
| `{key}` | Attempt count in the current window |
| `{key}:timer` | Unix timestamp when the current window becomes available |

Check flow:

1. Read the current attempt count from `{key}`.
2. If the count is below the limit, allow the request and increment the count.
3. If the count has reached the limit, check `{key}:timer`.
4. If the timer exists, reject the request. If it does not, clean up the count and allow the request.

Middleware cache keys use this format:

```text
ratelimit:{name}:{dimension_key}
```

When `ShouldHashKeys(true)` is enabled, the `dimension_key` segment is replaced by a SHA1 hash. Manual API keys are controlled by the caller.

## Error Handling

All methods that read or write cache state return `error`. Common causes include unregistered stores, incomplete Redis configuration, Redis connection failures, and non-integer values written into counter keys by other code.

Recommended pattern:

```go
limited, err := ratelimit.TooManyAttempts(ctx, key, 5)
if err != nil {
    // Decide whether to fail open or closed based on business and security needs.
    return err
}
if limited {
    retryAfter, _ := ratelimit.AvailableIn(ctx, key)
    return fmt.Errorf("too many attempts, retry after %d seconds", retryAfter)
}
```

## Boundaries Compared With Laravel 13

PrismGo aligns with the core Laravel 13 Rate Limiting experience, but it is not a line-by-line copy:

- All PrismGo operations explicitly receive `context.Context`, and TTLs use `time.Duration`.
- `Attempt` does not count failed callbacks, matching Laravel behavior.
- `After` matches Laravel `Limit::after`: counting is decided after the handler runs.
- `Response` matches Laravel `Limit::response`.
- Multi-rule limiters use the same strategy: any over-limit rule blocks the request.
- Response headers align with Laravel: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`, and `X-RateLimit-Reset`.
- PrismGo currently does not support Laravel's `Limit::perSecond` decay-argument variant; `PerSecond` is fixed to one second.
- PrismGo returns seconds from `AvailableIn`, not a `Carbon` object.
