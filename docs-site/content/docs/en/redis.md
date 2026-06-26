---
title: "Redis"
---

# Redis

- [Introduction](#introduction)
- [Configuration](#configuration)
  - [Basic Configuration](#basic-configuration)
  - [Connection Parameters](#connection-parameters)
  - [URL Connection](#url-connection)
  - [Advanced Connection Options](#advanced-connection-options)
  - [Environment Variables Reference](#environment-variables-reference)
- [Interacting With Redis](#interacting-with-redis)
  - [Obtaining a Client](#obtaining-a-client)
  - [Executing Redis Commands](#executing-redis-commands)
  - [Transactions](#transactions)
  - [Pipelining Commands](#pipelining-commands)
  - [Pub / Sub](#pub--sub)
- [Connection Management](#connection-management)
  - [Creating a Manager](#creating-a-manager)
  - [Obtaining Connections](#obtaining-connections)
  - [Multiple Connections](#multiple-connections)
  - [Connection Reuse and Caching](#connection-reuse-and-caching)
  - [Purging Connections](#purging-connections)
  - [Closing Connections](#closing-connections)
- [Events](#events)
  - [Event Types](#event-types)
  - [Global Event Listeners](#global-event-listeners)
  - [Connection-Level Listeners](#connection-level-listeners)
  - [Disabling Events](#disabling-events)
- [Container Integration](#container-integration)
  - [ServiceProvider Registration](#serviceprovider-registration)
  - [Container Resolution](#container-resolution)
  - [Lifecycle Shutdown](#lifecycle-shutdown)
- [Integration With Other Components](#integration-with-other-components)
  - [Cache Driver](#cache-driver)
  - [Queue Driver](#queue-driver)
  - [Horizon Storage](#horizon-storage)
- [Facade Reference](#facade-reference)
- [Manager Interface Reference](#manager-interface-reference)
- [Connection Interface Reference](#connection-interface-reference)
- [Event Types Reference](#event-types-reference)

---

## Introduction

PrismGo's Redis component provides unified Redis connection management and command event observation for your application. It serves as the shared infrastructure layer for framework components such as `cache`, `queue`, `session`, and `horizon`.

**Design philosophy:** PrismGo does not re-abstract the full Redis command set. Instead, it directly exposes the `go-redis` native `UniversalClient`. This means you can use all commands, pipelines, transactions, pub/sub, and Lua scripts that `go-redis` supports, while benefiting from PrismGo's connection lifecycle management, lazy loading, and command event dispatching.

All connections managed by PrismGo automatically install `go-redis` hooks that emit command success/failure events, making it easy for logging, monitoring, and Horizon to subscribe to these cross-cutting concerns.

## Configuration

### Basic Configuration

Redis connection configuration is stored under the `database.redis` key in your application's configuration file. The framework's `config/database.go` provides a default configuration structure:

```go
// config/database.go
"redis": map[string]interface{}{
    "client":  Env("REDIS_CLIENT", "go"),
    "options": map[string]interface{}{},
    "default": map[string]interface{}{
        "host":     Env("REDIS_HOST", "127.0.0.1"),
        "port":     Env("REDIS_PORT", "6379"),
        "username": Env("REDIS_USERNAME", ""),
        "password": Env("REDIS_PASSWORD", ""),
        "database": Env("REDIS_MAIN_DB", 1),
    },
    "cache": map[string]interface{}{
        "host":     Env("REDIS_HOST", "127.0.0.1"),
        "port":     Env("REDIS_PORT", "6379"),
        "username": Env("REDIS_USERNAME", ""),
        "password": Env("REDIS_PASSWORD", ""),
        "database": Env("REDIS_CACHE_DB", 0),
    },
},
```

The configuration structure has three levels:

| Level | Description |
|-------|-------------|
| `database.redis` | Top-level Redis configuration, containing `client`, `options`, and named connection definitions |
| `client` | Redis client implementation identifier. Currently supports `go` / `go-redis` / `redis` |
| `options` | Global options (reserved for future cluster or special client parameter extensions) |
| `{name}` | A named connection definition keyed by its name, e.g., `default`, `cache` |

### Connection Parameters

Each named connection supports the following parameters:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `host` | string | No | `127.0.0.1` | Redis host address. Combined with `port`; `addr` takes precedence if set |
| `port` | string | No | `6379` | Redis port number. Combined with `host` |
| `addr` | string | No | — | Full address in `host:port` format. Takes precedence over `host`/`port` |
| `url` | string | No | — | Redis URL connection string, supporting the full `redis://user:pass@host:port/db?key=val` format. Parsed internally via `go-redis.ParseURL` |
| `scheme` | string | No | — | Connection protocol. Set to `"tls"` to enable TLS encryption, useful for cloud services or TLS-required Redis instances |
| `username` | string | No | — | Redis ACL username. Used when Redis 6.0+ ACL is enabled |
| `password` | string | No | — | Redis authentication password. Can be empty when authentication is not enabled |
| `database` / `db` | int | No | `0` | Redis logical database number (0-15). Both `database` and `db` are valid; `db` takes precedence |
| `name` | string | No | — | Client name. When set, `CLIENT SETNAME` takes effect on connection establishment, useful for `CLIENT LIST` debugging |
| `timeout` | string | No | — | Connection timeout. Supports duration format (e.g., `"3s"`, `"500ms"`) or integer seconds. Maps to go-redis `DialTimeout` |
| `read_timeout` | string | No | — | Read timeout. Supports duration format or integer seconds. Maps to go-redis `ReadTimeout` |
| `write_timeout` | string | No | — | Write timeout. Supports duration format or integer seconds. Maps to go-redis `WriteTimeout` |
| `max_retries` | int | No | — | Maximum number of retries on command failure. Maps to go-redis `MaxRetries` |

**Parameter precedence rules:**

- **Address resolution**: `addr` > `host` + `port`. Even if an address is configured via URL, explicitly set `addr` or `host`/`port` will override the URL address
- **Database number**: `db` > `database`. Explicit `host`/`port`/`addr` or a non-zero `DB` field will override the database number from the URL
- **Username/Password**: Always override authentication information from the URL

### URL Connection

Instead of manually configuring host/port/db parameters, you can use a Redis URL string for one-step configuration:

```go
// config/database.go
"default": map[string]interface{}{
    "url":  Env("REDIS_URL", ""),
    "name": Env("REDIS_NAME", ""),
},
```

URL format example:

```
redis://user:password@127.0.0.1:6379/2?dial_timeout=3s&read_timeout=2s&write_timeout=2s&max_retries=3
```

Query parameters in the URL are parsed by `go-redis.ParseURL` into corresponding connection options.

### Advanced Connection Options

When you need to override native `go-redis` parameters, you can pass them through the `options` field in the connection configuration:

```go
"default": map[string]interface{}{
    "host": "10.0.0.8",
    "port": "6379",
    "database": 2,
    "options": map[string]interface{}{
        "name":          "my-app-client",
        "read_timeout":  "4s",
        "write_timeout": "5s",
        "timeout":       "6s",
        "max_retries":   5,
        "scheme":        "tls",
    },
},
```

### Environment Variables Reference

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `REDIS_CLIENT` | `go` | Redis client implementation identifier |
| `REDIS_HOST` | `127.0.0.1` | Default Redis host address |
| `REDIS_PORT` | `6379` | Default Redis port |
| `REDIS_USERNAME` | — | Default Redis ACL username |
| `REDIS_PASSWORD` | — | Default Redis password |
| `REDIS_URL` | — | Full URL for the default connection |
| `REDIS_SCHEME` | — | Default connection protocol (set to `tls` to enable encryption) |
| `REDIS_MAIN_DB` | `1` | Database number for the default connection |
| `REDIS_CACHE_DB` | `0` | Database number for the cache connection |
| `REDIS_NAME` | — | Client name for the default connection |
| `REDIS_CACHE_NAME` | — | Client name for the cache connection |
| `REDIS_TIMEOUT` | — | Timeout for the default connection |
| `REDIS_CACHE_TIMEOUT` | — | Timeout for the cache connection |
| `REDIS_READ_TIMEOUT` | — | Read timeout for the default connection |
| `REDIS_CACHE_READ_TIMEOUT` | — | Read timeout for the cache connection |
| `REDIS_WRITE_TIMEOUT` | — | Write timeout for the default connection |
| `REDIS_CACHE_WRITE_TIMEOUT` | — | Write timeout for the cache connection |
| `REDIS_MAX_RETRIES` | — | Max retries for the default connection |
| `REDIS_CACHE_MAX_RETRIES` | — | Max retries for the cache connection |

## Interacting With Redis

### Obtaining a Client

The simplest way to interact with Redis is through the Facade, which returns a `go-redis` native `UniversalClient`:

```go
package main

import (
    "context"
    redis "github.com/prismgo/framework/redis"
)

func main() {
    // Get the go-redis client for the default connection
    client, err := redis.Client()
    if err != nil {
        panic(err)
    }

    // Get the go-redis client for a named connection
    cacheClient, err := redis.Client("cache")
    if err != nil {
        panic(err)
    }
}
```

You can also obtain a `Connection` interface to access both the client and connection-level event listeners:

```go
// Get a Connection instance
conn, err := redis.Connection()
if err != nil {
    return err
}

// Access the underlying go-redis client
client := conn.Client()

// Access the connection name
fmt.Println(conn.Name()) // "default"
```

### Executing Redis Commands

Since the Facade returns a native `go-redis` `UniversalClient`, you can use all commands that `go-redis` supports:

```go
ctx := context.Background()

// String operations
err := client.Set(ctx, "user:1:name", "Taylor", 10*time.Minute).Err()
if err != nil {
    return err
}

name, err := client.Get(ctx, "user:1:name").Result()
if err != nil {
    return err
}
fmt.Println(name) // Taylor

// Hash operations
client.HSet(ctx, "user:1", "name", "Taylor", "age", "28")
username := client.HGet(ctx, "user:1", "name").Val()

// List operations
client.LPush(ctx, "queue:emails", "email_1", "email_2")
item := client.RPop(ctx, "queue:emails").Val()

// Set operations
client.SAdd(ctx, "tags:golang", "web", "api", "cli")
members := client.SMembers(ctx, "tags:golang").Val()

// Sorted set operations
client.ZAdd(ctx, "leaderboard", redis.Z{Score: 100, Member: "player_a"})
rank := client.ZRevRank(ctx, "leaderboard", "player_a").Val()

// Counters
count, _ := client.Incr(ctx, "page:views").Result()
countBy, _ := client.IncrBy(ctx, "page:views", 10).Result()

// Key operations
exists, _ := client.Exists(ctx, "user:1:name").Result()
client.Expire(ctx, "session:abc", 30*time.Minute)
client.Del(ctx, "temp:data")
```

Since the native `go-redis` API is exposed, you have access to its full command set, including advanced features like `Scan`, `Keys`, `Pub/Sub`, and Lua scripts.

### Transactions

Use `TxPipeline` to implement Redis transactions (MULTI/EXEC). All commands within the transaction are executed as a single atomic operation:

```go
pipe := client.TxPipeline()

incr := pipe.Incr(ctx, "counter")
pipe.Expire(ctx, "counter", time.Hour)

_, err := pipe.Exec(ctx)
if err != nil {
    return err
}

fmt.Println(incr.Val()) // Returns the incremented value
```

> **Note:** You cannot read values within a transaction before it executes, because all commands are sent together and executed only after `Exec` is called.

#### Lua Scripts

You can execute Lua scripts directly through the `go-redis` client for atomic conditional operations:

```go
// Define a Lua script that only sets a key if it doesn't exist
script := redis.NewScript(`
    if redis.call("exists", KEYS[1]) == 0 then
        redis.call("set", KEYS[1], ARGV[1])
        return 1
    end
    return 0
`)

result, err := script.Run(ctx, client, []string{"lock:order:42"}, "locked").Result()
if err != nil {
    return err
}
```

### Pipelining Commands

Pipelining allows you to send multiple commands to Redis in a single network round trip, significantly reducing latency when you need to execute many commands:

```go
pipe := client.Pipeline()

// Batch set cache entries
for _, user := range users {
    key := fmt.Sprintf("user:%d:profile", user.ID)
    data, _ := json.Marshal(user)
    pipe.Set(ctx, key, data, time.Hour)
}

// Execute the pipeline
cmds, err := pipe.Exec(ctx)
if err != nil {
    return err
}

// Check each command's result
for _, cmd := range cmds {
    if cmd.Err() != nil {
        log.Printf("pipeline command failed: %v", cmd.Err())
    }
}
```

> **Note:** When a Pipeline or TxPipeline executes successfully, PrismGo emits a `CommandBatchExecuted` event; on failure, it emits a `CommandBatchFailed` event. Individual command events are not emitted for batched operations.

### Pub / Sub

Since PrismGo exposes the native `go-redis` client, you can use its built-in pub/sub capabilities directly:

```go
// Publishing a message
err := client.Publish(ctx, "notifications", "New order received").Err()
if err != nil {
    return err
}
```

```go
// Subscribing to channels
sub := client.Subscribe(ctx, "notifications")
defer sub.Close()

// Wait for messages
ch := sub.Channel()
for msg := range ch {
    fmt.Printf("Received message on %s: %s\n", msg.Channel, msg.Payload)
}
```

```go
// Pattern subscription (psubscribe)
sub := client.PSubscribe(ctx, "orders:*")
defer sub.Close()

ch := sub.Channel()
for msg := range ch {
    fmt.Printf("Received message on %s: %s\n", msg.Channel, msg.Payload)
}
```

## Connection Management

### Creating a Manager

The Manager is the core component that manages Redis connections, lazily loading and caching them by name:

```go
import (
    configpkg "github.com/prismgo/framework/config"
    redis "github.com/prismgo/framework/redis"
)

// Method 1: Read from the config repository
repo := configpkg.Resolve()
cfg := redis.ConfigFromRepository(repo)
manager, err := redis.NewManager(cfg)
if err != nil {
    return err
}
defer manager.Close(context.Background())

// Method 2: Read strictly from the current Application Facade (recommended for providers)
manager, err := redis.NewManagerFromConfig()
if err != nil {
    return err
}

// Method 3: Construct configuration manually (for testing)
manager, err := redis.NewManager(redis.Config{
    DefaultName: "default",
    Connections: map[string]redis.ConnectionConfig{
        "default": {Name: "default", Host: "127.0.0.1", Port: "6379", DB: 0},
        "cache":   {Name: "cache", Host: "127.0.0.1", Port: "6379", DB: 1},
    },
})
```

**When to use each method:**

| Method | Use Case |
|--------|----------|
| `NewManager(cfg)` | Test code, manual configuration control |
| `NewManagerFromConfig()` | ServiceProvider registration, application startup paths |
| `ConfigFromRepository(repo)` | Reading from an existing config repository |

### Obtaining Connections

After creating a Manager, obtain connections by name. Connections are lazily created on first request:

```go
// Get the default connection
conn, err := manager.Connection()
if err != nil {
    return err
}

// Get the cache connection
cacheConn, err := manager.Connection("cache")
if err != nil {
    return err
}

// Get the default connection (explicit)
defaultConn, err := manager.DefaultConnection()
if err != nil {
    return err
}

// Get the native go-redis client
client := conn.Client()

// Get the connection name
fmt.Println(conn.Name()) // "default"
```

> **Lazy loading guarantee:** `NewManager` only validates configuration and does not connect to Redis. The actual `go-redis` client is created only when `Connection(name)` is first called. This means the ServiceProvider registration phase has no network side effects.

### Multiple Connections

You can manage multiple Redis connections in the same application, isolating databases by function:

```go
// Default connection stores business data (DB 1)
mainClient, _ := redis.Client() // Uses "default"

// Cache connection stores cache data (DB 0)
cacheClient, _ := redis.Client("cache")

// Extend with more connections as needed (must be defined in configuration first)
```

Define additional connections in `config/database.go`:

```go
"redis": map[string]interface{}{
    "default": map[string]interface{}{
        "host": Env("REDIS_HOST", "127.0.0.1"),
        "port": Env("REDIS_PORT", "6379"),
        "database": 1,
    },
    "cache": map[string]interface{}{
        "host": Env("REDIS_HOST", "127.0.0.1"),
        "port": Env("REDIS_PORT", "6379"),
        "database": 0,
    },
    "session": map[string]interface{}{
        "host": Env("REDIS_HOST", "127.0.0.1"),
        "port": Env("REDIS_PORT", "6379"),
        "database": 2,
    },
},
```

### Connection Reuse and Caching

Connections with the same name are cached after first creation. Subsequent calls return the cached connection object:

```go
conn1, _ := manager.Connection("cache")
conn2, _ := manager.Connection("cache")

// conn1 and conn2 are the same connection object
fmt.Println(conn1 == conn2) // true
```

You can inspect currently resolved connections via `Connections()`:

```go
for name, conn := range manager.Connections() {
    log.Printf("Connection: %s, Client: %T", name, conn.Client())
}
```

> **Note:** `Connections()` only returns connections that have already been resolved via `Connection()` / `DefaultConnection()`. It does not create new connections for the snapshot.

### Purging Connections

The `Purge` method closes and removes a named connection. The next call to `Connection` will read the current configuration and create a fresh connection:

```go
// Close and remove the cache connection
if err := manager.Purge("cache"); err != nil {
    return err
}

// A new go-redis client will be created on next access
newConn, err := manager.Connection("cache")
if err != nil {
    return err
}
```

> **Use cases:** Test isolation, configuration hot-reload, forced reconnection after connection errors.

### Closing Connections

`Close` shuts down all resolved Redis connections. It is typically called during application shutdown:

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

if err := manager.Close(ctx); err != nil {
    log.Printf("Error closing Redis connections: %v", err)
}
```

**Closing behavior:**

- Only closes connections that have already been resolved; does not create unresolved connections just to close them
- If a connection fails to close, it continues attempting to close remaining connections and returns the first error encountered
- When the context is cancelled, already-closed connections are removed, while unclosed connections are retained for subsequent retry

## Events

Redis connections managed by PrismGo automatically dispatch command events through `go-redis` hooks, enabling logging, metrics, and Horizon to subscribe to these cross-cutting concerns.

### Event Types

| Event Name | Constant | Triggered When |
|------------|----------|----------------|
| `redis.command_executed` | `EventCommandExecuted` | A single Redis command executes successfully |
| `redis.command_failed` | `EventCommandFailed` | A single Redis command execution fails |
| `redis.command_batch_executed` | `EventCommandBatchExecuted` | A Pipeline/TxPipeline executes successfully |
| `redis.command_batch_failed` | `EventCommandBatchFailed` | A Pipeline/TxPipeline execution fails |

**Command success event structure:**

```go
type CommandExecuted struct {
    Command        string        // Command name, e.g., "get", "set", "del"
    Parameters     []any         // Command parameter snapshot (excluding the command name itself)
    Time           time.Duration // Command execution duration
    Connection     Connection    // The connection that produced the event
    ConnectionName string        // Connection name snapshot (e.g., "default", "cache")
}
```

**Command failure event structure:**

```go
type CommandFailed struct {
    Command        string      // Command name
    Parameters     []any       // Command parameter snapshot
    Error          error       // Original error returned by go-redis
    Connection     Connection  // The connection that produced the event
    ConnectionName string      // Connection name snapshot
}
```

**Batch command event structures:**

```go
type CommandBatchExecuted struct {
    Commands       []CommandSnapshot // Snapshot of each command in the batch
    Time           time.Duration     // Total batch execution duration
    Connection     Connection        // The connection that produced the event
    ConnectionName string            // Connection name snapshot
}

type CommandBatchFailed struct {
    Commands       []CommandSnapshot // Snapshot of each command in the batch
    Error          error             // Original error returned by go-redis
    Connection     Connection        // The connection that produced the event
    ConnectionName string            // Connection name snapshot
}
```

> **Security note:** Event parameters are not sanitized (aligned with Laravel behavior). If your listeners forward events to logs, metrics, or external monitoring, you must handle sensitive parameter filtering (e.g., passwords, tokens) yourself.

### Global Event Listeners

Through PrismGo's event system EventSink, Redis command events are bridged to the application event bus. The `RedisServiceProvider` automatically installs this bridge during the Boot phase, so you can register global event listeners in your application code:

```go
// Listen for Redis command success events
event.Listen(redis.EventCommandExecuted, func(ctx context.Context, ev eventcontract.Event) error {
    executed := ev.(redis.CommandExecutedEvent)
    log.Printf("Redis command executed: %s on %s, duration %s",
        executed.Command, executed.ConnectionName, executed.Time)
    return nil
})

// Listen for Redis command failure events
event.Listen(redis.EventCommandFailed, func(ctx context.Context, ev eventcontract.Event) error {
    failed := ev.(redis.CommandFailedEvent)
    log.Printf("Redis command failed: %s on %s, error: %v",
        failed.Command, failed.ConnectionName, failed.Error)
    return nil
})

// Listen for batch command events
event.Listen(redis.EventCommandBatchExecuted, func(ctx context.Context, ev eventcontract.Event) error {
    batch := ev.(redis.CommandBatchExecutedEvent)
    log.Printf("Pipeline succeeded: %d commands, duration %s",
        len(batch.Commands), batch.Time)
    return nil
})
```

### Connection-Level Listeners

In addition to global events, you can register listeners on individual connections. This is useful for testing and localized observation:

```go
conn, _ := manager.Connection("cache")

// Register a success listener
conn.Listen(func(ctx context.Context, ev redis.CommandExecuted) {
    fmt.Printf("[%s] %s %v -> duration %v\n",
        ev.ConnectionName, ev.Command, ev.Parameters, ev.Time)
})

// Register a failure listener
conn.ListenForFailures(func(ctx context.Context, ev redis.CommandFailed) {
    fmt.Printf("[%s] %s %v -> error: %v\n",
        ev.ConnectionName, ev.Command, ev.Parameters, ev.Error)
})

// Execute commands - listeners are triggered automatically
client := conn.Client()
client.Set(ctx, "key", "value", 0)
client.Get(ctx, "key")
```

> **Listener panic protection:** Panics inside listeners are caught and reported to `exception.handler`. They do not affect the normal return of Redis command results.

### Disabling Events

In high-throughput batch processing or testing scenarios, you can disable events to reduce overhead:

```go
// Disable events - go-redis commands still execute normally
manager.DisableEvents()

// Re-enable events
manager.EnableEvents()
```

> **Note:** The event toggle affects all currently created connections. After toggling, both existing and newly created connections inherit the Manager's current state.

## Container Integration

### ServiceProvider Registration

`RedisServiceProvider` is a default framework Provider that automatically registers the Redis Factory in the container:

```go
// ServiceProvider.Register phase:
// - Registers "redis" -> Manager (lazy-loaded, does not connect to Redis)
// - Registers "redis.connection" -> default Connection (lazy-loaded)

// ServiceProvider.Boot phase:
// - Installs EventSink to bridge Redis events to the event bus
```

Business applications do not need to register manually. The framework automatically loads the provider in the `bootstrap/app.go` providers list.

### Container Resolution

You can resolve Redis dependencies from the container as needed:

```go
import (
    "github.com/prismgo/framework/container"
    rediscontract "github.com/prismgo/framework/contracts/redis"
)

// Resolve the Redis Factory
factory, err := container.Make[rediscontract.Factory]("redis")
if err != nil {
    return err
}

// Resolve the default connection
conn, err := container.Make[rediscontract.Connection]("redis.connection")
if err != nil {
    return err
}

// Get a specific connection
cacheConn, err := factory.Connection("cache")
if err != nil {
    return err
}
```

### Lifecycle Shutdown

When the container shuts down, the Manager's `Close` method is automatically called (registered via `container.WithContextCloser`):

```go
// On application exit
container.Close(context.Background())
// -> Manager.Close(ctx) is called automatically -> closes all resolved connections
```

## Integration With Other Components

### Cache Driver

The Cache component references a Redis connection name via the `connection` field:

```go
// config/cache.go
"redis": map[string]interface{}{
    "driver":     "redis",
    "prefix":     Env("CACHE_REDIS_PREFIX", "redis"),
    "connection": Env("CACHE_REDIS_CONNECTION", "cache"),
    "events":     Env("CACHE_REDIS_EVENTS", true),
},
```

The `github.com/prismgo/framework/cache` Redis Store obtains the `"cache"` connection through the Facade:

```go
client, _ := redis.Client("cache")
```

The cache component provides full Redis-based caching capabilities, including:
- Basic read/write (Get / Put / Forget)
- TTL management (Touch / Persist)
- Atomic operations (Add / Increment / Pull)
- Bulk operations (GetMany / PutMany / ForgetMany)
- Tagged cache (GetTagged / PutTagged / ForgetTagged / FlushTags)
- Prefix-based flush (Flush)

### Queue Driver

The Queue component references a Redis connection in its configuration:

```go
// config/queue.go
"redis": map[string]interface{}{
    "driver":     "redis",
    "connection": "default",
    "queue":      "default",
    "retry_after": 90,
    "block_for":   0,
},
```

`github.com/prismgo/framework/queue/redis` uses Redis List + Sorted Set to implement the task queue:
- Immediate tasks are pushed via `RPUSH` to the ready list
- Delayed tasks are stored via `ZADD` in a delayed sorted set, migrated by Lua script on expiry
- Workers wait via `BLPOP` to reduce idle polling
- Failed tasks are stored in a failed store

### Horizon Storage

The Horizon component uses an independent key schema to persist runtime state to Redis:

```go
// config/horizon.go
"redis": map[string]interface{}{
    "connection": Env("HORIZON_REDIS_CONNECTION", ""),
},
```

Horizon Redis Store manages data including:
- Master / Supervisor / Worker heartbeats and leases
- Global control flags (pause, terminate)
- Event metric windows (EventMetricWindows)
- Queue length snapshots
- Batch safety summaries
- High-value task diagnostic details
- Observability diagnostic data
- Orphan process tracking

## Facade Reference

The Facade provides static methods that resolve Redis capabilities from the global container:

| Method | Signature | Description |
|--------|-----------|-------------|
| `Resolve` | `Resolve() rediscontract.Factory` | Returns the Redis Factory bound to the current Application. Returns `nil` if the container is not ready |
| `ManagerInstance` | `ManagerInstance() *Manager` | Returns the concrete Manager instance bound to the current Application |
| `Connection` | `Connection(name ...string) (rediscontract.Connection, error)` | Resolves a named connection; returns the default connection if no name is provided |
| `Client` | `Client(name ...string) (goredis.UniversalClient, error)` | Shortcut: directly returns the go-redis client |
| `ManagerCloseOption` | `ManagerCloseOption() containercontract.BindingOption` | Returns container close options for bootstrap registration |

## Manager Interface Reference

The Manager implements the `rediscontract.Factory` interface:

| Method | Signature | Description |
|--------|-----------|-------------|
| `Connection` | `Connection(name ...string) (rediscontract.Connection, error)` | Lazily loads a connection by name; connections are cached after creation |
| `DefaultConnection` | `DefaultConnection() (rediscontract.Connection, error)` | Explicitly gets the default connection |
| `Connections` | `Connections() map[string]rediscontract.Connection` | Returns a read-only snapshot of resolved connections |
| `Purge` | `Purge(name ...string) error` | Closes and removes a named connection; it will be rebuilt on next resolution |
| `EnableEvents` | `EnableEvents()` | Enables command event dispatching |
| `DisableEvents` | `DisableEvents()` | Disables command event dispatching |
| `Close` | `Close(ctx context.Context) error` | Closes all resolved connections |

## Connection Interface Reference

A Connection represents a named Redis connection, implementing the `rediscontract.Connection` interface:

| Method | Signature | Description |
|--------|-----------|-------------|
| `Name` | `Name() string` | Returns the connection name from configuration (e.g., `"default"`, `"cache"`) |
| `Client` | `Client() goredis.UniversalClient` | Exposes the native go-redis client, supporting all Redis commands |
| `Listen` | `Listen(func(context.Context, CommandExecuted))` | Registers a success command listener |
| `ListenForFailures` | `ListenForFailures(func(context.Context, CommandFailed))` | Registers a failure command listener |

## Event Types Reference

| Type | Package Alias | Description |
|------|--------------|-------------|
| `CommandExecuted` | `redis.CommandExecuted` | Alias for `contracts/redis.CommandExecuted` |
| `CommandFailed` | `redis.CommandFailed` | Alias for `contracts/redis.CommandFailed` |
| `CommandSnapshot` | `redis.CommandSnapshot` | Alias for `contracts/redis.CommandSnapshot` |
| `CommandBatchExecuted` | `redis.CommandBatchExecuted` | Alias for `contracts/redis.CommandBatchExecuted` |
| `CommandBatchFailed` | `redis.CommandBatchFailed` | Alias for `contracts/redis.CommandBatchFailed` |

**Event bus wrapper types (dispatched with event names):**

| Type | Event Name Constant |
|------|---------------------|
| `CommandExecutedEvent` | `redis.command_executed` |
| `CommandFailedEvent` | `redis.command_failed` |
| `CommandBatchExecutedEvent` | `redis.command_batch_executed` |
| `CommandBatchFailedEvent` | `redis.command_batch_failed` |
