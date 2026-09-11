# Queue

- [Introduction](#introduction)
  - [Connections vs. Queues](#connections-vs-queues)
  - [Driver Prerequisites](#driver-prerequisites)
- [Configuration](#configuration)
  - [Config File](#config-file)
  - [Configuration Parameters](#configuration-parameters)
  - [RabbitMQ Configuration](#rabbitmq-configuration)
- [Creating Jobs](#creating-jobs)
  - [Job Structure](#job-structure)
  - [Job Strategy Interfaces](#job-strategy-interfaces)
  - [Unique Jobs](#unique-jobs)
  - [Debounced Jobs](#debounced-jobs)
  - [Encrypted Jobs](#encrypted-jobs)
- [Job Middleware](#job-middleware)
  - [Rate Limiting](#rate-limiting)
  - [Preventing Job Overlaps](#preventing-job-overlaps)
  - [Throttling Exceptions](#throttling-exceptions)
  - [Skipping Jobs](#skipping-jobs)
  - [Custom Middleware](#custom-middleware)
- [Dispatching Jobs](#dispatching-jobs)
  - [Delayed Dispatching](#delayed-dispatching)
  - [Synchronous Dispatching](#synchronous-dispatching)
  - [Job Chaining](#job-chaining)
  - [Customizing The Queue and Connection](#customizing-the-queue-and-connection)
  - [Specifying Max Job Attempts / Timeout Values](#specifying-max-job-attempts--timeout-values)
  - [Error Handling](#error-handling)
- [Job Batching](#job-batching)
  - [Dispatching Batches](#dispatching-batches)
  - [Inspecting Batches](#inspecting-batches)
  - [Cancelling Batches](#cancelling-batches)
- [Running The Queue Worker](#running-the-queue-worker)
  - [The queue:work Command](#the-queuework-command)
  - [Queue Priorities](#queue-priorities)
  - [Queue Workers and Deployment](#queue-workers-and-deployment)
  - [Job Expirations and Timeouts](#job-expirations-and-timeouts)
- [Dealing With Failed Jobs](#dealing-with-failed-jobs)
  - [Cleaning Up After Failed Jobs](#cleaning-up-after-failed-jobs)
  - [Retrying Failed Jobs](#retrying-failed-jobs)
  - [Failed Job Events](#failed-job-events)
- [Lifecycle Events](#lifecycle-events)
- [Encrypted Payloads](#encrypted-payloads)
- [Custom Drivers](#custom-drivers)
- [Error Constants](#error-constants)
- [Connection Capability Matrix](#connection-capability-matrix)
- [Laravel Queue Mapping](#laravel-queue-mapping)

---

## Introduction

PrismGo's queue component provides a unified, Laravel-style queue abstraction over multiple backend transports. The framework includes the sync and Redis transports; RabbitMQ is provided by the separate `github.com/prismgo/rabbitmq` module. Business code dispatches jobs through the `queue` facade; a long-running worker process consumes and executes them.

For full worker, failed-job, and restart command options, see [Commands: Queue Commands](commands.md#queue-commands).

All operations accept `context.Context`, use `time.Duration` for timeouts and delays, and return `error`.

### Connections vs. Queues

A **connection** represents a backend transport (Redis, RabbitMQ, sync). Each connection has a driver and its own configuration.

A **queue** is a named lane within a connection. You may dispatch to different queues on the same connection to implement priority lanes or workload isolation.

The default connection is set by `QUEUE_CONNECTION`. The default queue name is set per-connection (typically `"default"`).

### Driver Prerequisites

| Driver | Prerequisite |
|--------|-------------|
| `sync` | None — jobs execute immediately in the current goroutine |
| `redis` | A running Redis server; the `github.com/prismgo/framework/redis` package configured |
| `rabbitmq` | The `github.com/prismgo/rabbitmq` extension and a running RabbitMQ broker |

### Installing the RabbitMQ Extension

```bash
go get github.com/prismgo/rabbitmq
```

Register the extension between PrismGo's default providers and your application providers:

```go
import "github.com/prismgo/rabbitmq"

app := foundation.Configure().
    WithExtensionProviders(rabbitmq.ServiceProvider{}).
    WithProviders(applicationProviders...).
    Create()
```

`Boot` only registers the connector on the current Application's Queue Manager; it does not open an AMQP connection. The broker connection is created when the application first resolves a RabbitMQ connection. After upgrading, configuring `driver: "rabbitmq"` without installing the extension returns an unknown driver error.

## Configuration

### Config File

Queue configuration is registered in `config/queue.go`. You can override any parameter via environment variables:

```go
// config/queue.go
func init() {
    config.Add("queue", func() map[string]interface{} {
        return map[string]interface{}{
            "default":  config.Env("QUEUE_CONNECTION", "sync"),
            "encoding": config.Env("QUEUE_ENCODING", ""),
            "failed": map[string]interface{}{
                "driver": config.Env("QUEUE_FAILED_DRIVER", "memory"),
                "store":  config.Env("QUEUE_FAILED_STORE", "default"),
                "prefix": config.Env("QUEUE_FAILED_PREFIX", "workorder_queue"),
                "ttl":    config.Env("QUEUE_FAILED_TTL", 0),
            },
            "batching": map[string]interface{}{
                "driver": config.Env("QUEUE_BATCHING_DRIVER", "memory"),
                "store":  config.Env("QUEUE_BATCHING_STORE", "default"),
                "prefix": config.Env("QUEUE_BATCHING_PREFIX", "workorder_queue"),
                "ttl":    config.Env("QUEUE_BATCHING_TTL", 0),
            },
            "restart": map[string]interface{}{
                "cache": config.Env("QUEUE_RESTART_CACHE", ""),
                "key":   config.Env("QUEUE_RESTART_KEY", "prismgo:queue:restart"),
            },
            "connections": map[string]interface{}{
                "sync":    { "driver": "sync",  "queue": ... },
                "redis":   { "driver": "redis", ... },
                "rabbitmq": { "driver": "rabbitmq", ... },
            },
        }
    })
}
```

### Configuration Parameters

#### Global

| Parameter Path | Environment Variable | Default | Description |
|---------------|---------------------|---------|-------------|
| `queue.default` | `QUEUE_CONNECTION` | `sync` | Default queue connection name |
| `queue.encoding` | `QUEUE_ENCODING` | `""` (inherits `encoding.default`, final default `msgpack`) | Payload encoding for envelopes |

#### Failed Jobs Store

| Parameter Path | Environment Variable | Default | Description |
|---------------|---------------------|---------|-------------|
| `queue.failed.driver` | `QUEUE_FAILED_DRIVER` | `memory` | Failed store driver (`memory`, `redis`) |
| `queue.failed.store` | `QUEUE_FAILED_STORE` | `default` | Redis store name (when driver is `redis`) |
| `queue.failed.prefix` | `QUEUE_FAILED_PREFIX` | `workorder_queue` | Key prefix for failed records |
| `queue.failed.ttl` | `QUEUE_FAILED_TTL` | `0` | TTL in seconds for failed records (0 = no expiry) |

#### Batching Store

| Parameter Path | Environment Variable | Default | Description |
|---------------|---------------------|---------|-------------|
| `queue.batching.driver` | `QUEUE_BATCHING_DRIVER` | `memory` | Batch store driver (`memory`, `redis`) |
| `queue.batching.store` | `QUEUE_BATCHING_STORE` | `default` | Redis store name (when driver is `redis`) |
| `queue.batching.prefix` | `QUEUE_BATCHING_PREFIX` | `workorder_queue` | Key prefix for batch records |
| `queue.batching.ttl` | `QUEUE_BATCHING_TTL` | `0` | TTL in seconds for batch records (0 = no expiry) |

#### Restart Store

| Parameter Path | Environment Variable | Default | Description |
|---------------|---------------------|---------|-------------|
| `queue.restart.cache` | `QUEUE_RESTART_CACHE` | `""` | Cache store for restart signals (empty = in-memory) |
| `queue.restart.key` | `QUEUE_RESTART_KEY` | `prismgo:queue:restart` | Cache key for restart timestamp |

#### Sync Connection

| Parameter Path | Environment Variable | Default | Description |
|---------------|---------------------|---------|-------------|
| `queue.connections.sync.driver` | — | `sync` | Driver name |
| `queue.connections.sync.queue` | `SYNC_QUEUE` | `default` | Default queue name |

#### Redis Connection

| Parameter Path | Environment Variable | Default | Description |
|---------------|---------------------|---------|-------------|
| `queue.connections.redis.driver` | — | `redis` | Driver name |
| `queue.connections.redis.queue` | `REDIS_QUEUE` | `default` | Default queue name |
| `queue.connections.redis.prefix` | `REDIS_QUEUE_PREFIX` | `workorder_queue` | Key prefix for Redis lists |
| `queue.connections.redis.connection` | `REDIS_QUEUE_CONNECTION` | `default` | Redis connection name |
| `queue.connections.redis.retry_after` | `REDIS_QUEUE_RETRY_AFTER` | `90` | Seconds before reserved job returns to queue |
| `queue.connections.redis.block_for` | `REDIS_QUEUE_BLOCK_FOR` | `0` | Seconds to block-wait for a job (0 = no block) |

### RabbitMQ Configuration

The RabbitMQ connection has extensive configuration for AMQP topology, publishing, and reconnection:

| Parameter Path | Environment Variable | Default | Description |
|---------------|---------------------|---------|-------------|
| `queue.connections.rabbitmq.driver` | — | `rabbitmq` | Driver name |
| `queue.connections.rabbitmq.queue` | `RABBITMQ_QUEUE` | `default` | Default queue name |
| `queue.connections.rabbitmq.block_for` | `RABBITMQ_BLOCK_FOR` | `1` | Seconds to block-wait for a job |
| `queue.connections.rabbitmq.url` | `RABBITMQ_URL` | `""` | Full AMQP URL (overrides host/port/etc.) |
| `queue.connections.rabbitmq.scheme` | `RABBITMQ_SCHEME` | `amqp` | AMQP scheme (`amqp` or `amqps`) |
| `queue.connections.rabbitmq.host` | `RABBITMQ_HOST` | `127.0.0.1` | Broker hostname |
| `queue.connections.rabbitmq.port` | `RABBITMQ_PORT` | `5672` | Broker port |
| `queue.connections.rabbitmq.username` | `RABBITMQ_USERNAME` | `""` | Auth username |
| `queue.connections.rabbitmq.password` | `RABBITMQ_PASSWORD` | `""` | Auth password |
| `queue.connections.rabbitmq.vhost` | `RABBITMQ_VHOST` | `/` | Virtual host |
| `queue.connections.rabbitmq.exchange` | `RABBITMQ_EXCHANGE` | `prismgo.queue` | Default exchange |
| `queue.connections.rabbitmq.exchange_type` | `RABBITMQ_EXCHANGE_TYPE` | `direct` | Exchange type |
| `queue.connections.rabbitmq.declare` | `RABBITMQ_DECLARE` | `true` | Auto-declare exchange/queue/binding |
| `queue.connections.rabbitmq.exchange_durable` | `RABBITMQ_EXCHANGE_DURABLE` | `true` | Durable exchange |
| `queue.connections.rabbitmq.queue_durable` | `RABBITMQ_QUEUE_DURABLE` | `true` | Durable queue |
| `queue.connections.rabbitmq.queue_max_priority` | `RABBITMQ_QUEUE_MAX_PRIORITY` | `0` | Max priority (0 = disabled) |
| `queue.connections.rabbitmq.message_persistent` | `RABBITMQ_MESSAGE_PERSISTENT` | `true` | Persistent delivery mode |
| `queue.connections.rabbitmq.auto_delete` | `RABBITMQ_AUTO_DELETE` | `false` | Auto-delete on disuse |
| `queue.connections.rabbitmq.exclusive` | `RABBITMQ_EXCLUSIVE` | `false` | Exclusive queue |
| `queue.connections.rabbitmq.no_wait` | `RABBITMQ_NO_WAIT` | `false` | No-wait declaration |
| `queue.connections.rabbitmq.confirm` | `RABBITMQ_CONFIRM` | `true` | Enable publisher confirms |
| `queue.connections.rabbitmq.delay_mode` | `RABBITMQ_DELAY_MODE` | `plugin` | Delay mode: `plugin`, `ttl_dlx`, `none` |
| `queue.connections.rabbitmq.delay_buckets` | `RABBITMQ_DELAY_BUCKETS` | `5,10,30,60,300,900,3600` | Comma-separated TTL bucket seconds (for `ttl_dlx` mode) |
| `queue.connections.rabbitmq.prefetch` | `RABBITMQ_PREFETCH` | `1` | Consumer prefetch count |
| `queue.connections.rabbitmq.heartbeat` | `RABBITMQ_HEARTBEAT` | `10` | AMQP heartbeat interval (seconds) |
| `queue.connections.rabbitmq.publish_timeout` | `RABBITMQ_PUBLISH_TIMEOUT` | `5` | Publish confirm timeout (seconds) |
| `queue.connections.rabbitmq.publish_channels` | `RABBITMQ_PUBLISH_CHANNELS` | `1` | Publish channel pool size (max 128) |
| `queue.connections.rabbitmq.reconnect_min_delay` | `RABBITMQ_RECONNECT_MIN_DELAY` | `100ms` | Min reconnect backoff |
| `queue.connections.rabbitmq.reconnect_max_delay` | `RABBITMQ_RECONNECT_MAX_DELAY` | `5s` | Max reconnect backoff |
| `queue.connections.rabbitmq.restart_queue` | `RABBITMQ_RESTART_QUEUE` | `prismgo.queue.restart` | Restart signal queue name |
| `queue.connections.rabbitmq.restart_enabled` | `RABBITMQ_RESTART_ENABLED` | `true` | Enable restart signal consumption |
| `queue.connections.rabbitmq.restart_poll_interval` | `RABBITMQ_RESTART_POLL_INTERVAL` | `1s` | Local restart-read debounce |
| `queue.connections.rabbitmq.topology_cache_ttl` | `RABBITMQ_TOPOLOGY_CACHE_TTL` | `0` | Topology cache sliding TTL (0 = no TTL) |
| `queue.connections.rabbitmq.topology_cache_max_entries` | `RABBITMQ_TOPOLOGY_CACHE_MAX_ENTRIES` | `0` | Topology cache LRU cap (0 = unlimited) |

**RabbitMQ delay modes:**

- **`plugin`** (default) — Uses the `rabbitmq_delayed_message_exchange` plugin. Requires the plugin to be installed on the broker.
- **`ttl_dlx`** — Uses per-bucket TTL queues with a dead-letter exchange. Falls back to the nearest configured bucket duration.
- **`none`** — No delay support; `Later()` returns `ErrUnsupportedOperation`.

**RabbitMQ does not support `retry_after`** — the Redis-style visibility timeout. Setting `retry_after` on a RabbitMQ connection returns `ErrUnsupportedRetryAfter`.

## Creating Jobs

### Job Structure

A job is any type that implements the `Job` interface:

```go
type Job interface {
    Handle(ctx context.Context) error
}
```

Define a job as a struct with exported fields (they are serialized into the queue payload):

```go
package jobs

import (
    "context"
    "fmt"
    "github.com/prismgo/framework/queue"
)

type SendWelcomeMailJob struct {
    UserID int64
    Email  string
}

func (j *SendWelcomeMailJob) Handle(ctx context.Context) error {
    fmt.Printf("Sending welcome mail to user %d at %s\n", j.UserID, j.Email)
    return nil
}

func init() {
    queue.RegisterType[*SendWelcomeMailJob]()
}
```

> **Important:** You must call `queue.RegisterType[*T]()` in an `init()` function so that the worker process can deserialize the job from the queue payload. Without registration, the worker returns `ErrJobNotRegistered`.

### Job Strategy Interfaces

Jobs may optionally implement strategy interfaces to declare default dispatch behavior. These defaults can be overridden at dispatch time via `DispatchOption` functions.

| Interface | Method | Purpose | Overridable by DispatchOption |
|-----------|--------|---------|-------------------------------|
| `ConnectionProvider` | `QueueConnection() string` | Default connection | `OnConnection` |
| `QueueProvider` | `QueueName() string` | Default queue | `OnQueue` |
| `DelayProvider` | `QueueDelay() time.Duration` | Default delay | `Delay` |
| `TriesProvider` | `Tries() int` | Max attempts | `Tries` |
| `TimeoutProvider` | `Timeout() time.Duration` | Per-execution timeout | `Timeout` |
| `BackoffProvider` | `Backoff() []time.Duration` | Retry backoff sequence | `Backoff` |
| `RetryUntilProvider` | `RetryUntil() time.Time` | Retry deadline | `RetryUntil` |
| `MaxExceptionsProvider` | `MaxExceptions() int` | Max exception count | `MaxExceptions` |
| `FailOnTimeoutProvider` | `FailOnTimeout() bool` | Fail directly on timeout | `FailOnTimeout` |
| `EncryptedProvider` | `ShouldEncrypt() bool` | Encrypt payload | `Encrypt` |
| `MiddlewareProvider` | `Middleware() []Middleware` | Job-level middleware | No |
| `UniqueIDProvider` | `UniqueID() string` | Unique job key | `Unique` |
| `UniqueForProvider` | `UniqueFor() time.Duration` | Unique lock TTL | `Unique` |
| `UniqueViaProvider` | `UniqueVia() cachecontract.Repository` | Unique lock cache store | `UniqueVia` |
| `UniqueUntilProcessingProvider` | `UniqueUntilProcessing() bool` | Release lock before processing | `UniqueUntilProcessing` |
| `DebounceIDProvider` | `DebounceID() string` | Debounce key | `Debounce` |
| `DebounceForProvider` | `DebounceFor() time.Duration` | Debounce window | `Debounce` |
| `DebounceViaProvider` | `DebounceVia() cachecontract.Repository` | Debounce cache store | `DebounceVia` |
| `FailedProvider` | `Failed(ctx context.Context, err error)` | Final failure callback | No |
| `TagsProvider` | `Tags() []string` | Horizon display tags | `Tags` |
| `SilencedProvider` | `Silenced() bool` | Horizon silenced | `Silenced` |

Example — a job that declares default connection, queue, and max tries:

```go
type ProcessOrderJob struct {
    OrderID int64
}

func (j *ProcessOrderJob) Handle(ctx context.Context) error {
    // process order...
    return nil
}

func (j *ProcessOrderJob) QueueConnection() string { return "redis" }
func (j *ProcessOrderJob) QueueName() string       { return "orders" }
func (j *ProcessOrderJob) Tries() int               { return 5 }
func (j *ProcessOrderJob) Timeout() time.Duration   { return 30 * time.Second }
func (j *ProcessOrderJob) Backoff() []time.Duration {
    return []time.Duration{10 * time.Second, 60 * time.Second, 5 * time.Minute}
}

func (j *ProcessOrderJob) Failed(ctx context.Context, err error) {
    log.Printf("ProcessOrderJob for order %d finally failed: %v", j.OrderID, err)
}
```

### Unique Jobs

Unique jobs prevent duplicate dispatches within a lock window. If a job with the same unique key already exists in the cache, the second dispatch returns `ErrDuplicate`.

You can declare uniqueness on the job struct:

```go
type GenerateReportJob struct {
    ReportID string
}

func (j *GenerateReportJob) Handle(ctx context.Context) error {
    return nil
}

func (j *GenerateReportJob) UniqueID() string         { return "report:" + j.ReportID }
func (j *GenerateReportJob) UniqueFor() time.Duration  { return 30 * time.Minute }
```

Or at dispatch time:

```go
queue.Dispatch(ctx, job,
    queue.Unique("report:"+reportID, 30*time.Minute),
)
```

**`UniqueUntilProcessing`** releases the lock before the job starts executing (instead of after completion), allowing the next dispatch to enter as soon as processing begins:

```go
queue.Dispatch(ctx, job,
    queue.Unique("report:"+reportID, 30*time.Minute),
    queue.UniqueUntilProcessing(),
)
```

**`UniqueVia`** specifies a custom cache store for the unique lock:

```go
queue.Dispatch(ctx, job,
    queue.Unique("report:"+reportID, 30*time.Minute),
    queue.UniqueVia(cache.Store("redis")),
)
```

### Debounced Jobs

Debounced jobs ensure that only the last dispatch within a window is executed. Earlier dispatches are discarded by the worker when a newer dispatch with the same debounce key arrives.

Declare on the job struct:

```go
type SyncUserJob struct {
    UserID int64
}

func (j *SyncUserJob) Handle(ctx context.Context) error {
    return nil
}

func (j *SyncUserJob) DebounceID() string         { return fmt.Sprintf("sync_user:%d", j.UserID) }
func (j *SyncUserJob) DebounceFor() time.Duration  { return 15 * time.Second }
```

Or at dispatch time:

```go
queue.Dispatch(ctx, job,
    queue.Debounce(fmt.Sprintf("sync_user:%d", userID), 15*time.Second),
)
```

**`DebounceVia`** specifies a custom cache store for debounce state:

```go
queue.Dispatch(ctx, job,
    queue.Debounce("sync_user:123", 15*time.Second),
    queue.DebounceVia(cache.Store("redis")),
)
```

### Encrypted Jobs

Jobs can declare that their payload should be encrypted before being stored in the queue. This requires `app.key` to be configured.

Declare on the job struct:

```go
func (j *SensitiveJob) ShouldEncrypt() bool { return true }
```

Or at dispatch time:

```go
queue.Dispatch(ctx, job, queue.Encrypt())
```

See [Encrypted Payloads](#encrypted-payloads) for details on the encryption mechanism.

## Job Middleware

Job middleware wraps the execution of a job, enabling cross-cutting concerns like rate limiting, overlap prevention, and conditional skipping.

Register global middleware via:

```go
queue.UseMiddleware(myMiddleware)
```

Or declare job-level middleware by implementing `MiddlewareProvider`:

```go
func (j *MyJob) Middleware() []queue.Middleware {
    return []queue.Middleware{
        queue.WithoutOverlapping("order:"+strconv.FormatInt(j.OrderID, 10)),
    }
}
```

### Rate Limiting

The `RateLimit` middleware restricts how often a job can execute within a time window. When the limit is exceeded, the job is released back to the queue with a delay:

```go
queue.RateLimit("emails", 5, time.Minute)
```

This allows at most 5 executions of jobs sharing the `"emails"` key per minute. Excess jobs are released with a delay equal to the remaining window.

### Preventing Job Overlaps

The `WithoutOverlapping` middleware uses a distributed lock to prevent concurrent execution of jobs with the same key:

```go
queue.WithoutOverlapping("order:123")
```

By default, the lock TTL is 1 minute. Customize it:

```go
queue.WithoutOverlapping("order:123", 5*time.Minute)
```

**Builder methods:**

| Method | Description |
|--------|-------------|
| `.ReleaseAfter(delay)` | Release the job back to the queue with a delay when the lock is held (default) |
| `.DontRelease()` | Skip the job silently instead of releasing it when the lock is held |
| `.ExpireAfter(ttl)` | Set the maximum lock hold time (default equals TTL) |
| `.Via(store)` | Use a specific cache store for the lock |
| `.Shared()` | Retained for Laravel API compatibility; locks are already connection-scoped |

```go
queue.WithoutOverlapping("order:123", 5*time.Minute).
    ReleaseAfter(30*time.Second).
    Via(cache.Store("redis"))
```

### Throttling Exceptions

The `ThrottlesExceptions` middleware delays job retries when exceptions accumulate, preventing a failing job from flooding the queue:

```go
queue.ThrottlesExceptions(10, 5*time.Minute)
```

After 10 exceptions within a 5-minute decay window, the job is released with a delay equal to the decay period.

**Builder methods:**

| Method | Description |
|--------|-------------|
| `.By(key)` | Custom throttle key (default: job type name) |
| `.Backoff(delay)` | Release delay before the throttle threshold is reached |
| `.When(predicate)` | Only count errors matching the predicate |
| `.Via(store)` | Use a specific cache store for rate counting |

```go
queue.ThrottlesExceptions(5, time.Minute).
    By("external-api").
    Backoff(10*time.Second).
    When(func(err error) bool {
        return !errors.Is(err, context.Canceled)
    })
```

### Skipping Jobs

The `SkipIf` middleware skips a job based on a predicate, treating it as a successful execution:

```go
queue.SkipIf(func(job queue.Job) bool {
    j, ok := job.(*ReportJob)
    return ok && j.Cancelled
})
```

Skipped jobs return `ErrSkipped` internally and are deleted from the queue without triggering failure handling.

### Custom Middleware

Implement the `Middleware` interface or use `MiddlewareFunc`:

```go
var LogMiddleware = queue.MiddlewareFunc(func(ctx context.Context, job queue.Job, next queue.Next) error {
    log.Printf("Starting job: %T", job)
    err := next(ctx)
    if err != nil {
        log.Printf("Job %T failed: %v", job, err)
    } else {
        log.Printf("Job %T completed", job)
    }
    return err
})

queue.UseMiddleware(LogMiddleware)
```

## Dispatching Jobs

Dispatch a job using the `queue.Dispatch` facade function:

```go
id, err := queue.Dispatch(ctx, &jobs.SendWelcomeMailJob{UserID: 42, Email: "user@example.com"})
```

The returned `id` is the unique job ID assigned to the envelope.

### Delayed Dispatching

Use `queue.Later` to dispatch a job with a delay in seconds:

```go
id, err := queue.Later(ctx, 60, job) // dispatch 60 seconds from now
```

Or use the `Delay` option for `time.Duration` precision:

```go
id, err := queue.Dispatch(ctx, job, queue.Delay(5*time.Minute))
```

### Synchronous Dispatching

When the default connection is `sync`, jobs execute immediately in the current goroutine. No worker process is needed:

```go
// .env
QUEUE_CONNECTION=sync
```

The `sync` driver runs the job's `Handle` method synchronously during `Dispatch`. All middleware, failure handling, and events still fire normally.

### Job Chaining

Job chains specify a sequence of jobs that must run in order. The next job in the chain is dispatched only after the current job succeeds:

```go
status, err := queue.Chain(
    &jobs.ValidateOrderJob{OrderID: 1},
    &jobs.ChargePaymentJob{OrderID: 1},
    &jobs.SendConfirmationJob{OrderID: 1},
).Options(
    queue.OnConnection("redis"),
    queue.OnQueue("orders"),
).Dispatch(ctx)
```

If any job in the chain fails, subsequent jobs are not dispatched.

### Customizing The Queue and Connection

Override the connection and queue at dispatch time:

```go
queue.Dispatch(ctx, job,
    queue.OnConnection("redis"),
    queue.OnQueue("high"),
)
```

Dispatch options support chaining for fluent API usage:

```go
queue.Dispatch(ctx, job,
    queue.Delay(30*time.Second).OnConnection("redis").OnQueue("orders"),
)
```

### Specifying Max Job Attempts / Timeout Values

```go
queue.Dispatch(ctx, job,
    queue.Tries(5),
    queue.Timeout(2*time.Minute),
    queue.FailOnTimeout(),
    queue.MaxExceptions(3),
    queue.Backoff(10*time.Second, 60*time.Second, 5*time.Minute),
    queue.RetryUntil(time.Now().Add(time.Hour)),
)
```

| Option | Description |
|--------|-------------|
| `queue.Tries(n)` | Maximum number of attempts |
| `queue.Timeout(d)` | Per-execution timeout |
| `queue.FailOnTimeout()` | Mark job as failed on timeout instead of retrying |
| `queue.MaxExceptions(n)` | Maximum allowed exceptions before failing |
| `queue.Backoff(values...)` | Retry backoff duration sequence |
| `queue.RetryUntil(t)` | Deadline after which retries stop |

### Error Handling

Within a job's `Handle` method, you can control retry behavior by returning special errors:

```go
func (j *MyJob) Handle(ctx context.Context) error {
    // Fail immediately — no retry
    if j.Invalid {
        return queue.Fail(fmt.Errorf("invalid input"))
    }

    // Release back to queue with a delay
    if isTemporary(err) {
        return queue.ReleaseAfter(30*time.Second, err)
    }

    // Normal error — standard retry logic applies
    return err
}
```

| Error Helper | Behavior |
|-------------|----------|
| `queue.Fail(err)` | Fail immediately, no retry |
| `queue.ReleaseAfter(delay, err)` | Release back to queue with specified delay |
| Return `queue.ErrSkipped` | Skip job, treated as success |

## Job Batching

Job batching lets you dispatch a group of jobs and track their collective progress.

### Dispatching Batches

```go
batchStatus, err := queue.Batch(
    &jobs.ImportRowJob{Row: 1},
    &jobs.ImportRowJob{Row: 2},
    &jobs.ImportRowJob{Row: 3},
).Name("import-csv").Options(
    queue.OnConnection("redis"),
).Dispatch(ctx)
```

`BatchStatus` contains:

| Field | Description |
|-------|-------------|
| `ID` | Unique batch ID |
| `Name` | Batch name |
| `Total` | Total number of jobs |
| `Pending` | Jobs not yet completed |
| `Processed` | Jobs completed (success + failed) |
| `Failed` | Jobs that failed |
| `Cancelled` | Whether the batch was cancelled |
| `CreatedAt` | Creation timestamp |
| `FinishedAt` | Completion timestamp (zero if still running) |
| `CancelledAt` | Cancellation timestamp |

### Inspecting Batches

```go
status, err := queue.GetBatchStatus(ctx, batchID)
if err != nil {
    return err
}
fmt.Printf("Progress: %d/%d, Failed: %d\n",
    status.Processed, status.Total, status.Failed)
```

### Cancelling Batches

```go
err := queue.CancelBatch(ctx, batchID)
```

Cancelled batches cause remaining pending jobs to be skipped by the worker (returning `ErrBatchCancelled`).

## Running The Queue Worker

### The queue:work Command

Start a worker process:

```bash
go run ./ queue redis --queue=high,default --tries=3 --backoff=10,60
```

**Worker options:**

| Flag | Description |
|------|-------------|
| `--queue` | Comma-separated queue names (priority order) |
| `--tries` | Default max attempts for jobs without `TriesProvider` |
| `--backoff` | Comma-separated backoff seconds |
| `--once` | Process one job then exit |
| `--stop-when-empty` | Exit when the queue is empty |
| `--max-jobs` | Exit after processing N jobs |
| `--max-time` | Exit after N seconds |
| `--timeout` | Default per-job timeout |
| `--sleep` | Seconds to sleep when no job is available (default 1) |

**`WorkerOptions` struct (programmatic usage):**

```go
worker := queue.NewWorker(manager)
err := worker.Work(ctx, queue.WorkerOptions{
    Connection:    "redis",
    Queues:        []string{"high", "default"},
    Once:          false,
    StopWhenEmpty: false,
    Sleep:         time.Second,
    Timeout:       60 * time.Second,
    TimeoutGrace:  100 * time.Millisecond,
    Tries:         3,
    Backoff:       []time.Duration{10 * time.Second, 60 * time.Second},
    MaxJobs:       0,
    MaxTime:       0,
})
```

### Queue Priorities

Pass multiple queue names in priority order. The worker tries the first queue first, then falls through:

```bash
go run ./ queue redis --queue=high,default,low
```

### Queue Workers and Deployment

To gracefully restart all workers, use the restart signal:

```go
queue.RequestRestart(ctx)
```

Workers check this signal before each job. If a restart was requested after the worker started, the worker exits cleanly after the current job finishes.

The restart signal is stored in a cache store (configurable via `queue.restart.cache`). When empty, an in-memory store is used — suitable only for single-process deployments. For multi-process deployments, configure a shared cache store (e.g., Redis).

### Job Expirations and Timeouts

**Timeout** — The maximum time a job's `Handle` method is allowed to run. After timeout, the worker cancels the job's context and waits a brief grace period before treating it as failed.

**Timeout Grace** — After a timeout, the worker waits a short grace period for the job to return on its own. Default: 100ms. This prevents goroutine leaks when jobs don't respond to context cancellation.

**FailOnTimeout** — When set, a timed-out job is marked as failed immediately instead of being released for retry.

**RetryAfter** (Redis only) — The number of seconds a Redis connection waits before moving a reserved job back to the ready list. Not supported by RabbitMQ.

## Dealing With Failed Jobs

### Cleaning Up After Failed Jobs

When a job exhausts all retry attempts, it is recorded in the `FailedStore`:

```go
failedStore := queue.Failed()

// Paginate failed jobs
page, err := failedStore.Page(ctx, state.PageRequest{Page: 1, PageSize: 50})

// Find a specific failed job
job, err := failedStore.Find(ctx, failedID)

// Delete a single failed record
err := failedStore.Forget(ctx, failedID)

// Clear all failed records
err := failedStore.Flush(ctx)
```

### Retrying Failed Jobs

Use `RetryFailed` to re-queue a failed job:

```go
dispatcher := queue.NewDispatcher(manager)
err := dispatcher.RetryFailed(ctx, failedID)
```

This reads the original envelope from the `FailedStore`, resets the attempt counter, and pushes it back to the original connection and queue. The failed record is deleted only after the push succeeds.

### Failed Job Events

The `queue.job_failed` event is fired when a job finally fails. The event payload is `JobFailed`, which embeds `payload.FailedJob`:

```go
queue.UseEventSink(func(ctx context.Context, ev queue.Event) {
    if failed, ok := ev.(queue.JobFailed); ok {
        log.Printf("Job %s failed: %s", failed.JobName, failed.Error)
    }
})
```

Jobs can also implement `FailedProvider` to receive the failure callback directly:

```go
func (j *MyJob) Failed(ctx context.Context, err error) {
    // cleanup or alert
}
```

## Lifecycle Events

Register an event sink to observe queue lifecycle events:

```go
queue.UseEventSink(func(ctx context.Context, ev queue.Event) {
    switch ev.Name() {
    case queue.EventJobQueued:
        // Job entered the transport
    case queue.EventJobProcessing:
        // Worker is about to execute the job
    case queue.EventJobProcessed:
        // Job executed successfully
    case queue.EventJobReleased:
        // Job released back to queue for retry
    case queue.EventJobFailed:
        // Job finally failed
    case queue.EventBatchCreated:
        // Batch created
    case queue.EventBatchUpdated:
        // Batch progress updated
    case queue.EventBatchCancelled:
        // Batch cancelled
    case queue.EventBatchFinished:
        // All batch jobs completed
    }
})
```

**Job events:**

| Event Name | Payload | Fired When |
|-----------|---------|-----------|
| `queue.job_queued` | `JobQueued` | Job accepted by transport |
| `queue.job_processing` | `JobProcessing` | Worker starts job execution |
| `queue.job_processed` | `JobProcessed` | Job execution succeeds |
| `queue.job_released` | `JobReleased` | Job released for retry |
| `queue.job_failed` | `JobFailed` | Job finally fails |

**Batch events:**

| Event Name | Payload | Fired When |
|-----------|---------|-----------|
| `queue.batch_created` | `BatchEvent` | Batch created |
| `queue.batch_updated` | `BatchEvent` | Batch job completed |
| `queue.batch_cancelled` | `BatchEvent` | Batch cancelled |
| `queue.batch_finished` | `BatchEvent` | All batch jobs completed |

**Infrastructure events** (driver lifecycle):

| Event Name | Description |
|-----------|-------------|
| `queue.connection_connecting` | Connecting to backend |
| `queue.connection_connected` | Connection established |
| `queue.connection_disconnected` | Connection lost |
| `queue.connection_reconnecting` | Reconnecting attempt |
| `queue.connection_reconnected` | Reconnection succeeded |
| `queue.connection_reconnect_failed` | Reconnection failed |
| `queue.topology_declared` | Exchange/queue/binding declared |
| `queue.topology_declare_failed` | Declaration failed |
| `queue.consumer_started` | Push consumer started |
| `queue.consumer_stopped` | Push consumer stopped |
| `queue.consumer_stop_failed` | Consumer stop failed |
| `queue.publish_failed` | Publish to broker failed |
| `queue.poison_envelope` | Cannot decode envelope |
| `queue.release_republish_failed` | Release republish failed (RabbitMQ) |

## Encrypted Payloads

When a job declares `ShouldEncrypt() bool` or is dispatched with `queue.Encrypt()`, the job payload is encrypted using AES-GCM before being written to the queue transport.

The encryption key is derived from `app.key` (SHA-256). The `base64:` prefix convention from Laravel is supported:

```go
// app.key in .env
APP_KEY=base64:c3VwZXJzZWNyZXRrZXkxMjM0NTY3ODkw

// Or a plain string
APP_KEY=my-secret-key
```

Encryption flow:
1. The job payload is serialized by the registry codec (msgpack or json).
2. The serialized bytes are encrypted with AES-GCM using a random nonce.
3. The encrypted token is base64-encoded and stored as the envelope payload.

Decryption is transparent — the worker decrypts the payload before unmarshaling the job.

> **Warning:** If `app.key` is empty, `NewPayloadCipher` returns `nil`. Any job with `ShouldEncrypt` or `Encrypt` will fail at dispatch time with `"queue: payload cipher is not configured"`.

## Custom Drivers

To create a custom queue driver (e.g., database-backed, SQS, or a proprietary backend), implement three core interfaces from `contracts/queue` and register the implementation as a custom driver.

### Required Interfaces

#### Connector — Connection Factory

`Connector` creates a `Queue` instance from a connection name and config. The Manager calls `Connect` on first resolution and caches the result.

```go
type Connector interface {
    Connect(ctx context.Context, name string, config map[string]any) (Queue, error)
}
```

| Parameter | Description |
| --- | --- |
| `name` | The connection config key, e.g., `"database"` |
| `config` | A copy of the connection config; raw fields are in `config["_spec"].(ConnectionConfig).Options` |

#### Queue — Transport Connection

`Queue` is the core transport interface, defining message enqueue, dequeue, and lifecycle operations.

```go
type Queue interface {
    // Push enqueues an encoded payload immediately
    Push(ctx context.Context, queue string, body Payload) error

    // Later enqueues an encoded payload with a delay
    Later(ctx context.Context, queue string, body Payload, delay time.Duration) error

    // Bulk enqueues multiple payloads and returns the number accepted by the transport
    Bulk(ctx context.Context, queue string, bodies []Payload) (BulkResult, error)

    // Pop retrieves a reserved job from one or more queues; returns ErrEmpty when no jobs are available
    Pop(ctx context.Context, queues []string, wait ...PopWaitMode) (ReservedJob, error)

    // Size returns the number of pending jobs in the specified queue
    Size(ctx context.Context, queue string) (int64, error)

    // Clear removes all pending jobs from the specified queue
    Clear(ctx context.Context, queue string) error

    // Close releases connection resources
    Close() error
}
```

| Method | Purpose | Notes |
| --- | --- | --- |
| `Push` | Immediate enqueue | `body` is an encoded envelope; the driver does not need to understand its internal structure |
| `Later` | Delayed enqueue | When `delay` is 0, equivalent to `Push`; drivers that don't support delays may return `ErrUnsupportedOperation` |
| `Bulk` | Batch enqueue | Returns `BulkResult{Accepted}` indicating how many were accepted; if unsupported, call `Push` per item |
| `Pop` | Dequeue a job | `queues` are ordered by priority; `wait` defaults to `PopWaitAvailable`, pass `PopNoWait` for non-blocking |
| `Size` | Queue length | Returns pending job count; return `0, nil` if unsupported |
| `Clear` | Purge queue | Removes all pending messages from the specified queue |
| `Close` | Close connection | Releases underlying resources (DB connections, clients, etc.) |

#### ReservedJob — Held Job

`ReservedJob` represents a job held by the Worker. The Worker uses this interface to acknowledge or release the job.

```go
type ReservedJob interface {
    // ID returns the job ID from the envelope
    ID() string

    // Name returns the job type name
    Name() string

    // Payload returns the raw encoded payload bytes
    Payload() Payload

    // Attempts returns the number of times this job has been attempted
    Attempts() int

    // Delete acknowledges the job and removes it from the queue
    Delete(ctx context.Context) error

    // Release returns the job to the queue with a retry delay
    Release(ctx context.Context, delay time.Duration) error
}
```

| Method | Purpose | Notes |
| --- | --- | --- |
| `ID` | Job identifier | UUID from the envelope |
| `Name` | Type name | Used by the Registry for deserialization |
| `Payload` | Raw bytes | The Worker decodes this via codec into an envelope, then restores the Job |
| `Attempts` | Attempt count | The Worker uses this to check against `Tries` |
| `Delete` | Acknowledge | Called after successful execution |
| `Release` | Retry | Called when the job fails but can be retried; `delay` controls backoff |

### Optional Interfaces

| Interface | Method | Purpose |
| --- | --- | --- |
| `PopSessionProvider` | `NewPopSession() Queue` | Creates a worker-local Queue view for safe lifecycle resource cleanup |
| `ConsumerIntentLeaser` | `AcquireConsumerIntent(queues) (func() error, error)` | Worker lifecycle management for push-consumer drivers (e.g., RabbitMQ) |

### Complete Example: In-Memory Queue Driver

The following example shows a minimal custom driver implementation:

```go
package memoryqueue

import (
    "context"
    "fmt"
    "sync"
    "time"

    queuecontract "github.com/prismgo/framework/contracts/queue"
    "github.com/prismgo/framework/queue"
)

// --- Connector ---

type MemoryConnector struct{}

func (c MemoryConnector) Connect(_ context.Context, name string, config map[string]any) (queuecontract.Queue, error) {
    // Read connection config from config["_spec"]
    spec, ok := config["_spec"].(queue.ConnectionConfig)
    if !ok {
        return nil, fmt.Errorf("memory queue: missing connection config for %q", name)
    }
    return NewMemoryQueue(spec.Queue), nil
}

// --- Queue ---

type MemoryQueue struct {
    mu    sync.Mutex
    name  string
    items []item
}

type item struct {
    queue string
    body  queuecontract.Payload
}

func NewMemoryQueue(name string) *MemoryQueue {
    return &MemoryQueue{name: name}
}

func (q *MemoryQueue) Push(_ context.Context, queue string, body queuecontract.Payload) error {
    q.mu.Lock()
    defer q.mu.Unlock()
    q.items = append(q.items, item{queue: queue, body: body})
    return nil
}

func (q *MemoryQueue) Later(ctx context.Context, queue string, body queuecontract.Payload, delay time.Duration) error {
    // Simplified: ignore delay and push immediately.
    // Production drivers should use a timer or delayed queue.
    return q.Push(ctx, queue, body)
}

func (q *MemoryQueue) Bulk(ctx context.Context, queue string, bodies []queuecontract.Payload) (queuecontract.BulkResult, error) {
    for _, body := range bodies {
        if err := q.Push(ctx, queue, body); err != nil {
            return queuecontract.BulkResult{}, err
        }
    }
    return queuecontract.BulkResult{Accepted: len(bodies)}, nil
}

func (q *MemoryQueue) Pop(_ context.Context, queues []string, _ ...queuecontract.PopWaitMode) (queuecontract.ReservedJob, error) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for _, queueName := range queues {
        for i, it := range q.items {
            if it.queue == queueName {
                q.items = append(q.items[:i], q.items[i+1:]...)
                return &memoryReservedJob{id: "job-1", name: "test", body: it.body, attempts: 1}, nil
            }
        }
    }
    return nil, queue.ErrEmpty
}

func (q *MemoryQueue) Size(_ context.Context, _ string) (int64, error) {
    q.mu.Lock()
    defer q.mu.Unlock()
    return int64(len(q.items)), nil
}

func (q *MemoryQueue) Clear(_ context.Context, _ string) error {
    q.mu.Lock()
    q.items = nil
    q.mu.Unlock()
    return nil
}

func (q *MemoryQueue) Close() error { return nil }

// --- ReservedJob ---

type memoryReservedJob struct {
    id       string
    name     string
    body     queuecontract.Payload
    attempts int
}

func (j *memoryReservedJob) ID() string                          { return j.id }
func (j *memoryReservedJob) Name() string                        { return j.name }
func (j *memoryReservedJob) Payload() queuecontract.Payload      { return j.body }
func (j *memoryReservedJob) Attempts() int                       { return j.attempts }
func (j *memoryReservedJob) Delete(_ context.Context) error      { return nil }
func (j *memoryReservedJob) Release(_ context.Context, _ time.Duration) error {
    // Simplified: re-enqueue immediately. Production drivers should
    // return the job to the queue with the specified delay.
    return nil
}

// --- Registration ---

func init() {
    queue.Extend("memory-custom", MemoryConnector{})
}
```

### Registration and Configuration

`queue.Extend` can be called in a business package's `init()` function — it does not require the Application container or Queue Manager to exist yet. The Manager reads the registry when it first resolves a connection.

```go
// Register in init()
func init() {
    queue.Extend("memory-custom", MemoryConnector{})
}
```

Add a connection in the configuration:

```go
// config/queue.go
"connections": map[string]interface{}{
    "memory-custom": map[string]interface{}{
        "driver": "memory-custom",
        "queue":  "default",
    },
},
```

The `Connect(ctx, name, config)` method receives a connection name and a config copy. Raw driver-specific fields are stored in `config["_spec"].(ConnectionConfig).Options` for custom parsing:

```go
func (c MyConnector) Connect(_ context.Context, name string, config map[string]any) (queuecontract.Queue, error) {
    spec, _ := config["_spec"].(queue.ConnectionConfig)
    // Read driver-private config from spec.Options
    tableName, _ := spec.Options["table"].(string)
    dbConnection, _ := spec.Options["connection"].(string)
    // ...
}
```

## Error Constants

The queue package exports sentinel errors for programmatic matching with `errors.Is`:

| Error | Description |
|-------|-------------|
| `ErrEmpty` | No jobs available in the queue |
| `ErrJobNotRegistered` | Job type not found in the registry |
| `ErrDuplicate` | Unique job lock already exists |
| `ErrSkipped` | Job skipped by middleware (treated as success) |
| `ErrBatchCancelled` | Job belongs to a cancelled batch |
| `ErrManagerClosed` | Queue manager is closed |
| `ErrConnectionClosed` | Connection is closed |
| `ErrUnsupportedOperation` | Driver does not support the operation |
| `ErrPoisonEnvelope` | Cannot decode envelope from transport payload |
| `ErrUnsupportedRetryAfter` | RabbitMQ does not support `retry_after` |
| `ErrRabbitMQDialFailed` | RabbitMQ dial failed during initialization |
| `ErrRabbitMQTopologyMissing` | Required exchange/queue missing with `declare=false` |
| `ErrRabbitMQPublishNacked` | Broker rejected the publish |
| `ErrRabbitMQPublishTimeout` | Publish confirm timeout |
| `ErrRabbitMQPublishConfirmClosed` | Confirm channel closed while waiting |
| `ErrRabbitMQPublishUnrouted` | Mandatory publish unrouted |
| `ErrRabbitMQReleaseRepublishFailed` | Release republish failed after ack |

## Connection Capability Matrix

| Feature | `sync` | `redis` | `rabbitmq` |
|---------|--------|---------|------------|
| Immediate dispatch | ✅ | ✅ | ✅ |
| Delayed dispatch | ❌ | ✅ | ✅ |
| Bulk dispatch | ❌ | ✅ | ✅ |
| Pop (pull consumer) | ✅ | ✅ | ✅ |
| Push consumer | ❌ | ❌ | ✅ |
| `retry_after` | ❌ | ✅ | ❌ |
| `block_for` | ❌ | ✅ | ✅ |
| Publisher confirms | — | — | ✅ |
| Auto-reconnect | — | — | ✅ |
| Delay modes | — | — | `plugin`, `ttl_dlx`, `none` |
| Unique jobs | ✅ | ✅ | ✅ |
| Debounced jobs | ✅ | ✅ | ✅ |
| Encrypted payloads | ✅ | ✅ | ✅ |
| Job chaining | ✅ | ✅ | ✅ |
| Job batching | ✅ | ✅ | ✅ |

## Laravel Queue Mapping

| Laravel Concept | PrismGo Equivalent |
|----------------|-------------------|
| `Job` class with `handle()` | `Job` interface with `Handle(ctx context.Context) error` |
| `$connection` property | `ConnectionProvider.QueueConnection()` |
| `$queue` property | `QueueProvider.QueueName()` |
| `$tries` property | `TriesProvider.Tries()` |
| `$timeout` property | `TimeoutProvider.Timeout()` |
| `$backoff` property | `BackoffProvider.Backoff()` |
| `retryUntil()` method | `RetryUntilProvider.RetryUntil()` |
| `$maxExceptions` property | `MaxExceptionsProvider.MaxExceptions()` |
| `$failOnTimeout` property | `FailOnTimeoutProvider.FailOnTimeout()` |
| `ShouldBeEncrypted` | `EncryptedProvider.ShouldEncrypt()` |
| `ShouldBeUniqueUntilProcessing` | `UniqueUntilProcessingProvider.UniqueUntilProcessing()` |
| `uniqueId()` method | `UniqueIDProvider.UniqueID()` |
| `$uniqueFor` property | `UniqueForProvider.UniqueFor()` |
| `uniqueVia()` method | `UniqueViaProvider.UniqueVia()` |
| `failed()` method | `FailedProvider.Failed(ctx, err)` |
| `middleware()` method | `MiddlewareProvider.Middleware()` |
| `Dispatch($job)` | `queue.Dispatch(ctx, job, options...)` |
| `Dispatch($job)->delay(...)` | `queue.Dispatch(ctx, job, queue.Delay(d))` |
| `Dispatch($job)->onConnection(...)` | `queue.Dispatch(ctx, job, queue.OnConnection(name))` |
| `Dispatch($job)->onQueue(...)` | `queue.Dispatch(ctx, job, queue.OnQueue(name))` |
| `Bus::chain([...])->dispatch()` | `queue.Chain(jobs...).Dispatch(ctx)` |
| `Bus::batch([...])->dispatch()` | `queue.Batch(jobs...).Dispatch(ctx)` |
| `WithoutOverlapping` middleware | `queue.WithoutOverlapping(key, ttl)` |
| `ThrottlesExceptions` middleware | `queue.ThrottlesExceptions(max, decay)` |
| `SkipIf` middleware | `queue.SkipIf(predicate)` |
| `queue:work` artisan command | `go run ./ queue <connection>` |
| `queue:restart` artisan command | `queue.RequestRestart(ctx)` |
| `queue:failed` table | `FailedStore` (memory / redis) |
| `queue:retry` artisan command | `Dispatcher.RetryFailed(ctx, id)` |
| Horizon tags | `TagsProvider.Tags()` / `queue.Tags(...)` |
| Horizon silenced | `SilencedProvider.Silenced()` / `queue.Silenced()` |
