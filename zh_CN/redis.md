# Redis

- [简介](#简介)
- [配置](#配置)
  - [基本配置](#基本配置)
  - [连接参数说明](#连接参数说明)
  - [URL 连接方式](#url-连接方式)
  - [高级连接选项](#高级连接选项)
  - [环境变量参考](#环境变量参考)
- [与 Redis 交互](#与-redis-交互)
  - [获取客户端](#获取客户端)
  - [执行 Redis 命令](#执行-redis-命令)
  - [事务](#事务)
  - [管道命令](#管道命令)
  - [发布 / 订阅](#发布--订阅)
- [连接管理](#连接管理)
  - [创建 Manager](#创建-manager)
  - [获取连接](#获取连接)
  - [多连接切换](#多连接切换)
  - [连接重用与缓存](#连接重用与缓存)
  - [连接重建](#连接重建)
  - [关闭连接](#关闭连接)
- [事件系统](#事件系统)
  - [事件类型](#事件类型)
  - [全局事件监听](#全局事件监听)
  - [连接级监听器](#连接级监听器)
  - [关闭事件](#关闭事件)
- [容器集成](#容器集成)
  - [ServiceProvider 注册](#serviceprovider-注册)
  - [容器解析](#容器解析)
  - [生命周期关闭](#生命周期关闭)
- [与其他组件集成](#与其他组件集成)
  - [缓存驱动](#缓存驱动)
  - [队列驱动](#队列驱动)
  - [Horizon 存储](#horizon-存储)
- [Facade 参考](#facade-参考)
- [Manager 接口参考](#manager-接口参考)
- [Connection 接口参考](#connection-接口参考)
- [事件类型参考](#事件类型参考)

---

## 简介

PrismGo Redis 组件为应用提供统一的 Redis 连接管理与命令事件观测能力。它是 `cache`、`queue`、`session`、`horizon` 等框架组件的底层共享基础设施。

**设计理念：** PrismGo 不重新抽象 Redis 命令全集，而是直接暴露 `go-redis` 的原生 `UniversalClient`。这意味着你可以使用所有 go-redis 支持的命令、Pipeline、Transaction、Pub/Sub 和 Lua 脚本，同时享受 PrismGo 提供的连接生命周期管理、懒加载和命令事件派发能力。

所有通过 PrismGo 管理的连接，都会自动安装 go-redis hook，产生命令成功/失败事件，便于日志、监控和 Horizon 等横切能力订阅。

## 配置

### 基本配置

Redis 连接配置统一存放在应用配置文件的 `database.redis` 节点下。框架 `config/database.go` 已提供了默认配置结构：

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

配置结构分为三个层级：

| 层级 | 说明 |
|------|------|
| `database.redis` | Redis 顶层配置，包含 `client`、`options` 和命名连接定义 |
| `client` | Redis 客户端实现标识，当前仅支持 `go` / `go-redis` / `redis` |
| `options` | 全局选项（当前为预留字段，供后续 cluster 或特殊 client 参数扩展） |
| `{name}` | 以连接名称为 key 的连接定义，如 `default`、`cache` |

### 连接参数说明

每个命名连接支持以下参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `host` | string | 否 | `127.0.0.1` | Redis 主机地址。与 `port` 组合使用；`addr` 设置后优先使用 `addr` |
| `port` | string | 否 | `6379` | Redis 端口号。与 `host` 组合使用 |
| `addr` | string | 否 | — | `host:port` 形式的完整地址。设置后优先于 `host`/`port` |
| `url` | string | 否 | — | Redis URL 连接串，支持完整的 `redis://user:pass@host:port/db?key=val` 格式。设置后内部通过 `go-redis.ParseURL` 解析 |
| `scheme` | string | 否 | — | 连接协议，设置为 `"tls"` 时启用 TLS 加密。用于连接云服务或需要 TLS 的 Redis 实例 |
| `username` | string | 否 | — | Redis ACL 用户名。Redis 6.0+ 启用 ACL 时使用 |
| `password` | string | 否 | — | Redis 认证密码。未启用认证时可以为空 |
| `database` / `db` | int | 否 | `0` | Redis 逻辑数据库编号（0-15）。`database` 和 `db` 均有效，`db` 优先级更高 |
| `name` | string | 否 | — | 连接客户端名称。设置后 `CLIENT SETNAME` 会在连接建立时生效，便于 `CLIENT LIST` 排查 |
| `timeout` | string | 否 | — | 连接超时时间，支持 duration 格式（如 `"3s"`、`"500ms"`）或整数秒。对应 go-redis `DialTimeout` |
| `read_timeout` | string | 否 | — | 读超时时间，支持 duration 格式或整数秒。对应 go-redis `ReadTimeout` |
| `write_timeout` | string | 否 | — | 写超时时间，支持 duration 格式或整数秒。对应 go-redis `WriteTimeout` |
| `max_retries` | int | 否 | — | 命令失败后最大重试次数。对应 go-redis `MaxRetries` |

**参数优先级规则：**

- **地址解析**：`addr` > `host` + `port`。即便通过 URL 配置了地址，显式设置的 `addr` 或 `host`/`port` 也会覆盖 URL 中的地址
- **库编号**：`db` > `database`。显式 `host`/`port`/`addr` 或 `DB` 字段非零时，会覆盖 URL 中的库编号
- **用户名/密码**：始终覆盖 URL 中的认证信息

### URL 连接方式

除了手动配置 host/port/db 等参数，你也可以使用 Redis URL 字符串一键配置：

```go
// config/database.go
"default": map[string]interface{}{
    "url":  Env("REDIS_URL", ""),
    "name": Env("REDIS_NAME", ""),
},
```

URL 格式示例：

```
redis://user:password@127.0.0.1:6379/2?dial_timeout=3s&read_timeout=2s&write_timeout=2s&max_retries=3
```

URL 中可携带的查询参数会被 `go-redis.ParseURL` 解析为对应的连接选项。

### 高级连接选项

当需要覆盖 go-redis 原生参数时，可以在连接配置的 `options` 字段中透传：

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

### 环境变量参考

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `REDIS_CLIENT` | `go` | Redis 客户端实现标识 |
| `REDIS_HOST` | `127.0.0.1` | 默认 Redis 主机地址 |
| `REDIS_PORT` | `6379` | 默认 Redis 端口 |
| `REDIS_USERNAME` | — | 默认 Redis ACL 用户名 |
| `REDIS_PASSWORD` | — | 默认 Redis 密码 |
| `REDIS_URL` | — | 默认连接的完整 URL |
| `REDIS_SCHEME` | — | 默认连接协议（设为 `tls` 启用加密） |
| `REDIS_MAIN_DB` | `1` | 默认连接的数据库编号 |
| `REDIS_CACHE_DB` | `0` | cache 连接的数据库编号 |
| `REDIS_NAME` | — | 默认连接的客户端名称 |
| `REDIS_CACHE_NAME` | — | cache 连接的客户端名称 |
| `REDIS_TIMEOUT` | — | 默认连接的超时时间 |
| `REDIS_CACHE_TIMEOUT` | — | cache 连接的超时时间 |
| `REDIS_READ_TIMEOUT` | — | 默认连接的读超时 |
| `REDIS_CACHE_READ_TIMEOUT` | — | cache 连接的读超时 |
| `REDIS_WRITE_TIMEOUT` | — | 默认连接的写超时 |
| `REDIS_CACHE_WRITE_TIMEOUT` | — | cache 连接的写超时 |
| `REDIS_MAX_RETRIES` | — | 默认连接的最大重试次数 |
| `REDIS_CACHE_MAX_RETRIES` | — | cache 连接的最大重试次数 |

## 与 Redis 交互

### 获取客户端

与 Redis 交互最简便的方式是通过 Facade 获取 `go-redis` 原生 `UniversalClient`：

```go
package main

import (
    "context"
    redis "github.com/prismgo/framework/redis"
)

func main() {
    // 获取默认连接的 go-redis 客户端
    client, err := redis.Client()
    if err != nil {
        panic(err)
    }

    // 获取指定连接的 go-redis 客户端
    cacheClient, err := redis.Client("cache")
    if err != nil {
        panic(err)
    }
}
```

你也可以获取 `Connection` 接口，同时访问客户端和连接级事件监听器：

```go
// 获取 Connection 实例
conn, err := redis.Connection()
if err != nil {
    return err
}

// 访问底层 go-redis 客户端
client := conn.Client()

// 获取连接名称
fmt.Println(conn.Name()) // "default"
```

### 执行 Redis 命令

通过 Facade 获取的客户端是 `go-redis` 原生 `UniversalClient`，可以使用所有 go-redis 支持的命令：

```go
ctx := context.Background()

// 字符串操作
err := client.Set(ctx, "user:1:name", "张三", 10*time.Minute).Err()
if err != nil {
    return err
}

name, err := client.Get(ctx, "user:1:name").Result()
if err != nil {
    return err
}
fmt.Println(name) // 张三

// 哈希操作
client.HSet(ctx, "user:1", "name", "张三", "age", "28")
username := client.HGet(ctx, "user:1", "name").Val()

// 列表操作
client.LPush(ctx, "queue:emails", "email_1", "email_2")
item := client.RPop(ctx, "queue:emails").Val()

// 集合操作
client.SAdd(ctx, "tags:golang", "web", "api", "cli")
members := client.SMembers(ctx, "tags:golang").Val()

// 有序集合操作
client.ZAdd(ctx, "leaderboard", redis.Z{Score: 100, Member: "玩家A"})
rank := client.ZRevRank(ctx, "leaderboard", "玩家A").Val()

// 自增计数
count, _ := client.Incr(ctx, "page:views").Result()
countBy, _ := client.IncrBy(ctx, "page:views", 10).Result()

// 键操作
exists, _ := client.Exists(ctx, "user:1:name").Result()
client.Expire(ctx, "session:abc", 30*time.Minute)
client.Del(ctx, "temp:data")
```

由于暴露的是 go-redis 的原生 API，你可以使用其完整的命令集，包括 `Scan`、`Keys`、`Pub/Sub`、`Lua Script` 等高级功能。

### 事务

使用 `TxPipeline` 实现 Redis 事务（MULTI/EXEC）。事务中的所有命令作为单个原子操作执行：

```go
pipe := client.TxPipeline()

incr := pipe.Incr(ctx, "counter")
pipe.Expire(ctx, "counter", time.Hour)

_, err := pipe.Exec(ctx)
if err != nil {
    return err
}

fmt.Println(incr.Val()) // 返回自增后的值
```

> **注意：** 在事务执行前无法读取值，因为所有命令是在 `Exec` 调用后才统一发送和执行的。

#### Lua 脚本

你可以通过 `go-redis` 客户端直接执行 Lua 脚本，实现原子性条件操作：

```go
// 定义一个仅在键不存在时才设置的 Lua 脚本
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

### 管道命令

Pipeline 将多个命令批量发送，减少网络往返次数，在需要执行大量命令时显著降低延迟：

```go
pipe := client.Pipeline()

// 批量设置缓存
for _, user := range users {
    key := fmt.Sprintf("user:%d:profile", user.ID)
    data, _ := json.Marshal(user)
    pipe.Set(ctx, key, data, time.Hour)
}

// 执行 pipeline
cmds, err := pipe.Exec(ctx)
if err != nil {
    return err
}

// 检查每个命令的结果
for _, cmd := range cmds {
    if cmd.Err() != nil {
        log.Printf("pipeline command failed: %v", cmd.Err())
    }
}
```

> **注意：** Pipeline / TxPipeline 执行成功后，PrismGo 会产生 `CommandBatchExecuted` 事件；执行失败则产生 `CommandBatchFailed` 事件，不会产生单个命令事件。

### 发布 / 订阅

由于 PrismGo 暴露了 go-redis 原生客户端，你可以直接使用其内置的 Pub/Sub 能力：

```go
// 发布消息
err := client.Publish(ctx, "notifications", "新订单已接收").Err()
if err != nil {
    return err
}
```

```go
// 订阅频道
sub := client.Subscribe(ctx, "notifications")
defer sub.Close()

// 等待消息
ch := sub.Channel()
for msg := range ch {
    fmt.Printf("收到消息 [%s]: %s\n", msg.Channel, msg.Payload)
}
```

```go
// 模式订阅（psubscribe）
sub := client.PSubscribe(ctx, "orders:*")
defer sub.Close()

ch := sub.Channel()
for msg := range ch {
    fmt.Printf("收到消息 [%s]: %s\n", msg.Channel, msg.Payload)
}
```

## 连接管理

### 创建 Manager

Manager 是 Redis 能力的核心管理器，负责按名称懒加载并缓存连接：

```go
import (
    configpkg "github.com/prismgo/framework/config"
    redis "github.com/prismgo/framework/redis"
)

// 方式一：从配置仓库读取
repo := configpkg.Resolve()
cfg := redis.ConfigFromRepository(repo)
manager, err := redis.NewManager(cfg)
if err != nil {
    return err
}
defer manager.Close(context.Background())

// 方式二：从当前 Application Facade 严格读取（provider 推荐）
manager, err := redis.NewManagerFromConfig()
if err != nil {
    return err
}

// 方式三：手工构造配置（测试场景）
manager, err := redis.NewManager(redis.Config{
    DefaultName: "default",
    Connections: map[string]redis.ConnectionConfig{
        "default": {Name: "default", Host: "127.0.0.1", Port: "6379", DB: 0},
        "cache":   {Name: "cache", Host: "127.0.0.1", Port: "6379", DB: 1},
    },
})
```

**三种创建方式的适用场景：**

| 方式 | 适用场景 |
|------|----------|
| `NewManager(cfg)` | 测试代码、手工控制配置 |
| `NewManagerFromConfig()` | ServiceProvider 注册、应用启动路径 |
| `ConfigFromRepository(repo)` | 需要从已有配置仓库读取 |

### 获取连接

Manager 创建后，按连接名称获取连接。连接在首次请求时懒加载创建：

```go
// 获取默认连接
conn, err := manager.Connection()
if err != nil {
    return err
}

// 获取 cache 连接
cacheConn, err := manager.Connection("cache")
if err != nil {
    return err
}

// 获取默认连接（显式写法）
defaultConn, err := manager.DefaultConnection()
if err != nil {
    return err
}

// 获取 go-redis 原生客户端
client := conn.Client()

// 获取连接名称
fmt.Println(conn.Name()) // "default"
```

> **懒加载保证：** `NewManager` 只校验配置，不连接 Redis。真正的 go-redis client 在首次 `Connection(name)` 调用时才创建。这意味着 ServiceProvider 注册阶段不会产生网络副作用。

### 多连接切换

可以在同一应用中管理多个 Redis 连接，按功能隔离数据库：

```go
// 默认连接存放业务主数据（DB 1）
mainClient, _ := redis.Client() // 使用 "default"

// cache 连接存放缓存数据（DB 0）
cacheClient, _ := redis.Client("cache")

// 按需扩展更多连接（需在配置中预先定义）
```

在 `config/database.go` 中定义更多连接：

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

### 连接重用与缓存

同名连接第一次创建后会被缓存，后续调用直接返回已缓存的连接对象：

```go
conn1, _ := manager.Connection("cache")
conn2, _ := manager.Connection("cache")

// conn1 和 conn2 是同一个连接对象
fmt.Println(conn1 == conn2) // true
```

可以通过 `Connections()` 查看当前已创建的连接快照：

```go
for name, conn := range manager.Connections() {
    log.Printf("连接: %s, 客户端: %T", name, conn.Client())
}
```

> **注意：** `Connections()` 只返回已经通过 `Connection()` / `DefaultConnection()` 解析过的连接，不会为了生成快照而创建新连接。

### 连接重建

`Purge` 方法关闭并移除指定连接，下次调用 `Connection` 时会读取当前配置重新创建：

```go
// 关闭并移除 cache 连接
if err := manager.Purge("cache"); err != nil {
    return err
}

// 重新获取时会创建新的 go-redis client
newConn, err := manager.Connection("cache")
if err != nil {
    return err
}
```

> **适用场景：** 测试隔离、配置热替换、连接异常后强制重建。

### 关闭连接

`Close` 关闭所有已解析的 Redis 连接。通常在应用关闭链路中调用：

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

if err := manager.Close(ctx); err != nil {
    log.Printf("关闭 Redis 连接出错: %v", err)
}
```

**关闭行为：**

- 只关闭已经解析过的连接，不会创建尚未解析的连接
- 即便某个连接关闭失败，也会继续尝试关闭剩余连接，并返回第一个遇到的错误
- ctx 取消时，已关闭的连接会被移除，未关闭的连接保留供后续重试

## 事件系统

PrismGo 管理的 Redis 连接会自动通过 go-redis hook 派发命令事件，供日志、指标和 Horizon 等横切能力订阅。

### 事件类型

| 事件名 | 常量 | 触发时机 |
|--------|------|----------|
| `redis.command_executed` | `EventCommandExecuted` | 单条 Redis 命令执行成功 |
| `redis.command_failed` | `EventCommandFailed` | 单条 Redis 命令执行失败 |
| `redis.command_batch_executed` | `EventCommandBatchExecuted` | Pipeline/TxPipeline 执行成功 |
| `redis.command_batch_failed` | `EventCommandBatchFailed` | Pipeline/TxPipeline 执行失败 |

**命令成功事件结构：**

```go
type CommandExecuted struct {
    Command        string        // 命令名，如 "get"、"set"、"del"
    Parameters     []any         // 命令参数快照（不含命令名本身）
    Time           time.Duration // 命令耗时
    Connection     Connection    // 产生事件的连接
    ConnectionName string        // 连接名称快照（如 "default"、"cache"）
}
```

**命令失败事件结构：**

```go
type CommandFailed struct {
    Command        string      // 命令名
    Parameters     []any       // 命令参数快照
    Error          error       // go-redis 返回的原始错误
    Connection     Connection  // 产生事件的连接
    ConnectionName string      // 连接名称快照
}
```

**批量命令事件结构：**

```go
type CommandBatchExecuted struct {
    Commands       []CommandSnapshot // 批量中每条命令的快照
    Time           time.Duration     // 批量执行总耗时
    Connection     Connection        // 产生事件的连接
    ConnectionName string            // 连接名称快照
}

type CommandBatchFailed struct {
    Commands       []CommandSnapshot // 批量中每条命令的快照
    Error          error             // go-redis 返回的原始错误
    Connection     Connection        // 产生事件的连接
    ConnectionName string            // 连接名称快照
}
```

> **安全注意：** 事件参数不做脱敏处理（对齐 Laravel 行为）。如果监听器将事件转发到日志、指标或外部监控，需要自行处理敏感参数（如密码、token）的过滤。

### 全局事件监听

通过 PrismGo 事件系统的 EventSink，Redis 命令事件会桥接到应用事件总线。`RedisServiceProvider` 在 Boot 阶段自动安装桥接，因此你可以在应用代码中注册全局事件监听器：

```go
// 监听 Redis 命令成功事件
event.Listen(redis.EventCommandExecuted, func(ctx context.Context, ev eventcontract.Event) error {
    executed := ev.(redis.CommandExecutedEvent)
    log.Printf("Redis 命令执行: %s on %s, 耗时 %s",
        executed.Command, executed.ConnectionName, executed.Time)
    return nil
})

// 监听 Redis 命令失败事件
event.Listen(redis.EventCommandFailed, func(ctx context.Context, ev eventcontract.Event) error {
    failed := ev.(redis.CommandFailedEvent)
    log.Printf("Redis 命令失败: %s on %s, 错误: %v",
        failed.Command, failed.ConnectionName, failed.Error)
    return nil
})

// 监听批量命令事件
event.Listen(redis.EventCommandBatchExecuted, func(ctx context.Context, ev eventcontract.Event) error {
    batch := ev.(redis.CommandBatchExecutedEvent)
    log.Printf("Pipeline 成功: %d 条命令, 耗时 %s",
        len(batch.Commands), batch.Time)
    return nil
})
```

### 连接级监听器

除了全局事件外，还可以在单个连接上注册监听器，适合测试和局部观测：

```go
conn, _ := manager.Connection("cache")

// 注册成功监听器
conn.Listen(func(ctx context.Context, ev redis.CommandExecuted) {
    fmt.Printf("[%s] %s %v → 耗时 %v\n",
        ev.ConnectionName, ev.Command, ev.Parameters, ev.Time)
})

// 注册失败监听器
conn.ListenForFailures(func(ctx context.Context, ev redis.CommandFailed) {
    fmt.Printf("[%s] %s %v → 错误: %v\n",
        ev.ConnectionName, ev.Command, ev.Parameters, ev.Error)
})

// 执行命令 – 监听器自动触发
client := conn.Client()
client.Set(ctx, "key", "value", 0)
client.Get(ctx, "key")
```

> **监听器 Panic 保护：** 监听器内部的 panic 会被捕获并上报到 `exception.handler`，不会影响 Redis 命令的正常返回结果。

### 关闭事件

在高吞吐批处理或测试场景，可以关闭事件以降低开销：

```go
// 关闭事件 – go-redis 命令仍正常执行
manager.DisableEvents()

// 重新开启事件
manager.EnableEvents()
```

> **注意：** 事件开关会影响当前所有已创建连接。切换后，已创建的连接和新创建的连接都会继承 Manager 的当前状态。

## 容器集成

### ServiceProvider 注册

`RedisServiceProvider` 是框架默认 Provider，会自动在容器中注册 Redis Factory：

```go
// ServiceProvider.Register 阶段：
// - 注册 "redis" → Manager（懒加载，不连接 Redis）
// - 注册 "redis.connection" → 默认 Connection（懒加载）

// ServiceProvider.Boot 阶段：
// - 安装 EventSink，将 Redis 事件桥接到事件总线
```

业务应用无需手动注册。框架会在 `bootstrap/app.go` 的 providers 列表中自动加载。

### 容器解析

通过容器可以按需解析 Redis 依赖：

```go
import (
    "github.com/prismgo/framework/container"
    rediscontract "github.com/prismgo/framework/contracts/redis"
)

// 解析 Redis Factory
factory, err := container.Make[rediscontract.Factory]("redis")
if err != nil {
    return err
}

// 解析默认连接
conn, err := container.Make[rediscontract.Connection]("redis.connection")
if err != nil {
    return err
}

// 获取指定连接
cacheConn, err := factory.Connection("cache")
if err != nil {
    return err
}
```

### 生命周期关闭

容器关闭时，Manager 的 `Close` 方法会自动被调用（通过 `container.WithContextCloser` 注册）：

```go
// 在应用退出时
container.Close(context.Background())
// → Manager.Close(ctx) 自动调用 → 关闭所有已解析连接
```

## 与其他组件集成

### 缓存驱动

Cache 组件配置中通过 `connection` 引用 Redis 连接名称：

```go
// config/cache.go
"redis": map[string]interface{}{
    "driver":     "redis",
    "prefix":     Env("CACHE_REDIS_PREFIX", "redis"),
    "connection": Env("CACHE_REDIS_CONNECTION", "cache"),
    "events":     Env("CACHE_REDIS_EVENTS", true),
},
```

`prismgo/cache` 的 Redis Store 通过 Facade 获取 `"cache"` 连接：

```go
client, _ := redis.Client("cache")
```

缓存组件提供了基于 Redis 的完整缓存能力，包括：
- 基础读写（Get / Put / Forget）
- TTL 管理（Touch / Persist）
- 原子操作（Add / Increment / Pull）
- 批量操作（GetMany / PutMany / ForgetMany）
- 标签缓存（GetTagged / PutTagged / ForgetTagged / FlushTags）
- 前缀清洗（Flush）

### 队列驱动

Queue 组件配置中引用 Redis 连接：

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

`prismgo/queue/redis` 使用 Redis List + Sorted Set 实现任务队列：
- 即时任务通过 `RPUSH` 推入 ready list
- 延迟任务通过 `ZADD` 存入 delayed sorted set，到期后 Lua 脚本迁移
- Worker 通过 `BLPOP` 阻塞等待，减少空轮询
- 失败任务存入 failed store

### Horizon 存储

Horizon 组件使用独立 key schema 将运行时状态持久化到 Redis：

```go
// config/horizon.go
"redis": map[string]interface{}{
    "connection":  Env("HORIZON_REDIS_CONNECTION", ""),
},
```

Horizon Redis Store 管理的数据包括：
- Master / Supervisor / Worker 心跳与租约
- 全局控制标记（暂停、终止）
- 事件指标窗口（EventMetricWindows）
- 队列长度快照
- 批次安全摘要
- 高价值任务诊断详情
- 可观测性诊断数据
- Orphan 进程跟踪

## Facade 参考

Facade 提供静态方法，从全局容器中解析 Redis 能力：

| 方法 | 签名 | 说明 |
|------|------|------|
| `Resolve` | `Resolve() rediscontract.Factory` | 返回当前 Application 绑定的 Redis Factory。容器未就绪时返回 nil |
| `ManagerInstance` | `ManagerInstance() *Manager` | 返回当前 Application 绑定的具体 Manager 实例 |
| `Connection` | `Connection(name ...string) (rediscontract.Connection, error)` | 解析指定连接；未传名则返回默认连接 |
| `Client` | `Client(name ...string) (goredis.UniversalClient, error)` | 快捷方法：直接返回 go-redis 客户端 |
| `ManagerCloseOption` | `ManagerCloseOption() containercontract.BindingOption` | 返回容器关闭选项，供 bootstrap 注册 |

## Manager 接口参考

Manager 实现了 `rediscontract.Factory` 接口：

| 方法 | 签名 | 说明 |
|------|------|------|
| `Connection` | `Connection(name ...string) (rediscontract.Connection, error)` | 按名称懒加载连接；同名连接创建后缓存 |
| `DefaultConnection` | `DefaultConnection() (rediscontract.Connection, error)` | 显式获取默认连接 |
| `Connections` | `Connections() map[string]rediscontract.Connection` | 返回已解析连接的只读快照 |
| `Purge` | `Purge(name ...string) error` | 关闭并移除指定连接，下次解析时重建 |
| `EnableEvents` | `EnableEvents()` | 开启命令事件派发 |
| `DisableEvents` | `DisableEvents()` | 关闭命令事件派发 |
| `Close` | `Close(ctx context.Context) error` | 关闭所有已解析连接 |

## Connection 接口参考

Connection 表示一个命名 Redis 连接，实现了 `rediscontract.Connection` 接口：

| 方法 | 签名 | 说明 |
|------|------|------|
| `Name` | `Name() string` | 返回配置中的连接名称（如 `"default"`、`"cache"`） |
| `Client` | `Client() goredis.UniversalClient` | 暴露 go-redis 原生客户端，支持所有 Redis 命令 |
| `Listen` | `Listen(func(context.Context, CommandExecuted))` | 注册成功命令监听器 |
| `ListenForFailures` | `ListenForFailures(func(context.Context, CommandFailed))` | 注册失败命令监听器 |

## 事件类型参考

| 类型 | 包路径别名 | 说明 |
|------|-----------|------|
| `CommandExecuted` | `redis.CommandExecuted` | `contracts/redis.CommandExecuted` 的别名 |
| `CommandFailed` | `redis.CommandFailed` | `contracts/redis.CommandFailed` 的别名 |
| `CommandSnapshot` | `redis.CommandSnapshot` | `contracts/redis.CommandSnapshot` 的别名 |
| `CommandBatchExecuted` | `redis.CommandBatchExecuted` | `contracts/redis.CommandBatchExecuted` 的别名 |
| `CommandBatchFailed` | `redis.CommandBatchFailed` | `contracts/redis.CommandBatchFailed` 的别名 |

**事件总线包装类型（随事件名分发）：**

| 类型 | 事件名常量 |
|------|-----------|
| `CommandExecutedEvent` | `redis.command_executed` |
| `CommandFailedEvent` | `redis.command_failed` |
| `CommandBatchExecutedEvent` | `redis.command_batch_executed` |
| `CommandBatchFailedEvent` | `redis.command_batch_failed` |
