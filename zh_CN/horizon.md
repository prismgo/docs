# Horizon

- [简介](#简介)
- [安装](#安装)
- [配置](#配置)
  - [基础配置](#基础配置)
  - [环境选择](#环境选择)
  - [Supervisor 配置](#supervisor-配置)
  - [负载均衡策略](#负载均衡策略)
- [运行 Horizon](#运行-horizon)
  - [启动 Master](#启动-master)
  - [启动 Worker](#启动-worker)
  - [本地开发监听](#本地开发监听)
- [控制命令](#控制命令)
  - [暂停与恢复](#暂停与恢复)
  - [优雅终止](#优雅终止)
- [诊断命令](#诊断命令)
- [维护命令](#维护命令)
- [Dashboard](#dashboard)
  - [路由注册](#路由注册)
  - [权限控制](#权限控制)
  - [HTTP API 参考](#http-api-参考)
- [观测配置](#观测配置)
  - [预设](#预设)
  - [观测能力开关](#观测能力开关)
  - [采集与写入](#采集与写入)
  - [采样](#采样)
  - [高价值诊断明细](#高价值诊断明细)
  - [数据保留与清理](#数据保留与清理)
  - [诊断与降级](#诊断与降级)
- [Metrics](#metrics)
- [失败任务](#失败任务)
- [长等待事件](#长等待事件)
- [批次摘要](#批次摘要)
- [Store 接口](#store-接口)
- [部署 Horizon](#部署-horizon)

---

## 简介

PrismGo Horizon 提供队列运行时监控与 supervisor 管理能力，对应 Laravel Horizon 的核心功能。它围绕 `github.com/prismgo/framework/queue` 的事件、worker、failed store 和 batch store 构建，负责队列运行视图、控制命令、指标聚合、Dashboard API 和进程心跳，不替代队列 driver 本身。

核心进程模型：

| 概念 | 说明 |
| --- | --- |
| Master | Horizon 主进程，加载当前环境 supervisor 配置并派生子进程 |
| Supervisor | 一组队列 worker 的配置单元，声明 connection、queue、进程数、重试和超时策略 |
| Worker | 真实消费队列任务的 `horizon:work` 子进程 |

Horizon 的状态与队列消息分离。队列消息仍由 `github.com/prismgo/framework/queue` 的 Redis、RabbitMQ 或其他 driver 管理；Horizon Store 只保存监控和控制数据。

## 安装

使用 `horizon:install` 命令生成配置文件和服务提供者桩文件：

```bash
go run ./ horizon:install
```

该命令会在文件不存在时创建 `config/horizon.go` 和 `app/providers/horizon_service_provider.go`，已存在的文件不会被覆盖。安装完成后，需要手动在 `bootstrap/provider.go` 中注册 `horizon.ServiceProvider{}`。

Dashboard 资源已内嵌到二进制中，无需额外的 publish 步骤。

## 配置

配置入口在 `config/horizon.go`。所有配置通过 `horizon` 命名空间注册，支持环境变量覆盖。

### 基础配置

| 配置键 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `horizon.use` | `HORIZON_STORE` | `redis` | Horizon Store 类型。生产推荐 `redis`；测试可使用 `memory` |
| `horizon.path` | `HORIZON_PATH` | `horizon` | Dashboard 和内部 API 的挂载前缀，不包含首尾斜杠 |
| `horizon.connection` | `HORIZON_CONNECTION` | `default` | Horizon Redis Store 使用的 Redis 连接名，独立于 queue/cache/session 连接 |
| `horizon.prefix` | `HORIZON_PREFIX` | `prismgo_horizon` | Horizon Store 的 key 前缀，应与业务队列 key 前缀区分 |
| `horizon.encoding` | `HORIZON_ENCODING` | 空 | Store record 的 Payload Encoding 名称；空值继承 `encoding.default`（默认 `msgpack`），可显式设为 `json` 便于排障 |
| `horizon.heartbeat_ttl_seconds` | `HORIZON_HEARTBEAT_TTL_SECONDS` | `60` | master/supervisor/worker heartbeat 被视为存活的时间窗口（秒）。超过该窗口未刷新 heartbeat 的进程会被标记为 stale |
| `horizon.fast_termination` | — | `false` | terminate 时是否允许新 master 先启动 |
| `horizon.memory_limit` | — | `128` | Horizon worker 默认内存限制（MB） |
| `horizon.waits` | — | 空 | 按 `connection:queue` 保存长等待阈值秒数，供 waits 观测复用 |

### 环境选择

Horizon 按以下优先级确定当前环境名：

1. `horizon.environment` — 允许 Horizon 独立覆盖应用环境
2. `app.env` — 项目级配置来源
3. `APP_ENV` 环境变量 — 兼容 fallback
4. 默认值 `production`

环境名用于从 `horizon.environments` 中选择对应的 supervisor 配置。环境匹配支持 Laravel `Str::is` 风格的通配符，例如 `production-*` 可以匹配 `production-web`、`production-worker` 等环境名，精确匹配优先于通配匹配。

### Supervisor 配置

`horizon.defaults` 是所有环境共享的 supervisor 基线；`horizon.environments.{env}` 中的同名 supervisor 会覆盖 defaults 中的字段。只存在于 environment 中的 supervisor 也会被解析，便于按环境新增队列消费组。

#### 配置字段

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `connection` | string | 必填 | 队列连接名，决定 worker 从哪个 queue connection 取任务 |
| `queue` | string 或 []string | 必填 | 队列名称列表，支持逗号分隔字符串或数组。解析后会去空白、去重并保持配置顺序 |
| `balance` | string | `false` | 负载均衡策略：`false`、`simple` 或 `auto` |
| `min_processes` | int | `0` | supervisor 最小 worker 数 |
| `max_processes` | int | `0` | supervisor 最大 worker 数，必须 >= `min_processes` |
| `tries` | int | `0` | 单个任务最大尝试次数，达到后进入 failed store |
| `timeout` | int | `0` | 单个任务执行超时秒数 |
| `sleep` | int | `0` | 空队列轮询间隔秒数 |
| `max_jobs` | int | `0` | worker 处理指定任务数后退出，`0` 表示不限制 |
| `max_time` | int | `0` | worker 运行指定秒数后退出，`0` 表示不限制 |
| `retry_after` | int | `0` | reserved 任务重新可见窗口秒数，应始终大于 `timeout`，避免同一任务被并发重复消费 |
| `backoff` | int 或 []int | 空 | 失败重试退避秒数列表，支持单个数字、逗号分隔字符串或数组 |
| `stop_when_empty` | bool | `false` | 队列为空后 worker 是否退出，适合一次性消费场景 |
| `memory` | int | `0` | worker 内存限制 MB（兼容字段，当前 Go 实现只解析和展示） |
| `nice` | int | `0` | 进程优先级（兼容字段，当前 Go 实现只解析和展示） |
| `auto_scaling_strategy` | string | `time` | auto balance 使用的策略：`time`（按预计清空时间）或 `size`（按队列长度） |
| `balance_max_shift` | int | `1` | auto balance 单次扩缩容最多移动的 worker 数，限制扩缩容幅度 |
| `balance_cooldown` | int | `3` | 两次 auto balance 计算之间的最小间隔秒数，降低扩缩容抖动 |

> **注意**：配置只支持 snake_case 字段名。camelCase 字段（如 `maxProcesses`、`minProcesses`、`retryAfter` 等）会在解析时报错，并提示使用对应的 snake_case 名称。

#### 配置示例

```go
"defaults": map[string]interface{}{
    "supervisor-default": map[string]interface{}{
        "connection":    "redis",
        "queue":         []interface{}{"high", "default"},
        "balance":       "auto",
        "min_processes": 1,
        "max_processes": 4,
        "tries":         3,
        "timeout":       60,
        "retry_after":   90,
        "sleep":         3,
    },
},
"environments": map[string]interface{}{
    "production": map[string]interface{}{
        "supervisor-default": map[string]interface{}{
            "max_processes": 10,
        },
        "supervisor-notifications": map[string]interface{}{
            "connection":    "redis",
            "queue":         "notifications",
            "balance":       "false",
            "min_processes": 2,
            "max_processes": 2,
            "tries":         3,
            "timeout":       30,
        },
    },
},
```

#### 场景建议

| 场景 | 建议 |
| --- | --- |
| 本地开发 | `max_processes=1`，降低并发带来的调试噪声 |
| 普通生产队列 | `balance=auto`，`min_processes=1`，按吞吐设置 `max_processes` |
| 高优先级通知/支付队列 | 单独 supervisor，独立 `queue` 和 `max_processes` |
| 一次性补偿任务 | `stop_when_empty=true`，配合较小 `max_time` |
| 长任务 | 增大 `timeout`，并同步增大 `retry_after` |

### 负载均衡策略

Horizon 支持三种负载均衡策略，对应 Laravel Horizon 的 balance 配置：

#### `balance=false`（默认）

不做自动均衡。所有配置队列由一个 process pool 统一消费，worker 数量根据队列积压在 `min_processes` 与 `max_processes` 之间调整。适用于每个队列固定进程数或不需要自动调度的场景。

#### `balance=simple`

在配置队列间做固定分配。每个队列获得 `max_processes / len(queues)` 个 worker，结果被限制在 `[min_processes, max_processes]` 范围内。适用于多队列固定简单分配的场景。

#### `balance=auto`

根据队列 workload 在 `min_processes` 与 `max_processes` 间动态调整 worker 数量。受 `balance_max_shift` 和 `balance_cooldown` 约束，避免扩缩容过猛或抖动。

auto balance 的 workload 计算由 `auto_scaling_strategy` 决定：

| 策略 | 计算方式 | 适用场景 |
| --- | --- | --- |
| `time`（默认） | `weight = ready_jobs × avg_runtime` | 更关心等待时间，贴近 Laravel 默认语义 |
| `size` | `weight = ready_jobs` | 更关心堆积数量 |

## 运行 Horizon

### 启动 Master

生产通常由进程管理器启动 `horizon` master：

```bash
go run ./ horizon --environment=production
```

`--environment` 指定 Horizon 环境名，为空时由已加载配置决定实际运行环境。Master 进程会加载当前环境的 supervisor 配置并派生 supervisor 子进程。

### 启动 Worker

Worker 通常由 supervisor 自动派生，也可以手动运行：

```bash
go run ./ horizon:work redis --queue=default --tries=3 --timeout=60
```

`horizon:work` 支持以下选项：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--name` | string | 空 | Worker 名称 |
| `--queue` | string | `default` | 监听的队列名，允许逗号分隔 |
| `--connection` | 位置参数 | 空 | 队列连接名 |
| `--backoff` | string | `0` | 退避策略 |
| `--retry-after` | int | `90` | 任务重试保留窗口（秒） |
| `--max-jobs` | int | `0` | 单 worker 最大处理任务数，0 为不限制 |
| `--max-time` | int | `0` | 单 worker 最大运行秒数，0 为不限制 |
| `--force` | bool | `false` | 强制运行标志 |
| `--memory` | int | `0` | 内存限制（MB），0 为不限制 |
| `--once` | bool | `false` | 只处理一个任务后退出 |
| `--stop-when-empty` | bool | `false` | 队列空时停止 |
| `--sleep` | int | `3` | 空队列时休眠秒数 |
| `--rest` | int | `0` | 任务间休息秒数 |
| `--supervisor` | string | 空 | 所属 supervisor 名称 |
| `--timeout` | int | `60` | 单任务超时秒数 |
| `--tries` | int | `1` | 最大重试次数 |
| `--json` | bool | `false` | JSON 输出模式 |
| `--environment` | string | 空 | Horizon 环境名 |
| `--prefix` | string | 空 | Store key 前缀 |

### 本地开发监听

```bash
go run ./ horizon:listen
```

`horizon:listen` 是本地开发辅助命令，监听文件变化并重启 Horizon。支持以下选项：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--environment` | string | `local` | Horizon 环境名 |
| `--poll` | int | `1000` | 文件轮询间隔（毫秒） |

> **注意**：`horizon:listen` 仅适用于本地开发，不推荐在生产环境使用。

## 控制命令

### 暂停与恢复

暂停所有 supervisor：

```bash
go run ./ horizon:pause
```

恢复所有 supervisor：

```bash
go run ./ horizon:continue
```

暂停指定 supervisor：

```bash
go run ./ horizon:pause-supervisor supervisor-default
```

恢复指定 supervisor：

```bash
go run ./ horizon:continue-supervisor supervisor-default
```

暂停/恢复通过 Store 控制标记实现，不会直接终止进程。暂停后的 worker 不会消费新任务，但已开始的任务会继续执行完成。

### 优雅终止

```bash
go run ./ horizon:terminate
go run ./ horizon:terminate --wait
```

`--wait` 标志控制终止等待策略。terminate 请求的优先级高于 pause，写入后会通知 fresh master/supervisor 尽快退出。

## 诊断命令

| 命令 | 说明 |
| --- | --- |
| `horizon:status` | 显示全局运行状态快照，包括状态、暂停/终止标记、supervisor/worker 计数和 stale 计数 |
| `horizon:list` | 列出运行中的 master machines，显示 Name、PID、Supervisors、Status |
| `horizon:supervisors` | 列出所有 supervisor 的基础状态 |
| `horizon:supervisor-status <name>` | 显示指定 supervisor 的详细状态，包括 Pools、Connection、Queues 等 |
| `horizon:timeout [environment]` | 显示指定环境下的最大 worker timeout 秒数，默认 `production` |
| `horizon:stale` | 列出所有 heartbeat 超过 TTL 的 stale 进程（master/supervisor/worker），只读不写 |

## 维护命令

| 命令 | 说明 |
| --- | --- |
| `horizon:snapshot` | 持久化队列长度快照和 collector 当前事件派生 metrics 到 Store |
| `horizon:clear-metrics` | 清理 Store 中的事件派生 metrics 和 collector 内存聚合。不清除 heartbeat、控制标记、队列数据或 failed records |
| `horizon:clear <connection> --queue=<name> --force` | 清空由当前环境 supervisor 配置覆盖的队列。必须传入 `--force` 标志 |
| `horizon:forget <id>` | 删除指定 failed job 记录 |
| `horizon:forget --all` | 删除所有 failed job 记录 |
| `horizon:purge --signal=SIGTERM` | 清理不再属于 active supervisor pool 的孤儿 worker 进程 |

## Dashboard

Dashboard 路径由 `horizon.path` 控制，默认是 `/horizon`。内部 API 使用同一前缀下的只读接口。

### 路由注册

在应用路由注册阶段调用 `RegisterHTTPRoutes`：

```go
horizon.RegisterHTTPRoutes(horizon.HTTPOptions{
    Manager: manager,
    Auth:    []gin.HandlerFunc{authMiddleware, permissionMiddleware},
})
```

`HTTPOptions` 字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Manager` | `*Manager` | 提供 Horizon 静态配置和 Store 解析；为空时使用默认 Manager |
| `Auth` | `[]gin.HandlerFunc` | 业务应用注入的认证中间件，通常包含登录校验、权限加载和 `horizon.view` 校验 |

### 权限控制

Dashboard 和 API 共用 `horizon.view` 权限标识。当前只开放观察面，不开放 retry、pause、terminate 等写入口。生产环境建议在业务路由层为 `/horizon` 增加鉴权和 IP allowlist。

### HTTP API 参考

所有 API 为只读 GET 接口，挂载在 `/{horizon.path}/api` 前缀下。支持分页的接口接受 `page` 和 `page_size` 查询参数。

#### 全局状态

```
GET /{horizon.path}/api/status
```

返回 Dashboard 首屏需要的轻量运行状态摘要，包括全局状态、队列长度和能力列表。

响应示例：

```json
{
  "status": {
    "status": "running",
    "global_paused": false,
    "terminate_requested": false,
    "supervisor_count": 2,
    "worker_count": 8,
    "stale_supervisor_count": 0,
    "stale_worker_count": 0,
    "queue_count": 3,
    "jobs_per_minute": 150.5,
    "jobs_past_hour": 9030,
    "total_processed": 25000
  },
  "queue_lengths": { "captured_at": "...", "queues": [...] },
  "capabilities": {
    "batches": "supported",
    "high_value_detail": "supported",
    "queue_lengths": "supported",
    "event_metrics": "supported",
    "waits": "supported",
    "http_writes": "unsupported"
  }
}
```

#### Master 列表

```
GET /{horizon.path}/api/masters?page=1&page_size=25
```

返回运行中的 master 进程列表，包含进程身份、heartbeat、goroutine 和内存指标。

#### Supervisor 列表

```
GET /{horizon.path}/api/supervisors?page=1&page_size=25
```

返回 supervisor 列表，包含名称、状态、worker 数、connection、queues 和 process pool 状态。

#### Worker 列表

```
GET /{horizon.path}/api/workers?page=1&page_size=25
```

返回 worker 列表，包含进程身份、状态、配置队列和资源指标。

#### Stale 进程

```
GET /{horizon.path}/api/stale?page=1&page_size=25
```

返回 heartbeat 超过 TTL 的 stale supervisor 和 worker 列表。

#### 队列视图

```
GET /{horizon.path}/api/queues?page=1&page_size=25
```

返回队列聚合视图，结合队列长度和 event metrics 展示每个 connection:queue 的吞吐、等待和运行时信息。

#### Metrics 当前值

```
GET /{horizon.path}/api/metrics/current
```

返回当前 event metrics 聚合视图。默认展示最近 24 小时数据。

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `from` | RFC3339 | 时间范围下界（窗口 WindowEnd > From） |
| `to` | RFC3339 | 时间范围上界（窗口 WindowStart < To） |
| `source_host` | string | 按主机精确过滤 |
| `source_environment` | string | 按 Horizon environment 精确过滤 |
| `source_supervisor` | string | 按 supervisor 精确过滤 |
| `connection` | string | 按 queue connection 精确过滤 |
| `queue` | string | 按 queue 名称精确过滤 |
| `source_details` | bool | 是否包含来源分片明细，默认省略 |
| `summary_only` | bool | 只返回 queue 聚合 summary |
| `page` / `page_size` | int | 分页参数 |

> 时间范围不能超过 24 小时。`from` 必须早于 `to`。所有时间参数必须带时区。

#### Metrics 来源

```
GET /{horizon.path}/api/metrics/sources
```

返回 event metrics 的来源维度列表，用于 Dashboard 下钻。支持与 `/metrics/current` 相同的过滤参数。

#### Metrics 历史

```
GET /{horizon.path}/api/metrics/history/{kind}/{key}
```

返回指定维度的 metrics 历史数据点。当前 `kind` 只支持 `queue`，`key` 格式为 `connection:queue`。

查询参数与 `/metrics/current` 相同。

#### 高价值诊断明细列表

```
GET /{horizon.path}/api/high-value-detail
```

返回 failed、poison、slow_job 三类高价值诊断摘要列表。

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | string | 过滤类型：`failed`、`poison` 或 `slow_job` |
| `occurred_from` | RFC3339 | 事件发生时间下界 |
| `occurred_to` | RFC3339 | 事件发生时间上界 |
| `page` / `page_size` | int | 分页参数 |

#### 高价值诊断明细详情

```
GET /{horizon.path}/api/high-value-detail/{id}
```

返回指定 ID 的诊断摘要详情。未找到时返回 404。

#### 批次摘要列表

```
GET /{horizon.path}/api/batches
```

返回批次安全摘要列表，支持 `query` 或 `search` 参数按 ID 或名称搜索。

#### 批次详情

```
GET /{horizon.path}/api/batches/{id}
```

返回指定 ID 的批次摘要详情。未找到时返回 404。

## 观测配置

Horizon 通过 queue events 生成等待时间、运行时间、失败、poison、批次摘要和队列长度指标。观测配置集中在 `horizon.observability`。

### 预设

| 预设 | 说明 |
| --- | --- |
| `full` | 开发和排障优先，保留完整观测能力，全量采样 |
| `production_light` | 保留核心健康、队列长度和队列级聚合，降低 per-job 成本，10% 采样率 |
| `minimal` | 只保留核心健康和队列长度，关闭 event_metrics 和 per-job 明细 |

预设只提供默认值，所有显式子字段都会覆盖预设。这样可以从 `production_light` 出发逐项打开诊断能力。

### 观测能力开关

| 配置键 | 环境变量 | 默认值（full） | 说明 |
| --- | --- | --- | --- |
| `observability.preset` | `HORIZON_OBSERVABILITY_PRESET` | `full` | 观测预设 |
| `observability.event_metrics` | `HORIZON_OBSERVABILITY_EVENT_METRICS` | `true` | 是否采集 queue event 派生的队列级 counters 和 runtime 聚合 |
| `observability.waits` | `HORIZON_OBSERVABILITY_WAITS` | `true` | 是否保留排队等待时间状态和 long wait 事件。需要 `event_metrics=true` 且 `queued_waits_max>0` |
| `observability.batch_summaries` | `HORIZON_OBSERVABILITY_BATCH_SUMMARIES` | `true` | 是否保存 batch 只读摘要 |
| `observability.process_health` | `HORIZON_OBSERVABILITY_PROCESS_HEALTH` | `true` | 是否启用 heartbeat、状态和控制标记等核心健康能力 |
| `observability.queue_lengths` | `HORIZON_OBSERVABILITY_QUEUE_LENGTHS` | `true` | 是否采样队列后端长度 |
| `observability.queued_waits_max` | `HORIZON_OBSERVABILITY_QUEUED_WAITS_MAX` | `10000` | 等待时间 per-job 状态数量上限，`0` 表示不保留 |
| `observability.processing_spans_max` | `HORIZON_OBSERVABILITY_PROCESSING_SPANS_MAX` | `10000` | processing span 数量上限，`0` 表示不保存 |
| `observability.processing_cleanup_interval_seconds` | `HORIZON_OBSERVABILITY_PROCESSING_CLEANUP_INTERVAL_SECONDS` | `60` | processing span TTL 清理节流间隔秒数 |

能力开关之间存在依赖关系：

- `waits` 需要 `event_metrics=true` 且 `queued_waits_max>0`
- `high_value_detail` 需要至少一个明细通道（`failed_detail_enabled`、`poison_detail_enabled`、`slow_job_detail_enabled`）开启，且采样率 > 0
- `processing_spans` 需要 `event_metrics=true` 且 `processing_spans_max>0`

### 采集与写入

| 配置键 | 环境变量 | 默认值（full） | 说明 |
| --- | --- | --- | --- |
| `observability.metrics_window` | `HORIZON_OBSERVABILITY_METRICS_WINDOW` | `1m` | event_metrics 的事件时间聚合桶宽度，独立于 flush_interval |
| `observability.flush_interval` | `HORIZON_OBSERVABILITY_FLUSH_INTERVAL` | `1m` | collector 到 Store 的周期 flush 间隔 |
| `observability.flush_timeout` | `HORIZON_OBSERVABILITY_FLUSH_TIMEOUT` | `5s` | 单次 flush 写 Store 的等待上限 |
| `observability.batch_size` | `HORIZON_OBSERVABILITY_BATCH_SIZE` | `500` | 一次 flush 最多写入的增量或明细数量 |
| `observability.batch_summary_size` | `HORIZON_OBSERVABILITY_BATCH_SUMMARY_SIZE` | `500` | 一次最多保留或写入的 batch summary 数量；未显式配置时等于 `batch_size` |
| `observability.buffer_size` | `HORIZON_OBSERVABILITY_BUFFER_SIZE` | `10000` | collector 与 flusher 之间的有界内存 buffer 条数 |
| `observability.max_events_per_second` | `HORIZON_OBSERVABILITY_MAX_EVENTS_PER_SECOND` | `0` | collector 入口速率上限，`0` 表示不额外限速 |
| `observability.drop_policy` | `HORIZON_OBSERVABILITY_DROP_POLICY` | `drop_oldest` | buffer 满或降级时的丢弃策略：`drop_oldest`（优先丢弃最旧）或 `drop_newest`（丢弃当前入队） |

数据流：queue event → Collector（非阻塞入队）→ 内存聚合窗口 → Flusher（周期批量写入）→ Store

### 采样

| 配置键 | 环境变量 | 默认值（full） | 说明 |
| --- | --- | --- | --- |
| `observability.event_metrics_sample_rate` | `HORIZON_OBSERVABILITY_EVENT_METRICS_SAMPLE_RATE` | `1` | queue event 进入 event_metrics 管线的采样率。`1` 表示全量，`0` 表示关闭，`0.1` 表示 10% |
| `observability.high_value_detail_sample_rate` | `HORIZON_OBSERVABILITY_HIGH_VALUE_DETAIL_SAMPLE_RATE` | 空 | failed、poison、slow job 明细的独立采样率；空值继承当前实际 event_metrics 采样率 |
| `observability.sample_reservoir_size` | `HORIZON_OBSERVABILITY_SAMPLE_RESERVOIR_SIZE` | `2048` | P95/P99 估算所需的样本池大小 |
| `observability.max_aggregate_keys` | `HORIZON_OBSERVABILITY_MAX_AGGREGATE_KEYS` | `10000` | 聚合 key 基数上限（connection+queue/job type），防止 key 过多撑爆内存 |
| `observability.aggregate_key_ttl` | `HORIZON_OBSERVABILITY_AGGREGATE_KEY_TTL` | `30m` | 低活跃聚合 key 的过期窗口 |
| `observability.dynamic_sampling_enabled` | `HORIZON_OBSERVABILITY_DYNAMIC_SAMPLING_ENABLED` | `true` | 是否允许压力下动态降低实际采样率 |
| `observability.min_sample_rate` | `HORIZON_OBSERVABILITY_MIN_SAMPLE_RATE` | `0.01` | 动态采样降级时的最低采样率 |

采样率影响数据质量标记：

| 质量标记 | 含义 |
| --- | --- |
| `exact` | 全量事件派生，无采样或丢弃降级 |
| `estimated` | 由采样事件估算派生 |
| `degraded` | 受到丢弃、Store 失败或其他降级影响 |
| `unknown` | 存在不可量化丢失，不能作为估算或精确值展示 |
| `partial` | shutdown best-effort flush 写入了未完成窗口 |

### 高价值诊断明细

| 配置键 | 环境变量 | 默认值（full） | 说明 |
| --- | --- | --- | --- |
| `observability.failed_detail_enabled` | `HORIZON_OBSERVABILITY_FAILED_DETAIL_ENABLED` | `true` | 是否保存 failed job 安全摘要 |
| `observability.poison_detail_enabled` | `HORIZON_OBSERVABILITY_POISON_DETAIL_ENABLED` | `true` | 是否保存无法解析 payload 的 poison envelope 摘要 |
| `observability.slow_job_detail_enabled` | `HORIZON_OBSERVABILITY_SLOW_JOB_DETAIL_ENABLED` | `true` | 是否保存慢任务摘要 |
| `observability.slow_job_threshold` | `HORIZON_OBSERVABILITY_SLOW_JOB_THRESHOLD` | `30s` | 慢任务诊断阈值 |

高价值诊断明细只保存安全摘要（connection、queue、job name、runtime、截断的错误摘要），不保存 job payload、raw envelope 或完整错误堆栈。

### 数据保留与清理

| 配置键 | 环境变量 | 默认值（full） | 说明 |
| --- | --- | --- | --- |
| `observability.event_metrics_retention` | `HORIZON_OBSERVABILITY_EVENT_METRICS_RETENTION` | `24h` | event_metrics 聚合数据保留期 |
| `observability.high_value_detail_retention` | `HORIZON_OBSERVABILITY_HIGH_VALUE_DETAIL_RETENTION` | `24h` | 高价值诊断明细保留期 |
| `observability.batch_summary_retention` | `HORIZON_OBSERVABILITY_BATCH_SUMMARY_RETENTION` | `24h` | batch summary 保留期 |
| `observability.diagnostics_retention` | `HORIZON_OBSERVABILITY_DIAGNOSTICS_RETENTION` | `24h` | drop/degradation 诊断数据保留期 |

过期数据由 Store 的 `Trim` 操作清理，在 supervisor 运行循环中周期执行。

### 诊断与降级

当 collector/flusher 发生丢弃或降级时，会写入 `ObservabilityDiagnostic` 记录，包含稳定的原因标识和计数。常见丢弃原因：

| 原因 | 说明 |
| --- | --- |
| `buffer_full` | 有界 buffer 已满导致观测数据被丢弃 |
| `rate_limited` | `max_events_per_second` 限流 |
| `aggregate_key_overflow` | 聚合 key 达到上限 |
| `store_unavailable` | flush 写入 Store 失败或超时 |
| `flush_lag_exceeded` | 周期 flush 距离上次成功超过安全窗口 |
| `flush_timeout_near` | flush 耗时接近或超过 `flush_timeout` |
| `batch_summary_limit` | batch summary 达到内存或写入上限 |
| `collector_panic` | collector 主循环 panic 并自动重启 |
| `flusher_panic` | flusher 主循环 panic 并自动重启 |

诊断数据可通过 `/metrics/current` API 的 diagnostics 字段和 `horizon:snapshot` 命令查看。

## Metrics

Horizon 通过 collector 监听 queue 事件并聚合为 event_metrics 窗口。每个窗口按事件时间归属，包含以下计数：

| 指标 | 说明 |
| --- | --- |
| `processed` | 成功处理的任务数 |
| `failed` | 失败的任务数 |
| `released` | 释放重试的任务数 |
| `poison` | 无法解析的 poison envelope 数 |
| `queued` | 入队任务数 |
| `runtime_ms` | 任务运行耗时总量（毫秒） |

窗口还包含采样率和质量标记，用于 Dashboard 展示数据可信度。

手动生成快照：

```bash
go run ./ horizon:snapshot
```

`horizon:snapshot` 会等待调用开始前 collector 已接受的事件完成聚合，再持久化本次快照；因此无需通过额外延时来等待后台 collector。

清理指标：

```bash
go run ./ horizon:clear-metrics
```

## 失败任务

Horizon 不替代 `github.com/prismgo/framework/queue` 的 FailedStore，但提供 `horizon:forget` 命令维护失败记录：

```bash
# 删除单条失败记录
go run ./ horizon:forget <id>

# 删除所有失败记录
go run ./ horizon:forget --all
```

失败任务的安全摘要（不含 payload 和完整堆栈）通过高价值诊断明细通道采集，可在 Dashboard 的 `/high-value-detail?kind=failed` 查看。

## 长等待事件

当队列等待时间超过 `horizon.waits` 中配置的阈值时，Horizon 会发出 `horizon.long_wait` 事件。业务应用可以通过 `github.com/prismgo/framework/event` 监听该事件，将事件转换为通知、日志或外部告警。

```go
event.Listen("horizon.long_wait", func(ctx context.Context, e event.Event) error {
    var evt horizon.LongWaitEvent
    // 解析事件，包含 connection、queue、threshold_ms、wait_ms、sampled_at
    return nil
})
```

`LongWaitEvent` 只包含 connection、queue、阈值、观测值和采样时间，不包含 job payload。

## 批次摘要

当 `observability.batch_summaries` 启用时，Horizon 会监听 `queue.EventBatchCreated`、`queue.EventBatchUpdated`、`queue.EventBatchCancelled` 和 `queue.EventBatchFinished` 事件，生成批次安全摘要。

批次摘要只保存进度、状态和时间戳，不暴露 batch 内部 job payload、raw envelope 或 broker 字段。可通过 Dashboard 的 `/batches` API 查看。

## Store 接口

Horizon Store 是状态存储的抽象接口，支持 Redis 和 Memory 两种实现。Store 保存以下数据：

| 数据类型 | 说明 |
| --- | --- |
| Master/Supervisor/Worker heartbeat | 进程心跳，用于存活判断和状态展示 |
| ControlState | 全局和 supervisor 级控制标记（pause/terminate） |
| StatusSnapshot | 全局运行状态派生视图 |
| EventMetricWindow | 事件时间聚合窗口 |
| QueueLengthSnapshot | 队列长度采样 |
| HighValueJobDetail | 高价值诊断摘要 |
| ObservabilityDiagnostic | 丢弃和降级诊断 |
| BatchSummary | 批次安全摘要 |
| OrphanProcess | 孤儿进程记录 |

`Store` 接口定义了 30+ 方法，涵盖心跳写入、控制标记、metrics 读写、诊断和孤儿进程管理。生产推荐使用 Redis Store，测试可使用 Memory Store。

> **注意**：Memory Store 仅适用于本地/测试环境，不推荐在生产环境使用。使用 Memory Store 时，Horizon 会在命令启动时输出警告。

## 部署 Horizon

### 进程管理

Horizon master 使用 systemd、supervisord、Docker 或 Kubernetes 管理。部署流程：

1. 发送 `horizon:terminate` 请求优雅退出当前 master
2. 进程管理器检测到退出后拉起新 master
3. 新 master 加载最新配置并派生 supervisor

### 配置要点

- `timeout` 应小于队列连接的 `retry_after`，避免同一任务被并发重复消费
- 认证、支付、通知等队列应拆分 supervisor，便于独立扩缩容
- 保持 `HORIZON_PREFIX` 与业务队列 key 前缀不同，避免状态混淆
- 高吞吐生产环境优先使用 `production_light` 或调低采样率
- 当 job type、tenant、tag 基数很高时，优先限制 `max_aggregate_keys`、降低采样率或使用 `production_light`

### 已移除的配置

以下配置字段和环境变量已被移除，使用时会报错：

| 已移除 | 替代方案 |
| --- | --- |
| `horizon.trim` | 使用 `observability.event_metrics_retention` / `high_value_detail_retention` / `batch_summary_retention` / `diagnostics_retention` |
| `horizon.silenced` / `horizon.silenced_tags` | 高价值明细不再按 silenced 规则过滤 |
| `horizon.metrics.trim_snapshots` | 使用 `observability.event_metrics_retention` |
| `observability.recent_jobs` | 使用 `failed_detail_enabled` 或 `poison_detail_enabled` |
| `observability.recent_jobs_max` | 使用 `buffer_size` 或 `max_aggregate_keys` |
| `observability.job_history` / `observability.queue_history` | 使用 `event_metrics` |
| `observability.success_detail_enabled` | 成功任务明细已移除，不再采集 |
| `HORIZON_TRIM_RECENT` / `HORIZON_TRIM_FAILED` / `HORIZON_TRIM_MONITORED` | 使用对应的 retention 环境变量 |
| `HORIZON_SILENCED` / `HORIZON_SILENCED_TAGS` | silenced 规则已移除 |
