---
title: "定时任务调度器"
---

# 定时任务调度器

- [简介](#简介)
- [启动调度器](#启动调度器)
- [配置](#配置)
- [定义调度任务](#定义调度任务)
  - [通过命令签名注册](#通过命令签名注册)
  - [通过闭包注册](#通过闭包注册)
- [调度频率](#调度频率)
  - [固定间隔](#固定间隔)
  - [秒级调度](#秒级调度)
  - [分钟级调度](#分钟级调度)
  - [小时级调度](#小时级调度)
  - [每日调度](#每日调度)
  - [每周调度](#每周调度)
  - [每月调度](#每月调度)
  - [季度 / 年度调度](#季度--年度调度)
- [防重叠执行](#防重叠执行)
- [启动与停止调度器](#启动与停止调度器)
- [查看已注册任务](#查看已注册任务)
- [异常处理](#异常处理)
- [执行模型](#执行模型)
- [参数解析规则](#参数解析规则)
  - [时间字符串](#时间字符串)
  - [分钟和小时列表](#分钟和小时列表)
  - [星期值](#星期值)
- [Timer 基础类型](#timer-基础类型)
- [常见用法示例](#常见用法示例)
- [验证](#验证)

## 简介

`github.com/prismgo/framework/timer` 提供了一套 Laravel Scheduler 风格的定时任务调度系统。开发者可以通过链式调用将项目内的命令或 Go 闭包注册为周期任务，由调度器在后台自动执行。

**适用场景：**

- 分钟级巡检：超时工单检测、失败消息重试
- 每日批处理：对账、关单、日报生成
- 每周 / 每月结算：报表归档、区域数据同步
- 短周期后台回调：内存刷新、健康检查、指标采集

**核心设计：**

- 与项目命令系统共享同一套命令定义，避免业务逻辑写两遍
- 链式接口表达调度频率，注册代码接近业务语言
- 固定间隔与日历时间两种模式，适配不同类型的后台任务

## 启动调度器

### 环境要求

调度器以常驻进程方式运行，需要确保：

- 已安装 Go 运行环境，或已编译为二进制文件
- 数据库、缓存等依赖服务可正常连接
- 操作系统时区配置正确（影响日历调度命中时刻）

### 启动命令

在项目根目录执行：

```bash
go run ./ cron
```

该命令会启动一个常驻进程，内部完成以下步骤：

1. **注册任务**：调用 `app/schedule/register.go` 中的 `Register` 函数，将所有业务定时任务加载到调度器
2. **输出任务清单**：打印所有已注册任务的摘要，便于运维确认
3. **启动调度**：为每个任务创建独立 goroutine 开始循环执行
4. **阻塞等待**：进程进入等待状态，直到收到退出信号

启动后终端输出类似：

```text
[OK] cron scheduler started
[OK]   overtime:detect          超时工单检测
  followup:generate       跟进任务生成
  followup:remind         跟进提醒
  wecom:retry             企微消息重试
  area:sync               行政区同步
```

### 停止调度器

向进程发送 `SIGINT`（`Ctrl+C`）或 `SIGTERM` 信号即可优雅停止：

```bash
# 开发环境直接 Ctrl+C
# 生产环境使用 supervisor/systemd 管理时可发送信号
kill -TERM <pid>
```

停止过程会：

1. 取消内部 context，通知所有任务 goroutine 退出
2. 等待所有正在执行的任务函数返回
3. 输出停止日志后进程退出

### 注册任务

所有定时任务统一在 [app/schedule/register.go](file:///www/code/workorder/app/schedule/register.go) 中声明，由 `bootstrap/app.go` 通过 `r.Schedules(appschedule.Register)` 挂载到调度器上。

```go
// app/schedule/register.go
package schedule

import "github.com/prismgo/framework/timer"

func Register(s *timer.Schedule) {
    s.Command("overtime:detect --take=100000").EveryFiveMinutes()
    s.Command("followup:generate").EveryTenMinutes()
    s.Command("followup:remind").EveryThirtyMinutes()
    s.Command("wecom:retry --take=2000").EveryFiveMinutes()
    s.Command("area:sync").Sundays().At("03:00")
}
```

新增定时任务时，只需在此文件中追加一行 `s.Command(...)` 或 `s.Call(...)` 即可，无需修改其他配置。

### 生产环境部署

建议使用 systemd 或 supervisor 管理调度器进程，确保进程异常退出后自动重启。

**systemd 示例配置**（`/etc/systemd/system/workorder-cron.service`）：

```ini
[Unit]
Description=WorkOrder Cron Scheduler
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/path/to/workorder
ExecStart=/usr/local/go/bin/go run ./ cron
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**supervisor 示例配置**：

```ini
[program:workorder-cron]
command=/usr/local/go/bin/go run ./ cron
directory=/path/to/workorder
autostart=true
autorestart=true
startsecs=5
stopwaitsecs=30
user=www
```

> **注意：** 调度器本身不提供守护进程化（daemonize）能力，生产环境应使用 systemd/supervisor 等进程管理工具。同一调度器不建议同时启动多个实例，除非所有任务都配置了 `WithoutOverlapping()` 且 cache store 使用共享后端。

## 配置

`github.com/prismgo/framework/timer` 本身不需要额外配置文件。调度器的行为由以下环境决定：

| 配置项 | 来源 | 说明 |
| --- | --- | --- |
| **时区** | `time.Local`（操作系统时区） | 所有日历调度（如 `DailyAt("18:30")`）均以系统本地时间计算命中时刻 |
| **调试日志** | `config.GetBool("app.debug", false)` | 设为 `true` 时，每次任务成功执行后会输出 `[schedule] task xxx done` 日志 |
| **缓存驱动** | `github.com/prismgo/framework/cache` 默认 store | `WithoutOverlapping()` 的防重叠锁依赖此缓存驱动。如需跨进程防重叠，请将默认 cache store 配置为 Redis 等共享后端 |
| **异常上报** | `github.com/prismgo/framework/exception` 容器绑定 | 任务返回 error 或 panic 时自动通过 `exception.Report` 上报；不绑定则静默忽略 |

调度器启动时建议输出任务清单，便于运维确认：

```go
logger.Infof("scheduled tasks:\n%s", s.Summary())
```

## 定义调度任务

### 通过命令签名注册

**方法签名：**

```go
func (s *Schedule) Command(signature string) *ScheduledTask
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `signature` | `string` | 命令签名，格式为 `"命令名 [参数...]"`，使用空白字符分割 |

**返回值：** `*ScheduledTask` — 可继续链式调用频率、名称等方法。

**用途：** 将已注册的 CLI 命令挂载到调度器。这是推荐方式，因为人工执行和定时执行使用同一入口，参数和逻辑都保持一致。

**前置条件：** 必须先通过 `SetResolver(...)` 注入命令解析器，否则 `panic`。

**解析规则：** 首个字段为命令名，后续字段原样作为 `args` 传给 resolver。在项目内使用 Console Kernel 时，命令会自动解析为已注册的 Handle 方法。

```go
// === 项目中最常用的方式（在 app/schedule/register.go 中配置） ===
func Register(s *timer.Schedule) {
    s.Command("overtime:detect --take=100000").EveryFiveMinutes()
    s.Command("followup:generate").EveryTenMinutes()
    s.Command("followup:remind").EveryThirtyMinutes()
    s.Command("area:sync").Sundays().At("03:00")
}
```

**错误行为：** 以下情况会在注册阶段 `panic`，属于启动期配置错误：

- 空签名 `""`
- 未设置 resolver
- resolver 返回错误（如命令未注册）

### 通过闭包注册

**方法签名：**

```go
func (s *Schedule) Call(fn func(ctx context.Context) error) *ScheduledTask
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `fn` | `func(context.Context) error` | 任务执行函数。接收的 `ctx` 会在调度器停止时被取消，长任务应监听 `ctx.Done()` 实现优雅退出 |

**返回值：** `*ScheduledTask` — 可继续链式调用频率、名称等方法。

**用途：** 任务没有对应 CLI 命令，或仅是当前进程内的后台维护逻辑时使用。

```go
s.Call(func(ctx context.Context) error {
    return rebuildDashboard(ctx)
}).EveryTenMinutes().Name("dashboard_rebuild").Description("重建工作台统计")
```

> **建议：** `Call` 不会自动设置名称和描述，建议显式链式调用 `Name(...)` 和 `Description(...)`，否则日志和 `Summary()` 中难以辨识。

## 调度频率

频率接口分为两大类：

- **固定间隔模式**：使用 `time.Ticker`，按 `time.Duration` 循环，启动后立即执行一次
- **日历调度模式**：基于秒、分、时、日、周、月、季、年约束计算下一次命中时间

### 固定间隔

**方法签名：**

```go
func (t *ScheduledTask) Every(d time.Duration) *ScheduledTask
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `d` | `time.Duration` | 执行间隔，必须 > 0，否则 `panic` |

**触发规则：** 调度器启动后立即执行一次，之后每隔 `d` 重复执行。

**适用场景：** 不需要对齐自然时间的短周期任务，如健康检查、内存刷新。

```go
s.Call(fn).Every(30 * time.Second)
s.Call(fn).Every(5 * time.Minute)
```

### 秒级调度

秒级接口适合高频后台任务。它们按每分钟内的固定秒点命中，不会在启动时立即执行。

| 方法 | 命中时刻（每分钟内） |
| --- | --- |
| `EverySecond()` | `0, 1, 2, ..., 59` 秒 |
| `EveryTwoSeconds()` | `0, 2, 4, ..., 58` 秒 |
| `EveryFiveSeconds()` | `0, 5, 10, ..., 55` 秒 |
| `EveryTenSeconds()` | `0, 10, 20, 30, 40, 50` 秒 |
| `EveryFifteenSeconds()` | `0, 15, 30, 45` 秒 |
| `EveryTwentySeconds()` | `0, 20, 40` 秒 |
| `EveryThirtySeconds()` | `0, 30` 秒 |

```go
s.Command("heartbeat:check").EverySecond()
s.Command("queue:poll").EveryTwoSeconds()
s.Command("metrics:flush").EveryTenSeconds()
```

> **注意：** 秒级任务容易产生高频数据库或外部 API 压力，请确认业务上确实需要。

### 分钟级调度

分钟级接口适合大多数后台巡检、补偿和批处理任务。按分钟边界触发，秒固定为 `0`。

| 方法 | 命中时刻（每小时） | 启动立即执行 | 常见用途 |
| --- | --- | --- | --- |
| `EveryMinute()` | `:00, :01, ..., :59` | 是 | 高频补偿、开发调试 |
| `EveryTwoMinutes()` | `:00, :02, ..., :58` | 是 | 短周期同步 |
| `EveryThreeMinutes()` | `:00, :03, ..., :57` | 否 | 较轻量巡检 |
| `EveryFourMinutes()` | `:00, :04, ..., :56` | 否 | 较轻量巡检 |
| `EveryFiveMinutes()` | `:00, :05, ..., :55` | 是 | 超时扫描、失败重试 |
| `EveryTenMinutes()` | `:00, :10, ..., :50` | 是 | 任务生成、汇总刷新 |
| `EveryFifteenMinutes()` | `:00, :15, :30, :45` | 是 | 定期提醒、批量同步 |
| `EveryThirtyMinutes()` | `:00, :30` | 是 | 低频提醒、状态归档 |

```go
s.Command("overtime:detect --take=100000").EveryFiveMinutes()
s.Command("followup:generate").EveryTenMinutes()
s.Command("followup:remind").EveryThirtyMinutes()
```

### 小时级调度

小时级接口用于按整点、指定分钟或固定小时步长执行任务。

| 方法 | 命中时刻 | 常见用途 |
| --- | --- | --- |
| `Hourly()` | 每小时 `:00` | 每小时数据归档 |
| `HourlyAt(offset)` | 每小时指定分钟 | 避开整点高峰 |
| `EveryOddHour(offset...)` | `01, 03, ..., 23` 时的指定分钟 | 资源错峰调度 |
| `EveryTwoHours(offset...)` | `00, 02, ..., 22` 时的指定分钟 | 双小时周期巡检 |
| `EveryThreeHours(offset...)` | `00, 03, ..., 21` 时的指定分钟 | 每三小时一次同步 |
| `EveryFourHours(offset...)` | `00, 04, ..., 20` 时的指定分钟 | 每四小时一次同步 |
| `EverySixHours(offset...)` | `00, 06, 12, 18` 时的指定分钟 | 每天四次批处理 |

**`offset` 参数支持以下类型：**

| 类型 | 示例 | 说明 |
| --- | --- | --- |
| `int` | `15` | 单个分钟值 |
| `string` | `"0,15,30,45"`, `"10-20"` | 逗号分隔列表或范围 |
| `[]int` | `[]int{5, 35}` | 整数切片 |
| `[]string` | `[]string{"0", "30"}` | 字符串切片 |

```go
s.Command("stats:archive").Hourly()          // 每小时整点
s.Command("stats:archive").HourlyAt(15)       // 每小时 xx:15
s.Command("stats:archive").HourlyAt("0,15,30,45") // 每小时 0、15、30、45 分
s.Command("sync:tenant").EveryThreeHours(30)  // 每三小时的 :30
s.Command("backup:compact").EverySixHours(5)  // 每天 00:05、06:05、12:05、18:05
```

### 每日调度

| 方法 | 参数 | 命中时刻 | 启动立即执行 |
| --- | --- | --- | --- |
| `Daily()` | — | 每天 `00:00:00` | 是 |
| `DailyAt(timeValue)` | `string`：`HH:MM` 或 `HH:MM:SS` | 每天指定时间 | 否 |
| `TwiceDaily(hours...)` | `...int`：小时列表，默认 `1, 13` | 每天指定小时 `:00` | 否 |
| `TwiceDailyAt(values...)` | `...int`：第一小时、第二小时、分钟偏移 | 每天两个指定时间点 | 否 |

#### `At(timeValue)` — 设置命中时间

**方法签名：**

```go
func (t *ScheduledTask) At(timeValue string) *ScheduledTask
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `timeValue` | `string` | 格式为 `HH:MM` 或 `HH:MM:SS`，非法时间会 `panic` |

`At` 只设置小时、分钟和秒，不会清除已设置的星期、月份、季度等日期约束。因此它通常与 `Weekdays()`、`Sundays()`、`DaysOfMonth()` 等组合使用。

```go
s.Command("billing:close").Daily()                 // 每天 00:00
s.Command("billing:close").DailyAt("18:30")         // 每天 18:30
s.Command("summary:send").TwiceDaily(9, 18)         // 每天 09:00 和 18:00
s.Command("summary:send").TwiceDailyAt(9, 18, 15)   // 每天 09:15 和 18:15
```

### 每周调度

| 方法 | 参数 | 命中时刻 |
| --- | --- | --- |
| `Weekly()` | — | 每周日 `00:00:00` |
| `WeeklyOn(dayOfWeek, timeValue...)` | `any` + `...string` | 每周指定星期和可选时间 |
| `Weekdays()` | — | 周一至周五（需配合 `At`） |
| `Weekends()` | — | 周六、周日（需配合 `At`） |
| `Mondays()` ~ `Sundays()` | — | 指定单天（需配合 `At`） |

#### `WeeklyOn(dayOfWeek, timeValue...)`

**方法签名：**

```go
func (t *ScheduledTask) WeeklyOn(dayOfWeek any, timeValue ...string) *ScheduledTask
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `dayOfWeek` | `any` | 星期值，支持 `time.Weekday`、`int`（0=周日）、`string`（如 `"mon"`、`"mon-wed,fri"`）、`[]int`、`[]string`、`[]time.Weekday` |
| `timeValue` | `...string` | 可选，格式 `HH:MM` 或 `HH:MM:SS`，默认 `"0:0"` |

#### `Days(days)` — 自定义星期

**方法签名：**

```go
func (t *ScheduledTask) Days(days any) *ScheduledTask
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `days` | `any` | 同 `WeeklyOn` 的 `dayOfWeek` 参数 |

`Days` 只设置星期约束，不设置具体时间。通常需要继续调用 `At(...)`。

```go
s.Command("area:sync").Sundays().At("03:00")              // 每周日 03:00
s.Command("report:weekly").WeeklyOn(time.Monday, "09:30") // 每周一 09:30
s.Command("report:weekly").WeeklyOn("mon,wed,fri", "09:30") // 周一三五 09:30
s.Command("notify:pending").Weekdays().At("18:30")         // 工作日 18:30
s.Command("report:weekend").Weekends().At("10:00")         // 周末 10:00
s.Command("report:custom").Days([]int{1, 3, 5}).At("09:00") // 周一三五 09:00
s.Command("report:custom").Days("mon-wed,fri").At("09:00")  // 等价写法
```

### 每月调度

| 方法 | 参数 | 命中时刻 |
| --- | --- | --- |
| `Monthly()` | — | 每月 1 日 `00:00:00` |
| `MonthlyOn(dayOfMonth, timeValue...)` | `int` + `...string` | 每月指定日期和可选时间 |
| `TwiceMonthly(args...)` | `...any` | 每月两个日期和可选时间 |
| `LastDayOfMonth(timeValue...)` | `...string` | 每月最后一天 |
| `DaysOfMonth(days...)` | `...int` | 每月指定日期（需配合 `At`） |

#### `MonthlyOn(dayOfMonth, timeValue...)`

**方法签名：**

```go
func (t *ScheduledTask) MonthlyOn(dayOfMonth int, timeValue ...string) *ScheduledTask
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `dayOfMonth` | `int` | 日期，范围 `1-31` |
| `timeValue` | `...string` | 可选，格式 `HH:MM` 或 `HH:MM:SS`，默认 `"0:0"` |

> 如果设置为 `31`，没有 31 日的月份不会执行。

#### `TwiceMonthly(args...)`

**方法签名：**

```go
func (t *ScheduledTask) TwiceMonthly(args ...any) *ScheduledTask
```

**参数说明：**

| 位置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `args[0]` | `any`（`int` 或 `string`） | `1` | 第一个日期 |
| `args[1]` | `any`（`int` 或 `string`） | `16` | 第二个日期 |
| `args[2]` | `string` | `"0:0"` | 时间字符串 |

#### `LastDayOfMonth(timeValue...)`

**方法签名：**

```go
func (t *ScheduledTask) LastDayOfMonth(timeValue ...string) *ScheduledTask
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `timeValue` | `...string` | 可选，格式 `HH:MM` 或 `HH:MM:SS`，默认 `"0:0"` |

自动适配 28、29、30、31 天的月份，适合月末结算、归档任务。

#### `DaysOfMonth(days...)`

**方法签名：**

```go
func (t *ScheduledTask) DaysOfMonth(days ...int) *ScheduledTask
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `days` | `...int` | 至少一个日期值，范围 `1-31` |

只设置日期约束，通常配合 `At(...)` 设置具体时间。

```go
s.Command("statement:close").Monthly()                    // 每月 1 日 00:00
s.Command("statement:close").MonthlyOn(15, "08:30")       // 每月 15 日 08:30
s.Command("invoice:remind").TwiceMonthly(1, 16, "10:00")  // 每月 1 日和 16 日 10:00
s.Command("statement:close").LastDayOfMonth("23:55")      // 每月最后一天 23:55
s.Command("invoice:remind").DaysOfMonth(1, 15, 28).At("09:00") // 每月 1、15、28 日 09:00
```

### 季度 / 年度调度

| 方法 | 参数 | 命中时刻 |
| --- | --- | --- |
| `Quarterly()` | — | 每季度第 1 天 `00:00:00` |
| `QuarterlyOn(args...)` | `...any` | 每季度第 N 天和可选时间 |
| `Yearly()` | — | 每年 1 月 1 日 `00:00:00` |
| `YearlyOn(args...)` | `...any` | 每年指定月、日、时间 |

#### `QuarterlyOn(args...)`

**方法签名：**

```go
func (t *ScheduledTask) QuarterlyOn(args ...any) *ScheduledTask
```

**参数说明：**

| 位置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `args[0]` | `any`（`int` 或 `string`） | `1` | 季度第几天，范围 `1-92` |
| `args[1]` | `string` | `"0:0"` | 时间字符串 |

#### `YearlyOn(args...)`

**方法签名：**

```go
func (t *ScheduledTask) YearlyOn(args ...any) *ScheduledTask
```

**参数说明：**

| 位置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `args[0]` | `any`（`int` 或 `string`） | `1` | 月份，范围 `1-12` |
| `args[1]` | `any` | `1` | 日期：`int`（1-31）或 `"last"`/`"L"` 表示最后一天 |
| `args[2]` | `string` | `"0:0"` | 时间字符串 |

```go
s.Command("finance:quarterly-close").Quarterly()           // 每季度第一天 00:00
s.Command("finance:quarterly-close").QuarterlyOn(45, "10:00") // 每季度第 45 天 10:00
s.Command("stats:yearly-reset").Yearly()                   // 每年 1 月 1 日 00:00
s.Command("stats:yearly-reset").YearlyOn(12, 31, "23:59")  // 每年 12 月 31 日 23:59
s.Command("stats:yearly-reset").YearlyOn(12, "last", "23:59") // 每年 12 月最后一天 23:59
```

## 防重叠执行

**方法签名：**

```go
func (t *ScheduledTask) WithoutOverlapping(expiresAt ...int) *ScheduledTask
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `expiresAt` | `...int` | `1440` | 锁过期时间，单位**分钟**。最多传 1 个；`<=0` 或传多个会 `panic` |

**用途：** 防止同一任务在上一次执行尚未结束时再次运行。对齐 Laravel Scheduler 的 `withoutOverlapping()` 行为。

**工作原理：**

1. 每次执行前通过 `github.com/prismgo/framework/cache` 默认 store 尝试获取分布式锁
2. 锁 key 基于任务名称生成：`Command` 注册的使用命令名，`Call` 注册的需显式设置 `Name` 确保多进程下稳定
3. 如果上一次任务仍持有锁，本次触发直接跳过，不等待也不调用任务函数
4. 任务执行结束后自动释放锁
5. `expiresAt` 用于防止任务异常退出导致锁永久持有的兜底过期时间

```go
s.Command("emails:send").EveryMinute().WithoutOverlapping()      // 默认 1440 分钟过期
s.Command("emails:send").EveryMinute().WithoutOverlapping(10)    // 10 分钟过期
s.Call(fn).Name("dashboard_rebuild").EveryTenMinutes().WithoutOverlapping()
```

> **注意：** 跨进程防重叠需要将 `github.com/prismgo/framework/cache` 默认 store 配置为 Redis 等共享后端；使用内存驱动时仅对当前进程有效。

## 启动与停止调度器

### `Start(ctx)` — 启动调度

**方法签名：**

```go
func (s *Schedule) Start(ctx context.Context)
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `ctx` | `context.Context` | 控制调度器生命周期。`ctx` 取消后所有任务循环退出 |

**行为：**

- 为每个已注册任务启动独立 goroutine
- 不阻塞当前 goroutine
- 只启动调用时已注册的任务，建议在启动前完成所有任务注册

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

s.Start(ctx)
```

### `Stop()` — 停止调度

**方法签名：**

```go
func (s *Schedule) Stop()
```

**行为：**

- 触发内部 cancel，通知所有任务 goroutine 退出
- 阻塞等待所有任务 goroutine 返回后才返回
- 不会强行杀死正在执行的任务函数
- 长任务应主动监听 `ctx.Done()` 实现优雅退出

```go
s.Start(ctx)
defer s.Stop()
```

## 查看已注册任务

**方法签名：**

```go
func (s *Schedule) Summary() string
```

**返回值：** 已注册任务的格式化摘要字符串，每行一个任务。

**用途：** 在调度器启动时输出任务清单，排查配置是否正确。

```go
logger.Infof("scheduled tasks:\n%s", s.Summary())
```

输出形态类似：

```text
  overtime:detect          超时工单检测
  area:sync                行政区同步
```

- `Command` 注册的任务会自动使用 resolver 返回的描述
- `Call` 注册的任务建议显式设置 `Name(...)` 和 `Description(...)`

## 异常处理

调度器内置了完善的异常处理机制，确保单个任务的错误不会影响其他任务或调度器本身。

### 任务返回 error

- 通过 `github.com/prismgo/framework/exception` 的 `Report` 上报，携带 `task`、`status`（500）、`component`（`"cron"`）、`duration_ms` 等上下文
- **不会**停止调度器，不影响其他任务
- 下一轮命中时间到达后，任务仍会继续执行

### 任务 panic

- goroutine 内通过 `github.com/prismgo/framework/routine` 捕获 panic
- 同样通过 `exception.Report` 上报
- 任务循环继续，后续触发不受影响

### 任务成功执行

- 仅在 `app.debug=true` 时输出 `[schedule] task xxx done` 日志
- 不触发异常上报

### 异常上报依赖

处理 error 和 panic 上报依赖 `github.com/prismgo/framework/exception` 包的 Reporter 绑定。测试环境中可注入自定义 Reporter 验证行为，生产环境应确保 Reporter 已正确配置。

## 执行模型

### 两种调度模式

| 模式 | 驱动方式 | 触发规则 | 适用场景 |
| --- | --- | --- | --- |
| **固定间隔** | `time.Ticker` | 启动后立即执行一次，之后按间隔重复 | 健康检查、短周期轮询 |
| **日历调度** | `time.Timer` + 命中计算 | 计算下一次命中时间，到点执行 | 日报、周报、月度结算 |

### 启动时立即执行

以下日历方法在调度器启动后会先立即执行一次（兼容历史行为）：

- `EveryMinute()`、`EveryTwoMinutes()`、`EveryFiveMinutes()`、`EveryTenMinutes()`
- `EveryFifteenMinutes()`、`EveryThirtyMinutes()`
- `Hourly()`、`Daily()`

其他日历方法严格等待下一次命中时间。例如 `DailyAt("18:30")` 不会在启动时立即执行，而是等待当天或下一天的 18:30。

### 并发与串行

- 不同任务在各自 goroutine 中**并行**执行，互不影响
- 同一任务在自身 goroutine 中**串行**执行：前一次执行未结束时，后一次命中不会启动新副本（天然防并发；如需跨进程控制，使用 `WithoutOverlapping()`）

## 参数解析规则

### 时间字符串

以下方法接受时间字符串参数，格式为 `HH:MM` 或 `HH:MM:SS`：

- `At(timeValue)`
- `DailyAt(timeValue)`
- `WeeklyOn(dayOfWeek, timeValue...)`
- `MonthlyOn(dayOfMonth, timeValue...)`
- `QuarterlyOn(args...)`
- `YearlyOn(args...)`

非法时间（如 `"25:00"`、`"12:99"`）会在注册阶段 `panic`，确保启动期尽早暴露配置错误。

### 分钟和小时列表

`HourlyAt`、`EveryTwoHours`、`EveryThreeHours` 等方法的偏移参数支持以下格式：

```go
s.Command("job:a").HourlyAt(15)                  // int: 单个值
s.Command("job:b").HourlyAt("0,15,30,45")        // string: 逗号分隔
s.Command("job:c").HourlyAt("10-20")             // string: 范围，自动展开
s.Command("job:d").HourlyAt([]int{5, 35})         // []int: 切片
s.Command("job:e").HourlyAt([]string{"0", "30"})  // []string: 字符串切片
```

范围会展开为连续值，并自动排序、去重。

### 星期值

星期解析支持数字和英文缩写：

| 数字 | 英文（不区分大小写） | 含义 |
| --- | --- | --- |
| `0` | `sun`, `sunday` | 周日 |
| `1` | `mon`, `monday` | 周一 |
| `2` | `tue`, `tues`, `tuesday` | 周二 |
| `3` | `wed`, `wednesday` | 周三 |
| `4` | `thu`, `thur`, `thurs`, `thursday` | 周四 |
| `5` | `fri`, `friday` | 周五 |
| `6` | `sat`, `saturday` | 周六 |

字符串支持逗号分隔和连字符范围：

```go
s.Command("job:a").Days("mon-wed,fri").At("09:00")  // 周一至周三 + 周五
s.Command("job:b").WeeklyOn("mon,wed,fri", "10:00")  // 周一、三、五
s.Command("job:c").WeeklyOn([]int{1, 3, 5}, "10:00") // 等价写法
```

## Timer 基础类型

```go
type Timer struct {
    Interval time.Duration
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Interval` | `time.Duration` | 任务重复执行的间隔。`Interval == 0` 表示不重复（仅执行一次） |

`Timer` 是一个轻量基础类型，仅描述执行间隔信息。它供旧代码或需要嵌入定时信息的结构体使用，不负责注册、启动或停止任务。

**新代码应优先使用 `Schedule` 和 `ScheduledTask`。**

### ResolvedCommand

```go
type ResolvedCommand struct {
    Fn          func(ctx context.Context) error
    Description string
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Fn` | `func(context.Context) error` | 调度器最终执行的函数 |
| `Description` | `string` | 任务说明，出现在 `Summary()` 输出中 |

`ResolvedCommand` 是命令系统与调度器之间的桥接结果，让 `github.com/prismgo/framework/timer` 不依赖具体命令框架。调度器只关心"拿到一个可执行函数"，命令注册、参数解析、依赖注入由外层 resolver 完成。

### CommandResolver

```go
type CommandResolver func(name string, args []string) (ResolvedCommand, error)
```

**参数说明：**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 命令名称 |
| `args` | `[]string` | 命令参数列表 |

**返回值：** `ResolvedCommand` — 可执行函数与描述；`error` — 命令未注册等错误。

`CommandResolver` 由外部注入到调度器中。在项目内，Console Kernel 自动完成注入，开发者无需手动设置。

手动设置示例：

```go
s.SetResolver(func(name string, args []string) (timer.ResolvedCommand, error) {
    cmd, err := kernel.Resolve(name, args)
    if err != nil {
        return timer.ResolvedCommand{}, err
    }
    return timer.ResolvedCommand{
        Fn:          cmd.Run,
        Description: cmd.Description,
    }, nil
})
```

### NewSchedule

**方法签名：**

```go
func NewSchedule() *Schedule
```

创建一个空的调度器实例。在项目内，Console Kernel 已内置调度器，通过 `kernel.Schedule()` 获取，一般不需要手动创建。

### ScheduledTask 元信息方法

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `Name(name)` | `func (t *ScheduledTask) Name(name string) *ScheduledTask` | 设置任务名称，影响日志和 `Summary()` |
| `Description(desc)` | `func (t *ScheduledTask) Description(desc string) *ScheduledTask` | 设置任务描述，影响 `Summary()` |

```go
s.Call(fn).EveryMinute().Name("tenant_sync").Description("同步租户缓存")
```

`Command` 注册的任务会自动从 resolver 获取名称和描述；`Call` 注册的任务建议手动设置两者。

### 默认配置

`ScheduledTask` 的默认配置：

- 默认模式：固定间隔模式
- 默认间隔：`1 * time.Minute`
- 默认启动后立即执行一次

因此如果只写 `s.Call(fn).Name("demo")`，它会在 `Start(ctx)` 后立即执行一次，之后每分钟执行一次。实际业务中建议**显式指定频率**，让调度意图更清楚。

## 常见用法示例

### 添加新的定时任务

在 [app/schedule/register.go](file:///www/code/workorder/app/schedule/register.go) 中追加一行即可，详见[启动调度器 → 注册任务](#注册任务)。

### 独立使用调度器（不走 Console Kernel）

当你需要在其他后台进程或测试中独立使用调度器时，手动创建 `Schedule` 实例并注入命令解析器：

```go
s := timer.NewSchedule()

// 方式一：注入自定义命令解析器
s.SetResolver(func(name string, args []string) (timer.ResolvedCommand, error) {
    return timer.ResolvedCommand{
        Description: "同步客户缓存",
        Fn: func(ctx context.Context) error {
            return syncCustomers(ctx, args)
        },
    }, nil
})
s.Command("customer:sync --take=500").EveryFiveMinutes()

// 方式二：直接注册闭包
s.Call(func(ctx context.Context) error {
    return refreshReportCache(ctx)
}).DailyAt("02:30").Name("report_cache").Description("刷新报表缓存")

ctx, cancel := context.WithCancel(context.Background())
defer cancel()

s.Start(ctx)
defer s.Stop()
```

### 选择建议

| 场景 | 推荐方法 |
| --- | --- |
| 任务已有 CLI 命令入口 | `Command(...)` |
| 任务仅是进程内部维护逻辑 | `Call(...)` |
| 只关心间隔，不关心整点 | `Every(d)` |
| 需要按自然时间命中 | `DailyAt(...)`、`WeeklyOn(...)` 等日历接口 |
| 需要限制星期后再设置时间 | 先调日期约束（如 `Weekdays()`），再调 `At(...)` |
| 需要启动后立即补跑一次 | 使用保留立即执行语义的方法，或 `Every(d)` |

### 启动时输出任务摘要

```go
logger.Infof("scheduled tasks:\n%s", s.Summary())
```
