# Horizon

- [Introduction](#introduction)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Basic Configuration](#basic-configuration)
  - [Environment Selection](#environment-selection)
  - [Supervisor Configuration](#supervisor-configuration)
  - [Balance Strategies](#balance-strategies)
- [Running Horizon](#running-horizon)
  - [Starting the Master](#starting-the-master)
  - [Starting a Worker](#starting-a-worker)
  - [Local Development Watcher](#local-development-watcher)
- [Control Commands](#control-commands)
  - [Pausing & Resuming](#pausing--resuming)
  - [Graceful Termination](#graceful-termination)
- [Diagnostic Commands](#diagnostic-commands)
- [Maintenance Commands](#maintenance-commands)
- [Dashboard](#dashboard)
  - [Route Registration](#route-registration)
  - [Authorization](#authorization)
  - [HTTP API Reference](#http-api-reference)
- [Observability Configuration](#observability-configuration)
  - [Presets](#presets)
  - [Capability Switches](#capability-switches)
  - [Collection & Writing](#collection--writing)
  - [Sampling](#sampling)
  - [High-Value Diagnostic Details](#high-value-diagnostic-details)
  - [Data Retention & Cleanup](#data-retention--cleanup)
  - [Diagnostics & Degradation](#diagnostics--degradation)
- [Metrics](#metrics)
- [Failed Jobs](#failed-jobs)
- [Long Wait Events](#long-wait-events)
- [Batch Summaries](#batch-summaries)
- [Store Interface](#store-interface)
- [Deploying Horizon](#deploying-horizon)

---

## Introduction

PrismGo Horizon provides queue runtime monitoring and supervisor management capabilities, corresponding to the core features of Laravel Horizon. It is built around `github.com/prismgo/framework/queue` events, workers, failed stores, and batch stores, and is responsible for queue runtime views, control commands, metrics aggregation, Dashboard API, and process heartbeats. It does not replace the queue driver itself.

Core process model:

| Concept | Description |
| --- | --- |
| Master | The Horizon master process that loads the current environment's supervisor configuration and spawns child processes |
| Supervisor | A configuration unit for a group of queue workers, declaring connection, queue, process count, retry, and timeout strategies |
| Worker | A real `horizon:work` child process that consumes queue tasks |

Horizon's state is separate from queue messages. Queue messages are still managed by `github.com/prismgo/framework/queue` Redis, RabbitMQ, or other drivers; the Horizon Store only holds monitoring and control data.

## Installation

Use the `horizon:install` command to generate the configuration file and service provider stubs:

```bash
go run ./ horizon:install
```

This command creates `config/horizon.go` and `app/providers/horizon_service_provider.go` only when they don't already exist; existing files are never overwritten. After installation, you need to manually register `horizon.ServiceProvider{}` in `bootstrap/provider.go`.

Dashboard assets are embedded in the binary, so no additional publish step is required.

## Configuration

The configuration entry point is `config/horizon.go`. All configuration is registered under the `horizon` namespace and supports environment variable overrides.

### Basic Configuration

| Config Key | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `horizon.use` | `HORIZON_STORE` | `redis` | Horizon Store type. Use `redis` for production; `memory` for testing |
| `horizon.path` | `HORIZON_PATH` | `horizon` | Dashboard and internal API mount prefix, without leading/trailing slashes |
| `horizon.connection` | `HORIZON_CONNECTION` | `default` | Redis connection name used by the Horizon Redis Store, independent of queue/cache/session connections |
| `horizon.prefix` | `HORIZON_PREFIX` | `prismgo_horizon` | Key prefix for the Horizon Store; should be distinct from business queue key prefixes |
| `horizon.encoding` | `HORIZON_ENCODING` | empty | Payload Encoding name for Store records; empty inherits `encoding.default` (defaults to `msgpack`), set to `json` explicitly for debugging |
| `horizon.heartbeat_ttl_seconds` | `HORIZON_HEARTBEAT_TTL_SECONDS` | `60` | Time window (seconds) within which a master/supervisor/worker heartbeat is considered alive. Processes that haven't refreshed their heartbeat beyond this window are marked as stale |
| `horizon.fast_termination` | — | `false` | Whether to allow a new master to start first during termination |
| `horizon.memory_limit` | — | `128` | Default memory limit (MB) for Horizon workers |
| `horizon.waits` | — | empty | Long-wait threshold in seconds per `connection:queue`, used by the waits observability feature |

### Environment Selection

Horizon determines the current environment name using the following priority:

1. `horizon.environment` — allows Horizon to independently override the application environment
2. `app.env` — project-level configuration source
3. `APP_ENV` environment variable — compatibility fallback
4. Default value `production`

The environment name is used to select the corresponding supervisor configuration from `horizon.environments`. Environment matching supports Laravel `Str::is` style wildcards — for example, `production-*` matches `production-web`, `production-worker`, etc. Exact matches take priority over wildcard matches.

### Supervisor Configuration

`horizon.defaults` is the baseline supervisor configuration shared across all environments; supervisors with the same name in `horizon.environments.{env}` override fields from defaults. Supervisors that only exist in the environment section are also parsed, allowing per-environment queue consumer groups to be added.

#### Configuration Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `connection` | string | required | Queue connection name; determines which queue connection the worker pulls tasks from |
| `queue` | string or []string | required | Queue name list; supports comma-separated strings or arrays. Whitespace is trimmed, duplicates are removed, and configuration order is preserved |
| `balance` | string | `false` | Load balancing strategy: `false`, `simple`, or `auto` |
| `min_processes` | int | `0` | Minimum number of workers for the supervisor |
| `max_processes` | int | `0` | Maximum number of workers for the supervisor; must be >= `min_processes` |
| `tries` | int | `0` | Maximum retry attempts for a single task; after reaching this limit, the task enters the failed store |
| `timeout` | int | `0` | Execution timeout in seconds for a single task |
| `sleep` | int | `0` | Polling interval in seconds when the queue is empty |
| `max_jobs` | int | `0` | Number of jobs after which the worker exits; `0` means no limit |
| `max_time` | int | `0` | Number of seconds after which the worker exits; `0` means no limit |
| `retry_after` | int | `0` | Time window in seconds before a reserved task becomes visible again; should always be greater than `timeout` to avoid concurrent duplicate consumption |
| `backoff` | int or []int | empty | Failure retry backoff in seconds; supports a single number, comma-separated string, or array |
| `stop_when_empty` | bool | `false` | Whether the worker exits when the queue is empty; suitable for one-time consumption scenarios |
| `memory` | int | `0` | Worker memory limit in MB (compatibility field; currently only parsed and displayed in the Go implementation) |
| `nice` | int | `0` | Process priority (compatibility field; currently only parsed and displayed in the Go implementation) |
| `auto_scaling_strategy` | string | `time` | Strategy used by auto balance: `time` (by estimated drain time) or `size` (by queue length) |
| `balance_max_shift` | int | `1` | Maximum number of workers that auto balance can move in a single scaling operation; limits scaling magnitude |
| `balance_cooldown` | int | `3` | Minimum interval in seconds between two auto balance calculations; reduces scaling oscillation |

> **Note**: Only snake_case field names are supported. camelCase fields (such as `maxProcesses`, `minProcesses`, `retryAfter`, etc.) will cause a parse error with a message indicating the correct snake_case name.

#### Configuration Example

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

#### Scenario Recommendations

| Scenario | Recommendation |
| --- | --- |
| Local development | `max_processes=1` to reduce debug noise from concurrency |
| Standard production queues | `balance=auto`, `min_processes=1`, set `max_processes` based on throughput |
| High-priority notification/payment queues | Separate supervisor with its own `queue` and `max_processes` |
| One-time compensation tasks | `stop_when_empty=true` with a small `max_time` |
| Long-running tasks | Increase `timeout` and correspondingly increase `retry_after` |

### Balance Strategies

Horizon supports three load balancing strategies, corresponding to Laravel Horizon's balance configuration:

#### `balance=false` (default)

No automatic balancing. All configured queues are consumed by a single process pool, with the worker count adjusted between `min_processes` and `max_processes` based on queue backlog. Suitable for scenarios where each queue has a fixed process count or automatic scheduling is not needed.

#### `balance=simple`

Fixed allocation across configured queues. Each queue gets `max_processes / len(queues)` workers, with the result clamped to the `[min_processes, max_processes]` range. Suitable for simple fixed allocation across multiple queues.

#### `balance=auto`

Dynamically adjusts worker count between `min_processes` and `max_processes` based on queue workload. Constrained by `balance_max_shift` and `balance_cooldown` to prevent aggressive scaling or oscillation.

The workload calculation for auto balance is determined by `auto_scaling_strategy`:

| Strategy | Calculation | Use Case |
| --- | --- | --- |
| `time` (default) | `weight = ready_jobs × avg_runtime` | When you care more about wait time; aligns with Laravel's default semantics |
| `size` | `weight = ready_jobs` | When you care more about backlog size |

## Running Horizon

### Starting the Master

In production, the `horizon` master is typically started by a process manager:

```bash
go run ./ horizon --environment=production
```

The `--environment` flag specifies the Horizon environment name; when empty, the actual runtime environment is determined by the loaded configuration. The master process loads the current environment's supervisor configuration and spawns supervisor child processes.

### Starting a Worker

Workers are typically spawned automatically by supervisors, but can also be run manually:

```bash
go run ./ horizon:work redis --queue=default --tries=3 --timeout=60
```

`horizon:work` supports the following options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--name` | string | empty | Worker name |
| `--queue` | string | `default` | Queue name(s) to listen on; comma-separated values are supported |
| `--connection` | positional arg | empty | Queue connection name |
| `--backoff` | string | `0` | Backoff strategy |
| `--retry-after` | int | `90` | Job retry retention window (seconds) |
| `--max-jobs` | int | `0` | Maximum jobs per worker; 0 means no limit |
| `--max-time` | int | `0` | Maximum runtime in seconds per worker; 0 means no limit |
| `--force` | bool | `false` | Force run flag |
| `--memory` | int | `0` | Memory limit (MB); 0 means no limit |
| `--once` | bool | `false` | Process only one job and exit |
| `--stop-when-empty` | bool | `false` | Stop when the queue is empty |
| `--sleep` | int | `3` | Sleep seconds when queue is empty |
| `--rest` | int | `0` | Rest seconds between jobs |
| `--supervisor` | string | empty | Parent supervisor name |
| `--timeout` | int | `60` | Per-job timeout in seconds |
| `--tries` | int | `1` | Maximum retry attempts |
| `--json` | bool | `false` | JSON output mode |
| `--environment` | string | empty | Horizon environment name |
| `--prefix` | string | empty | Store key prefix |

### Local Development Watcher

```bash
go run ./ horizon:listen
```

`horizon:listen` is a local development helper that watches for file changes and restarts Horizon. It supports the following options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--environment` | string | `local` | Horizon environment name |
| `--poll` | int | `1000` | File polling interval (milliseconds) |

> **Note**: `horizon:listen` is intended for local development only and is not recommended for production.

## Control Commands

### Pausing & Resuming

Pause all supervisors:

```bash
go run ./ horizon:pause
```

Resume all supervisors:

```bash
go run ./ horizon:continue
```

Pause a specific supervisor:

```bash
go run ./ horizon:pause-supervisor supervisor-default
```

Resume a specific supervisor:

```bash
go run ./ horizon:continue-supervisor supervisor-default
```

Pausing and resuming are implemented through Store control flags and do not directly terminate processes. Paused workers will not consume new tasks, but tasks already in progress will continue to completion.

### Graceful Termination

```bash
go run ./ horizon:terminate
go run ./ horizon:terminate --wait
```

The `--wait` flag controls the termination wait strategy. Terminate requests take priority over pause; once written, they notify fresh master/supervisor processes to exit as soon as possible.

## Diagnostic Commands

| Command | Description |
| --- | --- |
| `horizon:status` | Display the global runtime status snapshot, including status, pause/terminate flags, supervisor/worker counts, and stale counts |
| `horizon:list` | List running master machines, showing Name, PID, Supervisors, Status |
| `horizon:supervisors` | List all supervisors with basic status |
| `horizon:supervisor-status <name>` | Display detailed status for a specific supervisor, including Pools, Connection, Queues, etc. |
| `horizon:timeout [environment]` | Display the maximum worker timeout in seconds for the specified environment; defaults to `production` |
| `horizon:stale` | List all stale processes (master/supervisor/worker) whose heartbeat has exceeded the TTL; read-only, no writes |

## Maintenance Commands

| Command | Description |
| --- | --- |
| `horizon:snapshot` | Persist queue length snapshots and current collector event-derived metrics to the Store |
| `horizon:clear-metrics` | Clear event-derived metrics from the Store and collector memory aggregation. Does not clear heartbeats, control flags, queue data, or failed records |
| `horizon:clear <connection> --queue=<name> --force` | Clear a queue covered by the current environment's supervisor configuration. The `--force` flag is required |
| `horizon:forget <id>` | Delete a specific failed job record |
| `horizon:forget --all` | Delete all failed job records |
| `horizon:purge --signal=SIGTERM` | Purge orphan worker processes that no longer belong to an active supervisor pool |

## Dashboard

The Dashboard path is controlled by `horizon.path`, defaulting to `/horizon`. The internal API uses read-only endpoints under the same prefix.

### Route Registration

Call `RegisterHTTPRoutes` during application route registration:

```go
horizon.RegisterHTTPRoutes(horizon.HTTPOptions{
    Manager: manager,
    Auth:    []gin.HandlerFunc{authMiddleware, permissionMiddleware},
})
```

`HTTPOptions` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Manager` | `*Manager` | Provides Horizon static configuration and Store resolution; uses the default Manager when empty |
| `Auth` | `[]gin.HandlerFunc` | Authentication middleware injected by the application, typically including login verification, permission loading, and `horizon.view` authorization |

### Authorization

The Dashboard and API share the `horizon.view` permission identifier. Currently, only the observation surface is exposed; write operations such as retry, pause, and terminate are not available through the API. For production, it is recommended to add authentication and IP allowlists for the `/horizon` path at the application routing layer.

### HTTP API Reference

All API endpoints are read-only GET routes mounted under the `/{horizon.path}/api` prefix. Endpoints that support pagination accept `page` and `page_size` query parameters.

#### Global Status

```
GET /{horizon.path}/api/status
```

Returns a lightweight runtime status summary for the Dashboard landing page, including global status, queue lengths, and capability list.

Response example:

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

#### Master List

```
GET /{horizon.path}/api/masters?page=1&page_size=25
```

Returns a list of running master processes, including process identity, heartbeat, goroutine, and memory metrics.

#### Supervisor List

```
GET /{horizon.path}/api/supervisors?page=1&page_size=25
```

Returns a list of supervisors, including name, status, worker count, connection, queues, and process pool state.

#### Worker List

```
GET /{horizon.path}/api/workers?page=1&page_size=25
```

Returns a list of workers, including process identity, status, configured queues, and resource metrics.

#### Stale Processes

```
GET /{horizon.path}/api/stale?page=1&page_size=25
```

Returns stale supervisors and workers whose heartbeat has exceeded the TTL.

#### Queue View

```
GET /{horizon.path}/api/queues?page=1&page_size=25
```

Returns an aggregated queue view combining queue lengths and event metrics to show throughput, wait times, and runtime information for each connection:queue.

#### Current Metrics

```
GET /{horizon.path}/api/metrics/current
```

Returns the current event metrics aggregated view. Defaults to the last 24 hours of data.

Query parameters:

| Parameter | Type | Description |
| --- | --- | --- |
| `from` | RFC3339 | Time range lower bound (window WindowEnd > From) |
| `to` | RFC3339 | Time range upper bound (window WindowStart < To) |
| `source_host` | string | Exact filter by host |
| `source_environment` | string | Exact filter by Horizon environment |
| `source_supervisor` | string | Exact filter by supervisor |
| `connection` | string | Exact filter by queue connection |
| `queue` | string | Exact filter by queue name |
| `source_details` | bool | Include source shard details; omitted by default |
| `summary_only` | bool | Return only queue aggregation summary |
| `page` / `page_size` | int | Pagination parameters |

> The time range must not exceed 24 hours. `from` must be before `to`. All time parameters must include a timezone.

#### Metric Sources

```
GET /{horizon.path}/api/metrics/sources
```

Returns the source dimension list for event metrics, used for Dashboard drill-down. Supports the same filtering parameters as `/metrics/current`.

#### Metric History

```
GET /{horizon.path}/api/metrics/history/{kind}/{key}
```

Returns metric history data points for the specified dimension. Currently, `kind` only supports `queue`, and `key` uses the `connection:queue` format.

Query parameters are the same as `/metrics/current`.

#### High-Value Detail List

```
GET /{horizon.path}/api/high-value-detail
```

Returns a list of high-value diagnostic summaries for failed, poison, and slow_job types.

Query parameters:

| Parameter | Type | Description |
| --- | --- | --- |
| `kind` | string | Filter by type: `failed`, `poison`, or `slow_job` |
| `occurred_from` | RFC3339 | Event occurrence time lower bound |
| `occurred_to` | RFC3339 | Event occurrence time upper bound |
| `page` / `page_size` | int | Pagination parameters |

#### High-Value Detail

```
GET /{horizon.path}/api/high-value-detail/{id}
```

Returns the diagnostic summary detail for the specified ID. Returns 404 if not found.

#### Batch Summary List

```
GET /{horizon.path}/api/batches
```

Returns a list of batch safe summaries. Supports `query` or `search` parameters to search by ID or name.

#### Batch Detail

```
GET /{horizon.path}/api/batches/{id}
```

Returns the batch summary detail for the specified ID. Returns 404 if not found.

## Observability Configuration

Horizon generates wait times, runtimes, failures, poison envelopes, batch summaries, and queue length metrics through queue events. Observability configuration is centralized under `horizon.observability`.

### Presets

| Preset | Description |
| --- | --- |
| `full` | Development and debugging priority; retains full observability capabilities with 100% sampling |
| `production_light` | Retains core health, queue lengths, and queue-level aggregation; reduces per-job cost with 10% sampling |
| `minimal` | Retains only core health and queue lengths; disables event_metrics and per-job details |

Presets only provide default values; all explicit sub-fields override the preset. This allows you to start from `production_light` and selectively enable diagnostic capabilities.

### Capability Switches

| Config Key | Environment Variable | Default (full) | Description |
| --- | --- | --- | --- |
| `observability.preset` | `HORIZON_OBSERVABILITY_PRESET` | `full` | Observability preset |
| `observability.event_metrics` | `HORIZON_OBSERVABILITY_EVENT_METRICS` | `true` | Whether to collect queue event-derived queue-level counters and runtime aggregation |
| `observability.waits` | `HORIZON_OBSERVABILITY_WAITS` | `true` | Whether to retain queued wait time state and long wait events. Requires `event_metrics=true` and `queued_waits_max>0` |
| `observability.batch_summaries` | `HORIZON_OBSERVABILITY_BATCH_SUMMARIES` | `true` | Whether to save batch read-only summaries |
| `observability.process_health` | `HORIZON_OBSERVABILITY_PROCESS_HEALTH` | `true` | Whether to enable heartbeat, status, and control flag core health capabilities |
| `observability.queue_lengths` | `HORIZON_OBSERVABILITY_QUEUE_LENGTHS` | `true` | Whether to sample queue backend lengths |
| `observability.queued_waits_max` | `HORIZON_OBSERVABILITY_QUEUED_WAITS_MAX` | `10000` | Maximum number of per-job wait time states; `0` means no retention |
| `observability.processing_spans_max` | `HORIZON_OBSERVABILITY_PROCESSING_SPANS_MAX` | `10000` | Maximum number of processing spans; `0` means no retention |
| `observability.processing_cleanup_interval_seconds` | `HORIZON_OBSERVABILITY_PROCESSING_CLEANUP_INTERVAL_SECONDS` | `60` | Processing span TTL cleanup throttle interval in seconds |

Capability switches have interdependencies:

- `waits` requires `event_metrics=true` and `queued_waits_max>0`
- `high_value_detail` requires at least one detail channel (`failed_detail_enabled`, `poison_detail_enabled`, `slow_job_detail_enabled`) to be enabled, and a sample rate > 0
- `processing_spans` requires `event_metrics=true` and `processing_spans_max>0`

### Collection & Writing

| Config Key | Environment Variable | Default (full) | Description |
| --- | --- | --- | --- |
| `observability.metrics_window` | `HORIZON_OBSERVABILITY_METRICS_WINDOW` | `1m` | Event time aggregation bucket width for event_metrics; independent of flush_interval |
| `observability.flush_interval` | `HORIZON_OBSERVABILITY_FLUSH_INTERVAL` | `1m` | Periodic flush interval from collector to Store |
| `observability.flush_timeout` | `HORIZON_OBSERVABILITY_FLUSH_TIMEOUT` | `5s` | Wait limit for a single Store write during flush |
| `observability.batch_size` | `HORIZON_OBSERVABILITY_BATCH_SIZE` | `500` | Maximum number of increments or details written in a single flush |
| `observability.batch_summary_size` | `HORIZON_OBSERVABILITY_BATCH_SUMMARY_SIZE` | `500` | Maximum number of batch summaries retained or written per cycle; defaults to `batch_size` when not explicitly configured |
| `observability.buffer_size` | `HORIZON_OBSERVABILITY_BUFFER_SIZE` | `10000` | Number of entries in the bounded memory buffer between collector and flusher |
| `observability.max_events_per_second` | `HORIZON_OBSERVABILITY_MAX_EVENTS_PER_SECOND` | `0` | Collector ingress rate limit; `0` means no additional rate limiting |
| `observability.drop_policy` | `HORIZON_OBSERVABILITY_DROP_POLICY` | `drop_oldest` | Drop policy when the buffer is full or degraded: `drop_oldest` (prefer dropping oldest) or `drop_newest` (drop current entry) |

Data flow: queue event → Collector (non-blocking enqueue) → in-memory aggregation windows → Flusher (periodic batch write) → Store

### Sampling

| Config Key | Environment Variable | Default (full) | Description |
| --- | --- | --- | --- |
| `observability.event_metrics_sample_rate` | `HORIZON_OBSERVABILITY_EVENT_METRICS_SAMPLE_RATE` | `1` | Sampling rate for queue events entering the event_metrics pipeline. `1` means full, `0` means disabled, `0.1` means 10% |
| `observability.high_value_detail_sample_rate` | `HORIZON_OBSERVABILITY_HIGH_VALUE_DETAIL_SAMPLE_RATE` | empty | Independent sampling rate for failed, poison, and slow job details; empty inherits the current actual event_metrics sampling rate |
| `observability.sample_reservoir_size` | `HORIZON_OBSERVABILITY_SAMPLE_RESERVOIR_SIZE` | `2048` | Sample reservoir size for P95/P99 estimation |
| `observability.max_aggregate_keys` | `HORIZON_OBSERVABILITY_MAX_AGGREGATE_KEYS` | `10000` | Aggregate key cardinality limit (connection+queue/job type); prevents memory exhaustion from too many keys |
| `observability.aggregate_key_ttl` | `HORIZON_OBSERVABILITY_AGGREGATE_KEY_TTL` | `30m` | Expiration window for low-activity aggregate keys |
| `observability.dynamic_sampling_enabled` | `HORIZON_OBSERVABILITY_DYNAMIC_SAMPLING_ENABLED` | `true` | Whether to allow dynamic reduction of the actual sampling rate under pressure |
| `observability.min_sample_rate` | `HORIZON_OBSERVABILITY_MIN_SAMPLE_RATE` | `0.01` | Minimum sampling rate during dynamic sampling degradation |

Sampling rate affects data quality labels:

| Quality Label | Meaning |
| --- | --- |
| `exact` | Derived from full events; no sampling or drop degradation |
| `estimated` | Derived from sampled event estimation |
| `degraded` | Affected by drops, Store failures, or other degradation |
| `unknown` | Unquantifiable loss exists; cannot be displayed as estimated or exact |
| `partial` | Shutdown best-effort flush wrote an incomplete window |

### High-Value Diagnostic Details

| Config Key | Environment Variable | Default (full) | Description |
| --- | --- | --- | --- |
| `observability.failed_detail_enabled` | `HORIZON_OBSERVABILITY_FAILED_DETAIL_ENABLED` | `true` | Whether to save failed job safe summaries |
| `observability.poison_detail_enabled` | `HORIZON_OBSERVABILITY_POISON_DETAIL_ENABLED` | `true` | Whether to save poison envelope summaries for unparseable payloads |
| `observability.slow_job_detail_enabled` | `HORIZON_OBSERVABILITY_SLOW_JOB_DETAIL_ENABLED` | `true` | Whether to save slow job summaries |
| `observability.slow_job_threshold` | `HORIZON_OBSERVABILITY_SLOW_JOB_THRESHOLD` | `30s` | Slow job diagnostic threshold |

High-value diagnostic details only save safe summaries (connection, queue, job name, runtime, truncated error summary); they do not save job payloads, raw envelopes, or complete error stacks.

### Data Retention & Cleanup

| Config Key | Environment Variable | Default (full) | Description |
| --- | --- | --- | --- |
| `observability.event_metrics_retention` | `HORIZON_OBSERVABILITY_EVENT_METRICS_RETENTION` | `24h` | Retention period for event_metrics aggregated data |
| `observability.high_value_detail_retention` | `HORIZON_OBSERVABILITY_HIGH_VALUE_DETAIL_RETENTION` | `24h` | Retention period for high-value diagnostic details |
| `observability.batch_summary_retention` | `HORIZON_OBSERVABILITY_BATCH_SUMMARY_RETENTION` | `24h` | Retention period for batch summaries |
| `observability.diagnostics_retention` | `HORIZON_OBSERVABILITY_DIAGNOSTICS_RETENTION` | `24h` | Retention period for drop/degradation diagnostic data |

Expired data is cleaned up by the Store's `Trim` operation, which is executed periodically in the supervisor runtime loop.

### Diagnostics & Degradation

When the collector/flusher experiences drops or degradation, `ObservabilityDiagnostic` records are written with stable reason identifiers and counts. Common drop reasons:

| Reason | Description |
| --- | --- |
| `buffer_full` | Bounded buffer is full, causing observability data to be dropped |
| `rate_limited` | `max_events_per_second` rate limiting |
| `aggregate_key_overflow` | Aggregate key cardinality limit reached |
| `store_unavailable` | Flush Store write failure or timeout |
| `flush_lag_exceeded` | Periodic flush lag exceeds safe window since last success |
| `flush_timeout_near` | Flush duration approaches or exceeds `flush_timeout` |
| `batch_summary_limit` | Batch summary memory or write limit reached |
| `collector_panic` | Collector main loop panicked and auto-restarted |
| `flusher_panic` | Flusher main loop panicked and auto-restarted |

Diagnostic data can be viewed through the `/metrics/current` API diagnostics field and the `horizon:snapshot` command.

## Metrics

Horizon monitors queue events through the collector and aggregates them into event_metrics windows. Each window is attributed by event time and contains the following counts:

| Metric | Description |
| --- | --- |
| `processed` | Number of successfully processed jobs |
| `failed` | Number of failed jobs |
| `released` | Number of released/retried jobs |
| `poison` | Number of unparseable poison envelopes |
| `queued` | Number of queued jobs |
| `runtime_ms` | Total job runtime in milliseconds |

Windows also include sampling rates and quality labels for Dashboard display of data trustworthiness.

Manually generate a snapshot:

```bash
go run ./ horizon:snapshot
```

Clear metrics:

```bash
go run ./ horizon:clear-metrics
```

## Failed Jobs

Horizon does not replace `github.com/prismgo/framework/queue`'s FailedStore, but provides the `horizon:forget` command for maintaining failed records:

```bash
# Delete a single failed record
go run ./ horizon:forget <id>

# Delete all failed records
go run ./ horizon:forget --all
```

Safe summaries of failed jobs (without payloads or complete stacks) are collected through the high-value diagnostic detail channel and can be viewed on the Dashboard at `/high-value-detail?kind=failed`.

## Long Wait Events

When queue wait times exceed the thresholds configured in `horizon.waits`, Horizon emits a `horizon.long_wait` event. Applications can listen for this event through `github.com/prismgo/framework/event` to convert it into notifications, logs, or external alerts.

```go
event.Listen("horizon.long_wait", func(ctx context.Context, e event.Event) error {
    var evt horizon.LongWaitEvent
    // Parse the event, which contains connection, queue, threshold_ms, wait_ms, sampled_at
    return nil
})
```

`LongWaitEvent` only contains connection, queue, threshold, observed value, and sampling time; it does not contain job payloads.

## Batch Summaries

When `observability.batch_summaries` is enabled, Horizon listens for `queue.EventBatchCreated`, `queue.EventBatchUpdated`, `queue.EventBatchCancelled`, and `queue.EventBatchFinished` events to generate batch safe summaries.

Batch summaries only save progress, status, and timestamps; they do not expose internal batch job payloads, raw envelopes, or broker fields. They can be viewed through the Dashboard's `/batches` API.

## Store Interface

The Horizon Store is an abstract state storage interface that supports Redis and Memory implementations. The Store holds the following data:

| Data Type | Description |
| --- | --- |
| Master/Supervisor/Worker heartbeat | Process heartbeats for liveness detection and status display |
| ControlState | Global and supervisor-level control flags (pause/terminate) |
| StatusSnapshot | Global runtime status derived view |
| EventMetricWindow | Event time aggregation windows |
| QueueLengthSnapshot | Queue length samples |
| HighValueJobDetail | High-value diagnostic summaries |
| ObservabilityDiagnostic | Drop and degradation diagnostics |
| BatchSummary | Batch safe summaries |
| OrphanProcess | Orphan process records |

The `Store` interface defines 30+ methods covering heartbeat writes, control flags, metrics reads/writes, diagnostics, and orphan process management. Redis Store is recommended for production; Memory Store can be used for testing.

> **Note**: Memory Store is only suitable for local/testing environments and is not recommended for production. When using Memory Store, Horizon outputs a warning at command startup.

## Deploying Horizon

### Process Management

The Horizon master is managed by systemd, supervisord, Docker, or Kubernetes. Deployment workflow:

1. Send a `horizon:terminate` request to gracefully exit the current master
2. The process manager detects the exit and starts a new master
3. The new master loads the latest configuration and spawns supervisors

### Configuration Guidelines

- `timeout` should be less than the queue connection's `retry_after` to avoid concurrent duplicate consumption of the same task
- Authentication, payment, and notification queues should be split into separate supervisors for independent scaling
- Keep `HORIZON_PREFIX` distinct from business queue key prefixes to avoid state confusion
- For high-throughput production environments, prefer `production_light` or reduce sampling rates
- When job type, tenant, or tag cardinality is high, prioritize limiting `max_aggregate_keys`, reducing sampling rates, or using `production_light`

### Removed Configuration

The following configuration fields and environment variables have been removed and will cause errors when used:

| Removed | Replacement |
| --- | --- |
| `horizon.trim` | Use `observability.event_metrics_retention` / `high_value_detail_retention` / `batch_summary_retention` / `diagnostics_retention` |
| `horizon.silenced` / `horizon.silenced_tags` | High-value details are no longer filtered by silenced rules |
| `horizon.metrics.trim_snapshots` | Use `observability.event_metrics_retention` |
| `observability.recent_jobs` | Use `failed_detail_enabled` or `poison_detail_enabled` |
| `observability.recent_jobs_max` | Use `buffer_size` or `max_aggregate_keys` |
| `observability.job_history` / `observability.queue_history` | Use `event_metrics` |
| `observability.success_detail_enabled` | Successful job details have been removed and are no longer collected |
| `HORIZON_TRIM_RECENT` / `HORIZON_TRIM_FAILED` / `HORIZON_TRIM_MONITORED` | Use the corresponding retention environment variables |
| `HORIZON_SILENCED` / `HORIZON_SILENCED_TAGS` | Silenced rules have been removed |
