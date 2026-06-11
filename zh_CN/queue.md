# Queue

- [简介](#简介)
  - [连接 vs. 队列](#连接-vs-队列)
  - [驱动注意事项与前提条件](#驱动注意事项与前提条件)
- [配置](#配置)
  - [配置文件](#配置文件)
  - [配置参数](#配置参数)
  - [RabbitMQ 配置](#rabbitmq-配置)
- [创建任务](#创建任务)
  - [任务结构](#任务结构)
  - [任务策略接口](#任务策略接口)
  - [唯一任务](#唯一任务)
  - [防抖任务](#防抖任务)
  - [加密任务](#加密任务)
- [任务中间件](#任务中间件)
  - [频率限制](#频率限制)
  - [防止任务重叠](#防止任务重叠)
  - [异常节流](#异常节流)
  - [跳过任务](#跳过任务)
  - [自定义中间件](#自定义中间件)
- [分发任务](#分发任务)
  - [延迟分发](#延迟分发)
  - [同步分发](#同步分发)
  - [任务链](#任务链)
  - [自定义队列与连接](#自定义队列与连接)
  - [指定最大尝试次数与超时](#指定最大尝试次数与超时)
  - [错误处理](#错误处理)
- [任务批处理](#任务批处理)
  - [分发批次](#分发批次)
  - [检查批次](#检查批次)
  - [取消批次](#取消批次)
- [运行队列 Worker](#运行队列-worker)
  - [queue:work 命令](#queuework-命令)
  - [队列优先级](#队列优先级)
  - [Worker 与部署](#worker-与部署)
  - [任务过期与超时](#任务过期与超时)
- [处理失败任务](#处理失败任务)
  - [清理失败任务](#清理失败任务)
  - [重试失败任务](#重试失败任务)
  - [失败任务事件](#失败任务事件)
- [生命周期事件](#生命周期事件)
- [加密 Payload](#加密-payload)
- [自定义驱动](#自定义驱动)
- [错误常量](#错误常量)
- [内置连接能力矩阵](#内置连接能力矩阵)
- [Laravel Queue 映射](#laravel-queue-映射)

---

## 简介

`github.com/prismgo/framework/queue` 是 Laravel Queue 风格的 Go 队列组件，用于把耗时、可重试、可延迟的任务从主请求流程中拆出来异步执行。

适合用来处理：

- 发送短信、站内信、企微消息、邮件
- 导出报表、生成文件、处理图片和视频
- 调用第三方接口并按退避策略重试
- 批量任务拆分、链式任务编排
- 事件监听器异步化

### 连接 vs. 队列

在开始使用队列之前，理解"连接"和"队列"的区别很重要：

| 概念 | 说明 | 示例 |
| --- | --- | --- |
| **连接（Connection）** | 队列后端驱动，对应一个具体的消息中间件 | `sync`、`redis`、`rabbitmq` |
| **队列（Queue）** | 同一连接内的逻辑分组，类似命名管道 | `default`、`high`、`mail`、`exports` |

每个连接可以包含多个队列。你可以把高优先级任务投递到 `high` 队列，普通任务投递到 `default` 队列，Worker 按优先级顺序消费。

### 驱动注意事项与前提条件

| 驱动 | 前提条件 | 适用场景 |
| --- | --- | --- |
| `sync` | 无额外依赖 | 测试、本地开发、无需后台 Worker 的简单场景 |
| `redis` | 需要 `github.com/prismgo/framework/redis` 包已注册连接池 | 生产环境后台消费 |
| `rabbitmq` | 需要 RabbitMQ 服务可用 | 使用 AMQP 后端的生产环境 |

## 配置

### 配置文件

队列的配置集中注册在 `config/queue.go`：

```go
config.Add("queue", func() map[string]interface{} {
    return map[string]interface{}{
        "default":  Env("QUEUE_CONNECTION", "sync"),
        "encoding": Env("QUEUE_ENCODING", ""),
        "failed": map[string]interface{}{
            "driver": Env("QUEUE_FAILED_DRIVER", "memory"),
            "store":  Env("QUEUE_FAILED_STORE", "default"),
            "prefix": Env("QUEUE_FAILED_PREFIX", "workorder_queue"),
            "ttl":    Env("QUEUE_FAILED_TTL", 0),
        },
        "batching": map[string]interface{}{
            "driver": Env("QUEUE_BATCHING_DRIVER", "memory"),
            "store":  Env("QUEUE_BATCHING_STORE", "default"),
            "prefix": Env("QUEUE_BATCHING_PREFIX", "workorder_queue"),
            "ttl":    Env("QUEUE_BATCHING_TTL", 0),
        },
        "restart": map[string]interface{}{
            "cache": Env("QUEUE_RESTART_CACHE", ""),
            "key":   Env("QUEUE_RESTART_KEY", "prismgo:queue:restart"),
        },
        "connections": map[string]interface{}{
            "sync":    map[string]interface{}{ /* ... */ },
            "redis":   map[string]interface{}{ /* ... */ },
            "rabbitmq": map[string]interface{}{ /* ... */ },
        },
    }
})
```

### 配置参数

#### 顶层配置

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.default` | `QUEUE_CONNECTION` | `sync` | 默认连接名称 |
| `queue.encoding` | `QUEUE_ENCODING` | `""`（继承 `encoding.default`，最终默认 `msgpack`） | Payload 编码方式，支持 `msgpack` 或 `json` |

#### Sync 连接

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.connections.sync.driver` | — | `sync` | 驱动类型 |
| `queue.connections.sync.queue` | `SYNC_QUEUE` | `default` | 默认队列名 |

#### Redis 连接

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.connections.redis.driver` | — | `redis` | 驱动类型 |
| `queue.connections.redis.queue` | `REDIS_QUEUE` | `default` | 默认队列名 |
| `queue.connections.redis.prefix` | `REDIS_QUEUE_PREFIX` | `workorder_queue` | Redis queue transport key 前缀 |
| `queue.connections.redis.connection` | `REDIS_QUEUE_CONNECTION` | `default` | 使用的 `database.redis.{connection}` 连接名 |
| `queue.connections.redis.retry_after` | `REDIS_QUEUE_RETRY_AFTER` | `90` | reserved 任务超时后重新可见的秒数 |
| `queue.connections.redis.block_for` | `REDIS_QUEUE_BLOCK_FOR` | `0` | Worker 阻塞等待任务的秒数 |

#### 失败任务存储

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.failed.driver` | `QUEUE_FAILED_DRIVER` | `memory` | 存储驱动，支持 `memory`、`redis` |
| `queue.failed.store` | `QUEUE_FAILED_STORE` | `default` | Redis failed store 使用的连接名 |
| `queue.failed.prefix` | `QUEUE_FAILED_PREFIX` | `workorder_queue` | Redis failed store key 前缀 |
| `queue.failed.ttl` | `QUEUE_FAILED_TTL` | `0` | 失败任务 TTL，`0` 表示不过期 |

#### 批次状态存储

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.batching.driver` | `QUEUE_BATCHING_DRIVER` | `memory` | 存储驱动，支持 `memory`、`redis` |
| `queue.batching.store` | `QUEUE_BATCHING_STORE` | `default` | Redis batch store 使用的连接名 |
| `queue.batching.prefix` | `QUEUE_BATCHING_PREFIX` | `workorder_queue` | Redis batch store key 前缀 |
| `queue.batching.ttl` | `QUEUE_BATCHING_TTL` | `0` | 批次状态 TTL，`0` 表示不过期 |

#### 重启信号存储

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.restart.cache` | `QUEUE_RESTART_CACHE` | 空 | 使用的 cache store；空值表示应用默认 cache store |
| `queue.restart.key` | `QUEUE_RESTART_KEY` | `prismgo:queue:restart` | 重启信号 key |

### RabbitMQ 配置

RabbitMQ 连接的私有字段保存在 connection `options` 中，由 RabbitMQ connector 解析。应用侧通常只需设置 `QUEUE_CONNECTION=rabbitmq` 和 RabbitMQ 连接参数，其余字段使用默认值即可。

#### 连接参数

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.connections.rabbitmq.url` | `RABBITMQ_URL` | 空 | 完整 AMQP URL；非空时优先于分字段配置 |
| `queue.connections.rabbitmq.scheme` | `RABBITMQ_SCHEME` | `amqp` | AMQP 协议头 |
| `queue.connections.rabbitmq.host` | `RABBITMQ_HOST` | `127.0.0.1` | Broker 主机 |
| `queue.connections.rabbitmq.port` | `RABBITMQ_PORT` | `5672` | Broker 端口 |
| `queue.connections.rabbitmq.username` | `RABBITMQ_USERNAME` | 空 | 用户名 |
| `queue.connections.rabbitmq.password` | `RABBITMQ_PASSWORD` | 空 | 密码 |
| `queue.connections.rabbitmq.vhost` | `RABBITMQ_VHOST` | `/` | Virtual host |

#### Exchange 与 Queue

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.connections.rabbitmq.exchange` | `RABBITMQ_EXCHANGE` | `prismgo.queue` | 业务消息使用的 exchange |
| `queue.connections.rabbitmq.exchange_type` | `RABBITMQ_EXCHANGE_TYPE` | `direct` | Exchange 类型；默认 direct，routing key 等于 queue name |
| `queue.connections.rabbitmq.declare` | `RABBITMQ_DECLARE` | `true` | 是否自动声明 exchange、queue、binding |
| `queue.connections.rabbitmq.exchange_durable` | `RABBITMQ_EXCHANGE_DURABLE` | `true` | Exchange 是否持久化 |
| `queue.connections.rabbitmq.queue_durable` | `RABBITMQ_QUEUE_DURABLE` | `true` | 业务 queue 是否持久化 |
| `queue.connections.rabbitmq.queue_max_priority` | `RABBITMQ_QUEUE_MAX_PRIORITY` | `0` | `x-max-priority`；`0` 表示不开启优先级队列 |
| `queue.connections.rabbitmq.message_persistent` | `RABBITMQ_MESSAGE_PERSISTENT` | `true` | 消息是否使用 persistent delivery mode |
| `queue.connections.rabbitmq.auto_delete` | `RABBITMQ_AUTO_DELETE` | `false` | Exchange/queue 无使用者时是否自动删除 |
| `queue.connections.rabbitmq.exclusive` | `RABBITMQ_EXCLUSIVE` | `false` | Queue 是否仅允许当前连接独占 |
| `queue.connections.rabbitmq.no_wait` | `RABBITMQ_NO_WAIT` | `false` | 声明资源时是否不等待 broker 响应 |

#### 发布与确认

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.connections.rabbitmq.confirm` | `RABBITMQ_CONFIRM` | `true` | 发布时是否等待 publisher confirm |
| `queue.connections.rabbitmq.publish_timeout` | `RABBITMQ_PUBLISH_TIMEOUT` | `5` | 发布、等待重连和 confirm 的超时秒数 |
| `queue.connections.rabbitmq.publish_channels` | `RABBITMQ_PUBLISH_CHANNELS` | `1` | 发布专用 AMQP channel 池大小 |

#### 延迟模式

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.connections.rabbitmq.delay_mode` | `RABBITMQ_DELAY_MODE` | `plugin` | 延迟模式：`plugin`、`ttl_dlx` 或 `none` |
| `queue.connections.rabbitmq.delay_buckets` | `RABBITMQ_DELAY_BUCKETS` | `5,10,30,60,300,900,3600` | `ttl_dlx` 模式的固定延迟 bucket（秒） |

#### 消费与重连

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.connections.rabbitmq.prefetch` | `RABBITMQ_PREFETCH` | `1` | Consumer 预取数量 |
| `queue.connections.rabbitmq.heartbeat` | `RABBITMQ_HEARTBEAT` | `10` | AMQP heartbeat 秒数 |
| `queue.connections.rabbitmq.reconnect_min_delay` | `RABBITMQ_RECONNECT_MIN_DELAY` | `100ms` | 断线后最小重连退避 |
| `queue.connections.rabbitmq.reconnect_max_delay` | `RABBITMQ_RECONNECT_MAX_DELAY` | `5s` | 断线后最大重连退避 |
| `queue.connections.rabbitmq.block_for` | `RABBITMQ_BLOCK_FOR` | `1` | Pop 阻塞等待秒数 |

#### 重启与拓扑缓存

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queue.connections.rabbitmq.restart_queue` | `RABBITMQ_RESTART_QUEUE` | `prismgo.queue.restart` | 跨进程时间戳队列 |
| `queue.connections.rabbitmq.restart_enabled` | `RABBITMQ_RESTART_ENABLED` | `true` | 是否启用 RabbitMQ RestartStore |
| `queue.connections.rabbitmq.restart_poll_interval` | `RABBITMQ_RESTART_POLL_INTERVAL` | `1s` | 读取 restart queue 的本地降载窗口 |
| `queue.connections.rabbitmq.topology_cache_ttl` | `RABBITMQ_TOPOLOGY_CACHE_TTL` | `0` | 拓扑缓存 sliding TTL；`0` 表示不按时间淘汰 |
| `queue.connections.rabbitmq.topology_cache_max_entries` | `RABBITMQ_TOPOLOGY_CACHE_MAX_ENTRIES` | `0` | 拓扑缓存容量上限；`0` 表示不按容量淘汰 |

> **注意**：不要在 RabbitMQ 连接中显式配置非零 `retry_after`。RabbitMQ 不支持 Redis 风格的 visibility timeout，如果显式传入非零 `retry_after`，Manager 初始化会返回 `queue.ErrUnsupportedRetryAfter`。

## 创建任务

### 任务结构

Job 的最小契约只有一个方法：

```go
type Job interface {
    Handle(context.Context) error
}
```

创建一个任务只需实现 `Handle` 方法，并在 `init` 中注册类型：

```go
package jobs

import (
    "context"
    "fmt"
    "time"

    "github.com/prismgo/framework/queue"
)

type SendWelcomeMailJob struct {
    UserID uint   `json:"user_id"`
    Email  string `json:"email"`
}

func init() {
    queue.RegisterType[*SendWelcomeMailJob]()
}

func (j *SendWelcomeMailJob) Handle(ctx context.Context) error {
    fmt.Printf("send welcome mail to user=%d email=%s\n", j.UserID, j.Email)
    return nil
}
```

**类型注册很重要**：Redis Worker 是独立进程时，只能通过 `RegisterType[*T]()` 知道如何恢复 Job。推荐在 Job 所在包的 `init` 中注册。

**Payload 规范**：Job 会按 Payload Encoding 序列化保存到队列。只把业务 ID、必要快照和幂等判断字段放进 Job，不要把数据库连接、repository、service、logger 等运行时对象放进 payload。

### 任务策略接口

除 `Handle` 外，其余接口都是可选能力。实现某个方法后，`Dispatch` 会在投递时读取它并写入任务 envelope；Worker 后续按 envelope 中的策略执行。

| 接口名 | 方法 | 用途 | 可被投递选项覆盖 |
| --- | --- | --- | --- |
| `ConnectionProvider` | `QueueConnection() string` | 指定默认连接 | `queue.OnConnection` |
| `QueueProvider` | `QueueName() string` | 指定默认队列 | `queue.OnQueue` |
| `DelayProvider` | `QueueDelay() time.Duration` | 指定默认延迟 | `queue.Delay` |
| `TriesProvider` | `Tries() int` | 最大执行次数 | `queue.Tries` |
| `TimeoutProvider` | `Timeout() time.Duration` | 单次执行超时 | `queue.Timeout` |
| `BackoffProvider` | `Backoff() []time.Duration` | 失败后退避序列 | `queue.Backoff` |
| `RetryUntilProvider` | `RetryUntil() time.Time` | 重试截止时间 | `queue.RetryUntil` |
| `MaxExceptionsProvider` | `MaxExceptions() int` | 最大异常次数 | `queue.MaxExceptions` |
| `FailOnTimeoutProvider` | `FailOnTimeout() bool` | 超时后直接失败 | `queue.FailOnTimeout` |
| `EncryptedProvider` | `ShouldEncrypt() bool` | 加密 payload | `queue.Encrypt` |
| `MiddlewareProvider` | `Middleware() []Middleware` | Job 级中间件 | 否 |
| `UniqueIDProvider` | `UniqueID() string` | 唯一任务 key | `queue.Unique` |
| `UniqueForProvider` | `UniqueFor() time.Duration` | 唯一锁 TTL | `queue.Unique` |
| `UniqueViaProvider` | `UniqueVia() cachecontract.Repository` | 唯一锁缓存 store | `queue.UniqueVia` |
| `UniqueUntilProcessingProvider` | `UniqueUntilProcessing() bool` | 处理前释放唯一锁 | `queue.UniqueUntilProcessing` |
| `DebounceIDProvider` | `DebounceID() string` | 防抖 key | `queue.Debounce` |
| `DebounceForProvider` | `DebounceFor() time.Duration` | 防抖窗口 | `queue.Debounce` |
| `DebounceViaProvider` | `DebounceVia() cachecontract.Repository` | 防抖缓存 store | `queue.DebounceVia` |
| `FailedProvider` | `Failed(context.Context, error)` | 最终失败回调 | 否 |
| `TagsProvider` | `Tags() []string` | Horizon 展示标签 | `queue.Tags` |
| `SilencedProvider` | `Silenced() bool` | Horizon 静默 | `queue.Silenced` |

**策略优先级**：`DispatchOption` > Job 方法 > Manager/Worker 默认值。

下面示例展示一个较完整的 Job，实际项目中只实现需要的接口即可：

```go
type SyncOrderJob struct {
    OrderID  uint   `json:"order_id"`
    TenantID uint   `json:"tenant_id"`
}

func (j *SyncOrderJob) Handle(ctx context.Context) error {
    if j.OrderID == 0 {
        return queue.Fail(errors.New("missing order id"))
    }
    // 在 Handle 内重新获取 service/repository，再按 ID 查询最新业务数据。
    return nil
}

func (j *SyncOrderJob) QueueConnection() string { return "redis" }
func (j *SyncOrderJob) QueueName() string       { return "orders" }
func (j *SyncOrderJob) Tries() int              { return 5 }
func (j *SyncOrderJob) Timeout() time.Duration  { return 30 * time.Second }
func (j *SyncOrderJob) FailOnTimeout() bool     { return true }
func (j *SyncOrderJob) MaxExceptions() int      { return 3 }
func (j *SyncOrderJob) Backoff() []time.Duration {
    return []time.Duration{time.Second, 10 * time.Second, time.Minute}
}
func (j *SyncOrderJob) RetryUntil() time.Time {
    return time.Now().Add(15 * time.Minute)
}
func (j *SyncOrderJob) ShouldEncrypt() bool { return true }
func (j *SyncOrderJob) UniqueID() string {
    return fmt.Sprintf("sync-order:%d", j.OrderID)
}
func (j *SyncOrderJob) UniqueFor() time.Duration { return 10 * time.Minute }
func (j *SyncOrderJob) Middleware() []queue.Middleware {
    return []queue.Middleware{
        queue.WithoutOverlapping(fmt.Sprintf("sync-order:%d", j.OrderID)).
            ReleaseAfter(30 * time.Second).
            ExpireAfter(10 * time.Minute),
    }
}
func (j *SyncOrderJob) Failed(ctx context.Context, err error) {
    // 记录最终失败日志或发送告警
}
```

### 唯一任务

唯一任务用于防止同一业务 key 重复入队。锁存在时，`Dispatch` 返回 `queue.ErrDuplicate`。

```go
func (j *SyncOrderJob) UniqueID() string {
    return fmt.Sprintf("sync-order:%d", j.OrderID)
}

func (j *SyncOrderJob) UniqueFor() time.Duration {
    return 10 * time.Minute
}
```

指定缓存 store：

```go
func (j *SyncOrderJob) UniqueVia() cachecontract.Repository {
    return cache.Store("redis")
}
```

只在任务开始处理前保持唯一锁（允许处理期间新的任务入队）：

```go
func (j *SyncOrderJob) UniqueUntilProcessing() bool { return true }
```

也可以只对单次投递启用：

```go
_, err := queue.Dispatch(
    ctx,
    &jobs.SyncOrderJob{OrderID: 10001},
    queue.Unique("sync-order:10001", 10*time.Minute),
    queue.UniqueVia(cache.Store("redis")),
)
```

处理重复投递：

```go
_, err := queue.Dispatch(ctx, &jobs.SyncOrderJob{OrderID: 10001})
if errors.Is(err, queue.ErrDuplicate) {
    return nil // 已有同 key 任务在队列中，忽略
}
if err != nil {
    return err
}
```

**唯一任务 vs. WithoutOverlapping**：

| 能力 | 语义 | 适用场景 |
| --- | --- | --- |
| 唯一任务 | 已有同 key 任务时，后续投递直接失败 | 防止重复同步、重复结算、重复通知 |
| WithoutOverlapping | 同 key 任务不并发执行，但可以排队 | 允许多个任务入队，但不允许同一业务 ID 并发执行 |

### 防抖任务

防抖适合"短时间内多次触发，只执行最后一次"的场景，例如刷新索引、重算统计。

```go
type RefreshCustomerStatsJob struct {
    CustomerID uint `json:"customer_id"`
}

func (j *RefreshCustomerStatsJob) Handle(ctx context.Context) error {
    // 重算客户统计
    return nil
}

func (j *RefreshCustomerStatsJob) DebounceID() string {
    return fmt.Sprintf("customer:stats:%d", j.CustomerID)
}

func (j *RefreshCustomerStatsJob) DebounceFor() time.Duration {
    return 30 * time.Second
}

func (j *RefreshCustomerStatsJob) DebounceVia() cachecontract.Repository {
    return cache.Store("redis")
}
```

单次投递启用防抖：

```go
_, err := queue.Dispatch(
    ctx,
    &jobs.RefreshCustomerStatsJob{CustomerID: 1001},
    queue.Debounce("customer:stats:1001", 30*time.Second),
    queue.DebounceVia(cache.Store("redis")),
)
```

防抖投递时，如果当前延迟小于防抖窗口，组件会把任务可执行时间推迟到窗口之后。Worker 消费旧任务时会检查它是否已经不是该 key 的最后一次投递；旧任务会被删除，不再执行 `Handle`。

**唯一任务 vs. 防抖任务**：

| 能力 | 语义 | 适用场景 |
| --- | --- | --- |
| 唯一任务 | 已有同 key 任务时，后续投递直接失败并返回 `ErrDuplicate` | 防止重复同步、重复结算 |
| 防抖任务 | 同 key 后续投递会覆盖前面的投递，只执行最后一次 | 搜索索引刷新、统计重算、频繁编辑后的延迟保存 |

### 加密任务

如果 Job payload 包含敏感字段，可以加密保存：

```go
func (j *SendWelcomeMailJob) ShouldEncrypt() bool { return true }
```

或只加密单次投递：

```go
_, err := queue.Dispatch(ctx, &jobs.SendWelcomeMailJob{UserID: 1001}, queue.Encrypt())
```

加密使用 AES-GCM，密钥来自 `app.key` 配置，支持 `base64:` 前缀（与 Laravel 兼容）。

## 任务中间件

Job 可以实现 `Middleware() []queue.Middleware` 声明自己的执行中间件。Manager 也可以通过 `UseMiddleware` 注册全局中间件。执行顺序是：Manager 全局 middleware 在前，Job 自身 middleware 在后。

### 频率限制

`RateLimit` 限制任务执行频率，适合短信、邮件、第三方 API。超过限制时，任务不会失败，而是通过 `ReleaseAfter` 释放回队列，等待窗口恢复后再执行。

```go
func (j *SendWelcomeMailJob) Middleware() []queue.Middleware {
    return []queue.Middleware{
        queue.RateLimit("mail:provider", 20, time.Second),
    }
}
```

也可以注册成 Manager 级全局 middleware：

```go
queue.UseMiddleware(queue.RateLimit("queue:global", 1000, time.Minute))
```

### 防止任务重叠

`WithoutOverlapping` 保证同一 key 的任务不会并发执行。它和唯一任务不同：唯一任务控制"能不能入队"，`WithoutOverlapping` 控制"能不能同时执行"。

拿不到锁时默认释放回队列稍后再试：

```go
func (j *SyncOrderJob) Middleware() []queue.Middleware {
    return []queue.Middleware{
        queue.WithoutOverlapping(fmt.Sprintf("sync-order:%d", j.OrderID)).
            ReleaseAfter(30 * time.Second).
            ExpireAfter(10 * time.Minute).
            Via(cache.Store("redis")),
    }
}
```

拿不到锁时直接跳过：

```go
queue.WithoutOverlapping("sync-order:10001").DontRelease()
```

| 方法 | 说明 |
| --- | --- |
| `ReleaseAfter(d)` | 拿不到锁时多久后释放回队列 |
| `DontRelease()` | 拿不到锁时直接跳过当前任务 |
| `ExpireAfter(d)` | 执行锁的最长持有时间 |
| `Via(store)` | 指定互斥锁使用的缓存 store |
| `Shared()` | 保留 Laravel 风格 API；当前锁 key 默认已在连接范围内共享 |

### 异常节流

`ThrottlesExceptions` 在第三方连续异常时暂停一段时间再继续尝试。`max` 表示异常阈值，`decay` 表示达到阈值后的冷却时间。

```go
func (j *SyncProviderJob) Middleware() []queue.Middleware {
    return []queue.Middleware{
        queue.ThrottlesExceptions(10, 5*time.Minute).
            By("provider:sync").
            Via(cache.Store("redis")).
            Backoff(30 * time.Second).
            When(func(err error) bool {
                return !errors.Is(err, context.Canceled)
            }),
    }
}
```

| 方法 | 说明 |
| --- | --- |
| `By(key)` | 指定异常节流 key，默认使用任务类型名 |
| `Backoff(d)` | 未达到节流阈值前的释放延迟 |
| `When(fn)` | 只让满足条件的错误参与计数 |
| `Via(store)` | 指定异常节流计数使用的缓存 store |

### 跳过任务

`SkipIf` 在 predicate 返回 `true` 时跳过任务，Worker 会按成功处理并删除任务：

```go
func (j *SyncOrderJob) Middleware() []queue.Middleware {
    return []queue.Middleware{
        queue.SkipIf(func(job queue.Job) bool {
            j := job.(*SyncOrderJob)
            return j.OrderID == 0
        }),
    }
}
```

### 自定义中间件

```go
func TenantGuard(tenantID uint) queue.Middleware {
    return queue.MiddlewareFunc(func(ctx context.Context, job queue.Job, next queue.Next) error {
        if tenantID == 0 {
            return queue.ErrSkipped
        }
        return next(ctx)
    })
}
```

`queue.ErrSkipped` 表示任务被主动跳过，Worker 会按成功处理并删除任务。普通错误会进入重试或失败流程。

## 分发任务

基础投递：

```go
id, err := queue.Dispatch(ctx, &jobs.SyncOrderJob{
    OrderID:  10001,
    TenantID: 1,
})
```

投递时覆盖连接、队列、延迟、重试和超时：

```go
id, err := queue.Dispatch(
    ctx,
    &jobs.SyncOrderJob{OrderID: 10001, TenantID: 1},
    queue.OnConnection("redis").
        OnQueue("orders").
        Delay(30*time.Second).
        Tries(5).
        Timeout(20*time.Second).
        Backoff(5*time.Second, 30*time.Second, time.Minute).
        RetryUntil(time.Now().Add(15*time.Minute)),
)
_ = id
```

`DispatchOption` 是带链式方法的命名函数类型，因此任意一个 option 都可以作为链起点：

```go
id, err := queue.Dispatch(
    ctx,
    &jobs.SyncOrderJob{OrderID: 10001, TenantID: 1},
    queue.Delay(30*time.Second).
        OnConnection("redis").
        OnQueue("orders").
        Tries(5),
)
_ = id
```

### 延迟分发

使用 `Delay` 选项：

```go
id, err := queue.Dispatch(
    ctx,
    &jobs.SyncOrderJob{OrderID: 10001},
    queue.Delay(5 * time.Minute),
)
```

使用 `Later` 函数（秒级延迟）：

```go
id, err := queue.Later(ctx, 300, &jobs.SyncOrderJob{OrderID: 10001})
```

使用 `DelaySeconds` 选项：

```go
id, err := queue.Dispatch(
    ctx,
    &jobs.SyncOrderJob{OrderID: 10001},
    queue.DelaySeconds(300),
)
```

### 同步分发

`sync` 连接会在 `queue.Dispatch` 当前调用栈内同步执行任务。任务失败会直接返回给调用方，不会走 Worker retry 或 failed store。

```go
// 配置 QUEUE_CONNECTION=sync 时，Dispatch 直接同步执行
id, err := queue.Dispatch(ctx, &jobs.SyncOrderJob{OrderID: 10001})
```

也可以临时指定同步连接：

```go
id, err := queue.Dispatch(
    ctx,
    &jobs.SyncOrderJob{OrderID: 10001},
    queue.OnConnection("sync"),
)
```

### 任务链

链式任务按顺序执行，前一个成功后才投递下一个：

```go
id, err := queue.Chain(
    &jobs.ExtractMediaJob{ID: 1},
    &jobs.ConvertMediaJob{ID: 1},
    &jobs.NotifyMediaReadyJob{ID: 1},
).Options(
    queue.OnConnection("redis"),
    queue.OnQueue("media"),
    queue.Tries(3),
).Dispatch(ctx)
_ = id
```

链中任一任务失败，后续任务不会投递。

### 自定义队列与连接

通过 `DispatchOption` 覆盖 Job 默认的连接和队列：

```go
id, err := queue.Dispatch(
    ctx,
    &jobs.SendWelcomeMailJob{UserID: 1001},
    queue.OnConnection("redis"),
    queue.OnQueue("mail"),
)
```

### 指定最大尝试次数与超时

```go
id, err := queue.Dispatch(
    ctx,
    &jobs.SyncOrderJob{OrderID: 10001},
    queue.Tries(5),
    queue.Timeout(30*time.Second),
    queue.FailOnTimeout(),
    queue.Backoff(5*time.Second, 30*time.Second, time.Minute),
    queue.RetryUntil(time.Now().Add(15*time.Minute)),
    queue.MaxExceptions(3),
)
```

### 错误处理

在 `Handle` 内部，你可以控制任务的行为：

**普通错误**：触发重试判断，Worker 会根据 `tries`、`maxExceptions`、`retryUntil` 和 `backoff` 决定重新入队或写入失败任务。

```go
func (j *SyncOrderJob) Handle(ctx context.Context) error {
    if temporaryFailure() {
        return errors.New("provider timeout")
    }
    return nil
}
```

**直接失败**：不再重试，立即进入失败任务。

```go
func (j *SyncOrderJob) Handle(ctx context.Context) error {
    if j.OrderID == 0 {
        return queue.Fail(errors.New("missing order id"))
    }
    return nil
}
```

**释放回队列**：指定下次执行时间。

```go
func (j *SyncOrderJob) Handle(ctx context.Context) error {
    if providerBusy() {
        return queue.ReleaseAfter(2*time.Minute, errors.New("provider busy"))
    }
    return nil
}
```

**跳过任务**：Worker 按成功处理并删除任务。

```go
func (j *SyncOrderJob) Handle(ctx context.Context) error {
    if alreadyProcessed() {
        return queue.ErrSkipped
    }
    return nil
}
```

**最终失败回调**：只在任务最终失败时调用一次，不会在每次普通重试时调用。

```go
func (j *SyncOrderJob) Failed(ctx context.Context, err error) {
    logger.WithFields(map[string]any{
        "order_id":  j.OrderID,
        "tenant_id": j.TenantID,
    }).WithError(err).Error("sync order job failed finally")
}
```

## 任务批处理

批量任务适合把一个大任务拆成多个子任务，并跟踪整体进度。

### 分发批次

```go
status, err := queue.Batch(
    &jobs.ExportChunkJob{Chunk: 1},
    &jobs.ExportChunkJob{Chunk: 2},
    &jobs.ExportChunkJob{Chunk: 3},
).Name("customer-export").
    Options(queue.OnConnection("redis"), queue.OnQueue("exports")).
    Dispatch(ctx)
if err != nil {
    return err
}
_ = status
```

### 检查批次

```go
latest, err := queue.GetBatchStatus(ctx, status.ID)
if err != nil {
    return err
}
fmt.Printf("pending=%d processed=%d failed=%d\n",
    latest.Pending, latest.Processed, latest.Failed)
```

Worker 执行批次内任务时会自动调用 `queue.MarkBatchJob` 更新进度。成功路径标记 `success=true`；最终失败归档成功后标记 `success=false`；可重试失败不更新批次进度。

### 取消批次

```go
err := queue.CancelBatch(ctx, status.ID)
```

批次取消后，未执行的子任务会被跳过（返回 `queue.ErrBatchCancelled`）。

## 运行队列 Worker

### queue:work 命令

`sync` 连接不需要启动 Worker。`redis` 和 `rabbitmq` 连接需要启动 Worker 消费：

```bash
# 启动默认连接的 Worker
go run ./ queue

# 指定连接和队列
go run ./ queue redis --queue=high,default

# 只处理一个任务后退出
go run ./ queue --once

# 队列为空后退出
go run ./ queue --stop-when-empty

# 限制任务数和运行时间
go run ./ queue --max-jobs=1000 --max-time=3600
```

`queue` 命令同时保留 `queue:work` 别名。

| 参数 | 说明 |
| --- | --- |
| `{connection?}` | 队列连接名称，例如 `redis` |
| `--queue` | 逗号分隔的队列名，Worker 按顺序消费 |
| `--once` | 只处理一个任务后退出 |
| `--stop-when-empty` | 队列为空后退出 |
| `--sleep` | 队列为空时休眠秒数 |
| `--timeout` | 单个任务执行超时秒数 |
| `--tries` | 默认最大尝试次数 |
| `--backoff` | 失败后退避秒数，支持逗号分隔 |
| `--retry-after` | reserved 任务重新可见秒数 |
| `--max-jobs` | 处理指定数量任务后退出 |
| `--max-time` | 运行指定秒数后退出 |

代码中启动 Worker：

```go
manager, err := queue.Resolve()
if err != nil {
    return err
}

worker := queue.NewWorker(manager)
return worker.Work(ctx, queue.WorkerOptions{
    Connection: "redis",
    Queues:     []string{"high", "default"},
    Tries:      3,
    Backoff:    []time.Duration{5 * time.Second, 30 * time.Second},
    Timeout:    time.Minute,
})
```

### 队列优先级

Worker 按配置顺序消费队列。`--queue=high,default` 表示优先消费 `high` 队列，`high` 为空时才消费 `default`。

Worker 多队列消费时先按配置顺序对完整队列组执行一次非阻塞 Pop，避免空 high queue 的 `block_for` 延迟 low queue 已 ready 的任务；只有所有队列都空时，才对同一组队列执行阻塞等待。

### Worker 与部署

部署新代码后，需要重启 Worker 使其加载最新代码：

```bash
go run ./ queue:restart
```

Worker 会在当前任务执行完毕后自动退出，Supervisor 或进程管理器会自动拉起新 Worker。

`queue:restart` 信号通过 `RestartStore` 保存，Worker 会在任务之间检查该时间戳，并忽略早于 Worker 启动时间的旧信号。

### 任务过期与超时

| 配置 | 说明 |
| --- | --- |
| `retry_after` | Redis 保留任务超时后重新可见的秒数（默认 90 秒） |
| `Timeout()` | 单次任务执行超时，Worker 会给 `Handle` 传入带 deadline 的 context |
| `FailOnTimeout()` | 超时后直接失败而不是重试 |

> **注意**：`Handle` 内部应该尊重 `ctx.Done()`。如果任务忽略 context，即使 Worker 已经判定超时，内部耗时逻辑也可能继续运行到自然结束。

## 处理失败任务

### 清理失败任务

```bash
# 查看失败任务列表
go run ./ queue:failed

# 删除单条失败记录
go run ./ queue:forget failed-id

# 清空所有失败记录
go run ./ queue:flush
```

### 重试失败任务

```bash
# 重试单条失败任务
go run ./ queue:retry failed-id
```

失败任务保存完整 envelope，只要 Job 类型仍已注册，就可以通过 `queue:retry` 重新入队。

### 失败任务事件

任务最终失败时会触发 `queue.job_failed` 事件，并调用 Job 的 `Failed(ctx, err)` 方法（如果实现了 `FailedProvider`）。

```go
func (j *SyncOrderJob) Failed(ctx context.Context, err error) {
    logger.WithFields(map[string]any{
        "order_id": j.OrderID,
    }).WithError(err).Error("sync order job failed finally")
}
```

## 生命周期事件

| 事件名 | 结构体 | 说明 |
| --- | --- | --- |
| `queue.job_queued` | `JobQueued` | 任务已进入队列 |
| `queue.job_processing` | `JobProcessing` | Worker 即将执行 |
| `queue.job_processed` | `JobProcessed` | 执行成功 |
| `queue.job_released` | `JobReleased` | 失败后释放回队列等待重试 |
| `queue.job_failed` | `JobFailed` | 最终失败并写入失败任务 |
| `queue.batch_created` | `BatchEvent` | 批次创建 |
| `queue.batch_updated` | `BatchEvent` | 批次进度更新 |
| `queue.batch_cancelled` | `BatchEvent` | 批次取消 |
| `queue.batch_finished` | `BatchEvent` | 批次完成 |
| `queue.poison_envelope` | `PoisonEnvelope` | 消息体无法解码为 Envelope |
| `queue.release_republish_failed` | `InfrastructureEvent` | RabbitMQ release 替换发布失败 |

基础设施事件：

| 事件名 | 说明 |
| --- | --- |
| `queue.connection_connecting` | 连接正在建立 |
| `queue.connection_connected` | 连接已建立 |
| `queue.connection_disconnected` | 连接已断开 |
| `queue.connection_reconnecting` | 正在重连 |
| `queue.connection_reconnected` | 重连成功 |
| `queue.connection_reconnect_failed` | 重连失败 |
| `queue.topology_declared` | 拓扑声明成功 |
| `queue.topology_declare_failed` | 拓扑声明失败 |
| `queue.consumer_started` | 消费者已启动 |
| `queue.consumer_stopped` | 消费者已停止 |
| `queue.consumer_stop_failed` | 消费者停止失败 |
| `queue.publish_failed` | 发布失败 |

监听事件：

```go
queue.UseEventSink(func(ctx context.Context, ev queue.Event) {
    switch e := ev.(type) {
    case queue.JobFailed:
        logger.WithFields(map[string]any{
            "job": e.JobName,
            "id":  e.ID,
        }).WithError(errors.New(e.Error)).Warn("queue job failed")
    case queue.JobQueued:
        logger.Info("job queued", "id", e.JobID, "queue", e.Queue)
    }
})
```

## 加密 Payload

加密使用 AES-GCM，密钥来自 `app.key` 配置。`NewPayloadCipher(secret)` 支持 `base64:` 前缀，与 Laravel 密钥格式兼容。

```go
// Job 级声明
func (j *SendWelcomeMailJob) ShouldEncrypt() bool { return true }

// 投递级声明
_, err := queue.Dispatch(ctx, &jobs.SendWelcomeMailJob{UserID: 1001}, queue.Encrypt())
```

> **注意**：如果 `app.key` 为空，加密声明的 Job 将在运行期失败。启动时会在控制台输出警告。

## 自定义驱动

如果需要接入数据库队列或业务自研队列，实现 `contracts/queue` 包中的三个核心接口并注册为自定义 driver 即可。

### 需实现的接口

#### Connector — 连接工厂

`Connector` 负责根据连接名和配置创建 `Queue` 实例。Manager 在首次解析连接时调用 `Connect`，后续复用同一实例。

```go
type Connector interface {
    Connect(ctx context.Context, name string, config map[string]any) (Queue, error)
}
```

| 参数 | 说明 |
| --- | --- |
| `name` | 连接配置名，如 `"database"` |
| `config` | 连接配置副本，原始字段保存在 `config["_spec"].(ConnectionConfig).Options` 中 |

#### Queue — 队列传输连接

`Queue` 是队列 transport 的核心接口，定义了消息的入队、出队和生命周期操作。

```go
type Queue interface {
    // Push 将已编码 payload 推入指定队列
    Push(ctx context.Context, queue string, body Payload) error

    // Later 将已编码 payload 延迟推入指定队列
    Later(ctx context.Context, queue string, body Payload, delay time.Duration) error

    // Bulk 批量推入已编码 payload，返回 transport 已接收数量
    Bulk(ctx context.Context, queue string, bodies []Payload) (BulkResult, error)

    // Pop 从一个或多个队列中拉取一个 reserved job；无任务时返回 ErrEmpty
    Pop(ctx context.Context, queues []string, wait ...PopWaitMode) (ReservedJob, error)

    // Size 返回指定队列待处理任务数
    Size(ctx context.Context, queue string) (int64, error)

    // Clear 清空指定队列
    Clear(ctx context.Context, queue string) error

    // Close 释放连接资源
    Close() error
}
```

| 方法 | 用途 | 说明 |
| --- | --- | --- |
| `Push` | 立即入队 | `body` 是已编码的 envelope 字节，driver 不需要理解其内部结构 |
| `Later` | 延迟入队 | `delay` 为 0 时等同于 `Push`；不支持延迟的 driver 可返回 `ErrUnsupportedOperation` |
| `Bulk` | 批量入队 | 返回 `BulkResult{Accepted}` 表示 transport 已接收数量；不支持时可逐条调用 `Push` |
| `Pop` | 拉取任务 | `queues` 按优先级排列；`wait` 省略时默认 `PopWaitAvailable`，传入 `PopNoWait` 为非阻塞 |
| `Size` | 队列长度 | 返回待处理任务数；不支持时返回 `0, nil` |
| `Clear` | 清空队列 | 删除指定队列中所有待处理消息 |
| `Close` | 关闭连接 | 释放底层资源（数据库连接、客户端等） |

#### ReservedJob — 已保留任务

`ReservedJob` 表示 Worker 已从队列中取出的任务，Worker 通过该接口确认或释放任务。

```go
type ReservedJob interface {
    // ID 返回任务 ID
    ID() string

    // Name 返回任务类型名
    Name() string

    // Payload 返回原始已编码 payload 字节
    Payload() Payload

    // Attempts 返回当前任务已尝试次数
    Attempts() int

    // Delete 确认任务完成并从队列中删除
    Delete(ctx context.Context) error

    // Release 将任务释放回队列，delay 指定下次可执行前的等待时间
    Release(ctx context.Context, delay time.Duration) error
}
```

| 方法 | 用途 | 说明 |
| --- | --- | --- |
| `ID` | 任务标识 | 来自 envelope 中的 UUID |
| `Name` | 类型名 | 用于 Registry 反序列化 |
| `Payload` | 原始字节 | Worker 会用 codec 解码为 envelope，再恢复为 Job |
| `Attempts` | 已尝试次数 | Worker 用于判断是否超过 `Tries` |
| `Delete` | 确认完成 | 任务成功执行后调用 |
| `Release` | 释放重试 | 任务失败但可重试时调用，`delay` 控制退避时间 |

### 可选接口

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `PopSessionProvider` | `NewPopSession() Queue` | 为每个 Worker 创建独立的队列 view，用于安全关闭生命周期资源 |
| `ConsumerIntentLeaser` | `AcquireConsumerIntent(queues) (func() error, error)` | push-consumer 驱动（如 RabbitMQ）的 Worker 生命周期管理 |

### 完整示例：内存队列驱动

以下示例展示一个最简的自定义驱动实现：

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
    // 从 config["_spec"] 读取连接配置
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
    // 简化实现：忽略 delay，直接入队。生产驱动应使用定时器或延迟队列。
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
    id        string
    name      string
    body      queuecontract.Payload
    attempts  int
}

func (j *memoryReservedJob) ID() string                          { return j.id }
func (j *memoryReservedJob) Name() string                        { return j.name }
func (j *memoryReservedJob) Payload() queuecontract.Payload      { return j.body }
func (j *memoryReservedJob) Attempts() int                       { return j.attempts }
func (j *memoryReservedJob) Delete(_ context.Context) error      { return nil }
func (j *memoryReservedJob) Release(_ context.Context, _ time.Duration) error {
    // 简化实现：直接重新入队。生产驱动应将任务放回队列并设置延迟。
    return nil
}

// --- 注册 ---

func init() {
    queue.Extend("memory-custom", MemoryConnector{})
}
```

### 注册与配置

`queue.Extend` 可以在业务包 `init()` 中调用，不要求当前 Application 容器或 Queue Manager 已经创建。Manager 在首次解析连接时读取该注册表。

```go
// 在业务包 init() 中注册
func init() {
    queue.Extend("memory-custom", MemoryConnector{})
}
```

在配置中新增连接：

```go
// config/queue.go
"connections": map[string]interface{}{
    "memory-custom": map[string]interface{}{
        "driver": "memory-custom",
        "queue":  "default",
    },
},
```

Connector 的 `Connect(ctx, name, config)` 会收到连接名和配置副本，配置中的原始字段保存在 `config["_spec"].(ConnectionConfig).Options` 中，便于自定义 driver 自行解析扩展参数：

```go
func (c MyConnector) Connect(_ context.Context, name string, config map[string]any) (queuecontract.Queue, error) {
    spec, _ := config["_spec"].(queue.ConnectionConfig)
    // 从 spec.Options 读取 driver 私有配置
    tableName, _ := spec.Options["table"].(string)
    dbConnection, _ := spec.Options["connection"].(string)
    // ...
}
```

## 错误常量

| 错误常量 | 说明 |
| --- | --- |
| `ErrEmpty` | 当前队列没有可消费任务 |
| `ErrJobNotRegistered` | Job 类型未在注册表中注册 |
| `ErrDuplicate` | 唯一任务锁已存在，本次投递被跳过 |
| `ErrSkipped` | 任务被 middleware 主动跳过 |
| `ErrBatchCancelled` | 任务所属批次已取消 |
| `ErrManagerClosed` | 队列管理器已关闭 |
| `ErrConnectionClosed` | 连接已关闭 |
| `ErrUnsupportedOperation` | 当前 driver 不支持该操作 |
| `ErrPoisonEnvelope` | 消息体无法解码为 Envelope |
| `ErrUnsupportedRetryAfter` | RabbitMQ 不支持 `retry_after` |
| `ErrRabbitMQDialFailed` | RabbitMQ 初始建连失败 |
| `ErrRabbitMQTopologyMissing` | `declare=false` 时 exchange 或 queue 不存在 |
| `ErrRabbitMQPublishNacked` | Broker 拒绝了 publisher confirm |
| `ErrRabbitMQPublishTimeout` | 等待 publisher confirm 超时 |
| `ErrRabbitMQPublishConfirmClosed` | Confirm 通道已关闭 |
| `ErrRabbitMQPublishUnrouted` | Mandatory 发布未路由到任何队列 |
| `ErrRabbitMQReleaseRepublishFailed` | Release 替换发布失败 |

## 内置连接能力矩阵

| 能力 | sync | redis | rabbitmq |
| --- | --- | --- | --- |
| 异步投递 | 否（同步执行） | 是 | 是 |
| 延迟投递 | 否 | 是 | 是（plugin / ttl_dlx） |
| 批量投递 | 否 | 是 | 是 |
| 阻塞等待 | 否 | 是（`block_for`） | 是（push consumer） |
| `retry_after` | 否 | 是 | 否（返回 `ErrUnsupportedRetryAfter`） |
| Publisher confirm | — | — | 是（`RABBITMQ_CONFIRM`） |
| 自动重连 | — | — | 是（有界退避） |
| Poison envelope | — | 是 | 是（`Reject(false)`） |
| `Size` | — | 是 | 是（ready count only） |
| `Clear` | — | 是 | 是（purge ready only） |

高级功能与连接的关系：

| 高级功能 | 依赖 |
| --- | --- |
| 唯一任务 | `github.com/prismgo/framework/cache`（不依赖队列连接） |
| 防抖任务 | `github.com/prismgo/framework/cache`（不依赖队列连接） |
| `WithoutOverlapping` | `github.com/prismgo/framework/cache` 锁（不依赖队列连接） |
| `RateLimit` | `github.com/prismgo/framework/cache`（不依赖队列连接） |
| `ThrottlesExceptions` | `github.com/prismgo/framework/cache`（不依赖队列连接） |
| 失败任务命令 | `FailedStore` |
| `queue:restart` | `RestartStore` |
| 批量任务 | `BatchStore` |

## Laravel Queue 映射

| Laravel 方法/概念 | PrismGo 等价 |
| --- | --- |
| `Job::handle()` | `Job.Handle(ctx context.Context) error` |
| `dispatch(new Job)` | `queue.Dispatch(ctx, &Job{})` |
| `Job::dispatch($job)->delay(...)` | `queue.Dispatch(ctx, job, queue.Delay(...))` |
| `Job::$connection` | `ConnectionProvider.QueueConnection()` |
| `Job::$queue` | `QueueProvider.QueueName()` |
| `Job::$tries` | `TriesProvider.Tries()` |
| `Job::$timeout` | `TimeoutProvider.Timeout()` |
| `Job::$backoff` | `BackoffProvider.Backoff()` |
| `Job::retryUntil()` | `RetryUntilProvider.RetryUntil()` |
| `Job::$maxExceptions` | `MaxExceptionsProvider.MaxExceptions()` |
| `Job::$failOnTimeout` | `FailOnTimeoutProvider.FailOnTimeout()` |
| `ShouldBeEncrypted` | `EncryptedProvider.ShouldEncrypt()` |
| `Job::uniqueId()` | `UniqueIDProvider.UniqueID()` |
| `Job::$uniqueFor` | `UniqueForProvider.UniqueFor()` |
| `Job::uniqueVia()` | `UniqueViaProvider.UniqueVia()` |
| `Job::middleware()` | `MiddlewareProvider.Middleware()` |
| `Job::failed()` | `FailedProvider.Failed(ctx, err)` |
| `Bus::chain([...])->dispatch()` | `queue.Chain(...).Dispatch(ctx)` |
| `Bus::batch([...])->dispatch()` | `queue.Batch(...).Dispatch(ctx)` |
| `Queue::pushOn('queue', job)` | `queue.Dispatch(ctx, job, queue.OnQueue("queue"))` |
| `Queue::later(60, job)` | `queue.Later(ctx, 60, job)` |
| `php artisan queue:work` | `go run ./ queue` |
| `php artisan queue:restart` | `go run ./ queue:restart` |
| `php artisan queue:failed` | `go run ./ queue:failed` |
| `php artisan queue:retry {id}` | `go run ./ queue:retry {id}` |
| `php artisan queue:forget {id}` | `go run ./ queue:forget {id}` |
| `php artisan queue:flush` | `go run ./ queue:flush` |
| `WithoutOverlapping` | `queue.WithoutOverlapping(key)` |
| `ThrottlesExceptions` | `queue.ThrottlesExceptions(max, decay)` |
| `SkipIf` | `queue.SkipIf(predicate)` |
| `$job->release(delay)` | `queue.ReleaseAfter(delay, err)` |
| `$job->fail()` | `queue.Fail(err)` |
