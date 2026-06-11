# Task Scheduler

- [Introduction](#introduction)
- [Running The Scheduler](#running-the-scheduler)
- [Configuration](#configuration)
- [Defining Scheduled Tasks](#defining-scheduled-tasks)
  - [Registering Commands By Signature](#registering-commands-by-signature)
  - [Registering Closures](#registering-closures)
- [Schedule Frequencies](#schedule-frequencies)
  - [Fixed Intervals](#fixed-intervals)
  - [Second-Level Scheduling](#second-level-scheduling)
  - [Minute-Level Scheduling](#minute-level-scheduling)
  - [Hourly Scheduling](#hourly-scheduling)
  - [Daily Scheduling](#daily-scheduling)
  - [Weekly Scheduling](#weekly-scheduling)
  - [Monthly Scheduling](#monthly-scheduling)
  - [Quarterly / Yearly Scheduling](#quarterly--yearly-scheduling)
- [Preventing Overlapping Runs](#preventing-overlapping-runs)
- [Starting and Stopping The Scheduler](#starting-and-stopping-the-scheduler)
- [Inspecting Registered Tasks](#inspecting-registered-tasks)
- [Exception Handling](#exception-handling)
- [Execution Model](#execution-model)
- [Parameter Parsing Rules](#parameter-parsing-rules)
  - [Time Strings](#time-strings)
  - [Minute and Hour Lists](#minute-and-hour-lists)
  - [Weekday Values](#weekday-values)
- [Timer Base Types](#timer-base-types)
- [Common Usage Examples](#common-usage-examples)
- [Verification](#verification)

## Introduction

`github.com/prismgo/framework/timer` provides a Laravel Scheduler-style task scheduling system. Developers can register project commands or Go closures as recurring tasks through a fluent API, and the scheduler runs them automatically in the background.

**Common use cases:**

- Minute-level checks: overdue work order detection, failed message retries
- Daily batch jobs: reconciliation, order closing, daily report generation
- Weekly / monthly settlement: report archiving, regional data synchronization
- Short-cycle background callbacks: memory refresh, health checks, metric collection

**Core design:**

- Reuses the same command definitions as the project command system, avoiding duplicated business logic
- Expresses schedule frequencies through a fluent API, keeping registration code close to business language
- Supports both fixed intervals and calendar times for different types of background work

## Running The Scheduler

### Requirements

The scheduler runs as a long-lived process. Make sure that:

- Go is installed, or the project has been compiled into a binary
- Dependent services such as databases and caches are reachable
- The operating system timezone is configured correctly, because calendar schedules use it to determine hit times

### Start Command

Run this command from the project root:

```bash
go run ./ cron
```

This starts a long-lived process that performs the following steps internally:

1. **Register tasks**: calls the `Register` function in `app/schedule/register.go` and loads all business scheduled tasks into the scheduler
2. **Print the task list**: prints a summary of all registered tasks for operations verification
3. **Start scheduling**: creates an independent goroutine for each task and starts its execution loop
4. **Wait for shutdown**: blocks until an exit signal is received

After startup, terminal output is similar to:

```text
[OK] cron scheduler started
[OK]   overtime:detect          Overdue work order detection
  followup:generate       Follow-up task generation
  followup:remind         Follow-up reminder
  wecom:retry             WeCom message retry
  area:sync               Administrative area sync
```

### Stopping The Scheduler

Send `SIGINT` (`Ctrl+C`) or `SIGTERM` to gracefully stop the process:

```bash
# In development, press Ctrl+C directly
# In production, send a signal through supervisor/systemd management
kill -TERM <pid>
```

During shutdown, the scheduler:

1. Cancels the internal context and notifies all task goroutines to exit
2. Waits for all currently running task functions to return
3. Prints the shutdown log and exits the process

### Registering Tasks

All scheduled tasks are declared in [app/schedule/register.go](file:///www/code/workorder/app/schedule/register.go). `bootstrap/app.go` mounts them into the scheduler through `r.Schedules(appschedule.Register)`.

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

To add a new scheduled task, append one `s.Command(...)` or `s.Call(...)` line in this file. No other configuration changes are required.

### Production Deployment

Use systemd or supervisor to manage the scheduler process so it restarts automatically after an unexpected exit.

**Example systemd configuration** (`/etc/systemd/system/workorder-cron.service`):

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

**Example supervisor configuration:**

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

> **Note:** The scheduler itself does not daemonize. In production, use a process manager such as systemd or supervisor. Running multiple instances of the same scheduler is not recommended unless all tasks use `WithoutOverlapping()` and the cache store uses a shared backend.

## Configuration

`github.com/prismgo/framework/timer` does not require an additional configuration file. Scheduler behavior is controlled by the following environment:

| Configuration | Source | Description |
| --- | --- | --- |
| **Timezone** | `time.Local` (operating system timezone) | All calendar schedules, such as `DailyAt("18:30")`, calculate hit times using the system local time |
| **Debug logs** | `config.GetBool("app.debug", false)` | When set to `true`, a `[schedule] task xxx done` log is printed after each successful task run |
| **Cache driver** | Default `github.com/prismgo/framework/cache` store | The overlap-prevention lock used by `WithoutOverlapping()` depends on this cache driver. For cross-process overlap prevention, configure the default cache store as a shared backend such as Redis |
| **Exception reporting** | `github.com/prismgo/framework/exception` container binding | When a task returns an error or panics, it is reported through `exception.Report`; if no reporter is bound, it is ignored silently |

It is recommended to print the task list when the scheduler starts, so operations can verify the active configuration:

```go
logger.Infof("scheduled tasks:\n%s", s.Summary())
```

## Defining Scheduled Tasks

### Registering Commands By Signature

**Method signature:**

```go
func (s *Schedule) Command(signature string) *ScheduledTask
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `signature` | `string` | Command signature in the format `"command-name [arguments...]"`, split by whitespace |

**Return value:** `*ScheduledTask` - supports further fluent calls for frequency, name, and other metadata.

**Purpose:** Mounts a registered CLI command into the scheduler. This is the recommended approach because manual execution and scheduled execution use the same entry point, parameters, and logic.

**Prerequisite:** A command resolver must be injected through `SetResolver(...)` first, otherwise the method panics.

**Parsing rules:** The first field is the command name. Remaining fields are passed as `args` to the resolver as-is. When using the Console Kernel inside a project, commands are automatically resolved to registered `Handle` methods.

```go
// === Most common project usage, configured in app/schedule/register.go ===
func Register(s *timer.Schedule) {
    s.Command("overtime:detect --take=100000").EveryFiveMinutes()
    s.Command("followup:generate").EveryTenMinutes()
    s.Command("followup:remind").EveryThirtyMinutes()
    s.Command("area:sync").Sundays().At("03:00")
}
```

**Error behavior:** The following cases panic during registration and are treated as startup configuration errors:

- Empty signature `""`
- Resolver not configured
- Resolver returns an error, such as an unregistered command

### Registering Closures

**Method signature:**

```go
func (s *Schedule) Call(fn func(ctx context.Context) error) *ScheduledTask
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `fn` | `func(context.Context) error` | Task function. The received `ctx` is cancelled when the scheduler stops; long-running tasks should listen to `ctx.Done()` for graceful shutdown |

**Return value:** `*ScheduledTask` - supports further fluent calls for frequency, name, and other metadata.

**Purpose:** Use this when the task has no corresponding CLI command, or when it is only in-process background maintenance logic.

```go
s.Call(func(ctx context.Context) error {
    return rebuildDashboard(ctx)
}).EveryTenMinutes().Name("dashboard_rebuild").Description("Rebuild dashboard statistics")
```

> **Recommendation:** `Call` does not automatically set a name or description. Explicitly chain `Name(...)` and `Description(...)`; otherwise logs and `Summary()` output are hard to identify.

## Schedule Frequencies

Frequency APIs fall into two main categories:

- **Fixed interval mode**: uses `time.Ticker`, loops by `time.Duration`, and runs once immediately after startup
- **Calendar schedule mode**: calculates the next hit time from second, minute, hour, day, weekday, month, quarter, and year constraints

### Fixed Intervals

**Method signature:**

```go
func (t *ScheduledTask) Every(d time.Duration) *ScheduledTask
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `d` | `time.Duration` | Execution interval. Must be greater than `0`, otherwise the method panics |

**Trigger rule:** Runs once immediately after the scheduler starts, then repeats every `d`.

**Use cases:** Short-cycle tasks that do not need to align with natural time, such as health checks and memory refreshes.

```go
s.Call(fn).Every(30 * time.Second)
s.Call(fn).Every(5 * time.Minute)
```

### Second-Level Scheduling

Second-level APIs are intended for high-frequency background tasks. They hit fixed second positions within each minute and do not run immediately on startup.

| Method | Hit times within each minute |
| --- | --- |
| `EverySecond()` | seconds `0, 1, 2, ..., 59` |
| `EveryTwoSeconds()` | seconds `0, 2, 4, ..., 58` |
| `EveryFiveSeconds()` | seconds `0, 5, 10, ..., 55` |
| `EveryTenSeconds()` | seconds `0, 10, 20, 30, 40, 50` |
| `EveryFifteenSeconds()` | seconds `0, 15, 30, 45` |
| `EveryTwentySeconds()` | seconds `0, 20, 40` |
| `EveryThirtySeconds()` | seconds `0, 30` |

```go
s.Command("heartbeat:check").EverySecond()
s.Command("queue:poll").EveryTwoSeconds()
s.Command("metrics:flush").EveryTenSeconds()
```

> **Note:** Second-level tasks can create frequent database or external API pressure. Confirm that the business case truly requires this cadence.

### Minute-Level Scheduling

Minute-level APIs fit most background inspection, compensation, and batch jobs. They trigger on minute boundaries with seconds fixed at `0`.

| Method | Hit times within each hour | Runs immediately on startup | Common use |
| --- | --- | --- | --- |
| `EveryMinute()` | `:00, :01, ..., :59` | Yes | High-frequency compensation, development debugging |
| `EveryTwoMinutes()` | `:00, :02, ..., :58` | Yes | Short-cycle synchronization |
| `EveryThreeMinutes()` | `:00, :03, ..., :57` | No | Lightweight inspection |
| `EveryFourMinutes()` | `:00, :04, ..., :56` | No | Lightweight inspection |
| `EveryFiveMinutes()` | `:00, :05, ..., :55` | Yes | Timeout scans, failed retries |
| `EveryTenMinutes()` | `:00, :10, ..., :50` | Yes | Task generation, summary refresh |
| `EveryFifteenMinutes()` | `:00, :15, :30, :45` | Yes | Periodic reminders, batch sync |
| `EveryThirtyMinutes()` | `:00, :30` | Yes | Low-frequency reminders, status archiving |

```go
s.Command("overtime:detect --take=100000").EveryFiveMinutes()
s.Command("followup:generate").EveryTenMinutes()
s.Command("followup:remind").EveryThirtyMinutes()
```

### Hourly Scheduling

Hourly APIs run tasks on the hour, at specified minutes, or with a fixed hour step.

| Method | Hit time | Common use |
| --- | --- | --- |
| `Hourly()` | Every hour at `:00` | Hourly data archiving |
| `HourlyAt(offset)` | Specified minute each hour | Avoiding top-of-hour peaks |
| `EveryOddHour(offset...)` | Specified minutes during hours `01, 03, ..., 23` | Off-peak resource scheduling |
| `EveryTwoHours(offset...)` | Specified minutes during hours `00, 02, ..., 22` | Two-hour inspection cycle |
| `EveryThreeHours(offset...)` | Specified minutes during hours `00, 03, ..., 21` | Synchronization every three hours |
| `EveryFourHours(offset...)` | Specified minutes during hours `00, 04, ..., 20` | Synchronization every four hours |
| `EverySixHours(offset...)` | Specified minutes during hours `00, 06, 12, 18` | Four daily batch runs |

**The `offset` parameter supports these types:**

| Type | Example | Description |
| --- | --- | --- |
| `int` | `15` | Single minute value |
| `string` | `"0,15,30,45"`, `"10-20"` | Comma-separated list or range |
| `[]int` | `[]int{5, 35}` | Integer slice |
| `[]string` | `[]string{"0", "30"}` | String slice |

```go
s.Command("stats:archive").Hourly()          // Every hour on the hour
s.Command("stats:archive").HourlyAt(15)       // Every hour at xx:15
s.Command("stats:archive").HourlyAt("0,15,30,45") // Every hour at minutes 0, 15, 30, and 45
s.Command("sync:tenant").EveryThreeHours(30)  // Every three hours at :30
s.Command("backup:compact").EverySixHours(5)  // Daily at 00:05, 06:05, 12:05, and 18:05
```

### Daily Scheduling

| Method | Parameters | Hit time | Runs immediately on startup |
| --- | --- | --- | --- |
| `Daily()` | - | Every day at `00:00:00` | Yes |
| `DailyAt(timeValue)` | `string`: `HH:MM` or `HH:MM:SS` | Specified time every day | No |
| `TwiceDaily(hours...)` | `...int`: hour list, default `1, 13` | Specified hours every day at `:00` | No |
| `TwiceDailyAt(values...)` | `...int`: first hour, second hour, minute offset | Two specified times each day | No |

#### `At(timeValue)` - Set The Hit Time

**Method signature:**

```go
func (t *ScheduledTask) At(timeValue string) *ScheduledTask
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `timeValue` | `string` | Format `HH:MM` or `HH:MM:SS`; invalid times panic |

`At` only sets hour, minute, and second. It does not clear existing weekday, month, quarter, or other date constraints. It is usually combined with `Weekdays()`, `Sundays()`, `DaysOfMonth()`, and similar methods.

```go
s.Command("billing:close").Daily()                 // Every day at 00:00
s.Command("billing:close").DailyAt("18:30")         // Every day at 18:30
s.Command("summary:send").TwiceDaily(9, 18)         // Every day at 09:00 and 18:00
s.Command("summary:send").TwiceDailyAt(9, 18, 15)   // Every day at 09:15 and 18:15
```

### Weekly Scheduling

| Method | Parameters | Hit time |
| --- | --- | --- |
| `Weekly()` | - | Every Sunday at `00:00:00` |
| `WeeklyOn(dayOfWeek, timeValue...)` | `any` + `...string` | Specified weekday and optional time |
| `Weekdays()` | - | Monday through Friday; use with `At` |
| `Weekends()` | - | Saturday and Sunday; use with `At` |
| `Mondays()` ~ `Sundays()` | - | One specified weekday; use with `At` |

#### `WeeklyOn(dayOfWeek, timeValue...)`

**Method signature:**

```go
func (t *ScheduledTask) WeeklyOn(dayOfWeek any, timeValue ...string) *ScheduledTask
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `dayOfWeek` | `any` | Weekday value. Supports `time.Weekday`, `int` (`0` = Sunday), `string` such as `"mon"` or `"mon-wed,fri"`, `[]int`, `[]string`, and `[]time.Weekday` |
| `timeValue` | `...string` | Optional. Format `HH:MM` or `HH:MM:SS`; defaults to `"0:0"` |

#### `Days(days)` - Custom Weekdays

**Method signature:**

```go
func (t *ScheduledTask) Days(days any) *ScheduledTask
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `days` | `any` | Same as the `dayOfWeek` parameter of `WeeklyOn` |

`Days` only sets the weekday constraint. It usually needs a subsequent `At(...)` call.

```go
s.Command("area:sync").Sundays().At("03:00")              // Every Sunday at 03:00
s.Command("report:weekly").WeeklyOn(time.Monday, "09:30") // Every Monday at 09:30
s.Command("report:weekly").WeeklyOn("mon,wed,fri", "09:30") // Monday, Wednesday, and Friday at 09:30
s.Command("notify:pending").Weekdays().At("18:30")         // Weekdays at 18:30
s.Command("report:weekend").Weekends().At("10:00")         // Weekends at 10:00
s.Command("report:custom").Days([]int{1, 3, 5}).At("09:00") // Monday, Wednesday, and Friday at 09:00
s.Command("report:custom").Days("mon-wed,fri").At("09:00")  // Equivalent form
```

### Monthly Scheduling

| Method | Parameters | Hit time |
| --- | --- | --- |
| `Monthly()` | - | First day of every month at `00:00:00` |
| `MonthlyOn(dayOfMonth, timeValue...)` | `int` + `...string` | Specified day of month and optional time |
| `TwiceMonthly(args...)` | `...any` | Two days per month and optional time |
| `LastDayOfMonth(timeValue...)` | `...string` | Last day of every month |
| `DaysOfMonth(days...)` | `...int` | Specified days of month; use with `At` |

#### `MonthlyOn(dayOfMonth, timeValue...)`

**Method signature:**

```go
func (t *ScheduledTask) MonthlyOn(dayOfMonth int, timeValue ...string) *ScheduledTask
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `dayOfMonth` | `int` | Day of month, range `1-31` |
| `timeValue` | `...string` | Optional. Format `HH:MM` or `HH:MM:SS`; defaults to `"0:0"` |

> If set to `31`, months without a 31st day do not run the task.

#### `TwiceMonthly(args...)`

**Method signature:**

```go
func (t *ScheduledTask) TwiceMonthly(args ...any) *ScheduledTask
```

**Parameters:**

| Position | Type | Default | Description |
| --- | --- | --- | --- |
| `args[0]` | `any` (`int` or `string`) | `1` | First day of month |
| `args[1]` | `any` (`int` or `string`) | `16` | Second day of month |
| `args[2]` | `string` | `"0:0"` | Time string |

#### `LastDayOfMonth(timeValue...)`

**Method signature:**

```go
func (t *ScheduledTask) LastDayOfMonth(timeValue ...string) *ScheduledTask
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `timeValue` | `...string` | Optional. Format `HH:MM` or `HH:MM:SS`; defaults to `"0:0"` |

Automatically adapts to months with 28, 29, 30, or 31 days. It is suitable for month-end settlement and archive jobs.

#### `DaysOfMonth(days...)`

**Method signature:**

```go
func (t *ScheduledTask) DaysOfMonth(days ...int) *ScheduledTask
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `days` | `...int` | At least one day value, range `1-31` |

Only sets the day-of-month constraint. Usually used with `At(...)` to set the exact time.

```go
s.Command("statement:close").Monthly()                    // First day of each month at 00:00
s.Command("statement:close").MonthlyOn(15, "08:30")       // 15th day of each month at 08:30
s.Command("invoice:remind").TwiceMonthly(1, 16, "10:00")  // 1st and 16th day of each month at 10:00
s.Command("statement:close").LastDayOfMonth("23:55")      // Last day of each month at 23:55
s.Command("invoice:remind").DaysOfMonth(1, 15, 28).At("09:00") // 1st, 15th, and 28th day of each month at 09:00
```

### Quarterly / Yearly Scheduling

| Method | Parameters | Hit time |
| --- | --- | --- |
| `Quarterly()` | - | First day of each quarter at `00:00:00` |
| `QuarterlyOn(args...)` | `...any` | Nth day of each quarter and optional time |
| `Yearly()` | - | January 1 every year at `00:00:00` |
| `YearlyOn(args...)` | `...any` | Specified month, day, and time each year |

#### `QuarterlyOn(args...)`

**Method signature:**

```go
func (t *ScheduledTask) QuarterlyOn(args ...any) *ScheduledTask
```

**Parameters:**

| Position | Type | Default | Description |
| --- | --- | --- | --- |
| `args[0]` | `any` (`int` or `string`) | `1` | Day number within the quarter, range `1-92` |
| `args[1]` | `string` | `"0:0"` | Time string |

#### `YearlyOn(args...)`

**Method signature:**

```go
func (t *ScheduledTask) YearlyOn(args ...any) *ScheduledTask
```

**Parameters:**

| Position | Type | Default | Description |
| --- | --- | --- | --- |
| `args[0]` | `any` (`int` or `string`) | `1` | Month, range `1-12` |
| `args[1]` | `any` | `1` | Day: `int` (`1-31`) or `"last"` / `"L"` for the last day |
| `args[2]` | `string` | `"0:0"` | Time string |

```go
s.Command("finance:quarterly-close").Quarterly()           // First day of each quarter at 00:00
s.Command("finance:quarterly-close").QuarterlyOn(45, "10:00") // 45th day of each quarter at 10:00
s.Command("stats:yearly-reset").Yearly()                   // January 1 every year at 00:00
s.Command("stats:yearly-reset").YearlyOn(12, 31, "23:59")  // December 31 every year at 23:59
s.Command("stats:yearly-reset").YearlyOn(12, "last", "23:59") // Last day of December every year at 23:59
```

## Preventing Overlapping Runs

**Method signature:**

```go
func (t *ScheduledTask) WithoutOverlapping(expiresAt ...int) *ScheduledTask
```

**Parameters:**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `expiresAt` | `...int` | `1440` | Lock expiration time in **minutes**. At most one value may be passed; `<= 0` or multiple values panic |

**Purpose:** Prevents the same task from running again while its previous run is still in progress. This matches Laravel Scheduler's `withoutOverlapping()` behavior.

**How it works:**

1. Before each run, the scheduler attempts to acquire a distributed lock through the default `github.com/prismgo/framework/cache` store
2. The lock key is generated from the task name: `Command` tasks use the command name, while `Call` tasks should explicitly set `Name` to remain stable across processes
3. If the previous run still holds the lock, the current trigger is skipped directly; it does not wait and does not call the task function
4. After task execution finishes, the lock is released automatically
5. `expiresAt` is a fallback expiration time that prevents a lock from being held forever after an abnormal task exit

```go
s.Command("emails:send").EveryMinute().WithoutOverlapping()      // Default 1440-minute expiration
s.Command("emails:send").EveryMinute().WithoutOverlapping(10)    // 10-minute expiration
s.Call(fn).Name("dashboard_rebuild").EveryTenMinutes().WithoutOverlapping()
```

> **Note:** Cross-process overlap prevention requires configuring the default `github.com/prismgo/framework/cache` store as a shared backend such as Redis. With an in-memory driver, it only applies within the current process.

## Starting and Stopping The Scheduler

### `Start(ctx)` - Start Scheduling

**Method signature:**

```go
func (s *Schedule) Start(ctx context.Context)
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `ctx` | `context.Context` | Controls the scheduler lifecycle. When `ctx` is cancelled, all task loops exit |

**Behavior:**

- Starts an independent goroutine for each registered task
- Does not block the current goroutine
- Only starts tasks that are registered at call time; finish all task registration before starting

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

s.Start(ctx)
```

### `Stop()` - Stop Scheduling

**Method signature:**

```go
func (s *Schedule) Stop()
```

**Behavior:**

- Triggers the internal cancel function and notifies all task goroutines to exit
- Blocks until all task goroutines return
- Does not forcibly kill currently running task functions
- Long-running tasks should actively listen to `ctx.Done()` for graceful shutdown

```go
s.Start(ctx)
defer s.Stop()
```

## Inspecting Registered Tasks

**Method signature:**

```go
func (s *Schedule) Summary() string
```

**Return value:** a formatted summary string of registered tasks, one task per line.

**Purpose:** Print the task list during scheduler startup to check whether configuration is correct.

```go
logger.Infof("scheduled tasks:\n%s", s.Summary())
```

Example output:

```text
  overtime:detect          Overdue work order detection
  area:sync                Administrative area sync
```

- Tasks registered through `Command` automatically use the description returned by the resolver
- Tasks registered through `Call` should explicitly set `Name(...)` and `Description(...)`

## Exception Handling

The scheduler has built-in exception handling so a single task error does not affect other tasks or the scheduler itself.

### Task Returns An Error

- Reports through `github.com/prismgo/framework/exception` `Report`, including context such as `task`, `status` (`500`), `component` (`"cron"`), and `duration_ms`
- Does **not** stop the scheduler or affect other tasks
- The task continues running when the next hit time arrives

### Task Panics

- Panic is captured inside the goroutine through `github.com/prismgo/framework/routine`
- It is also reported through `exception.Report`
- The task loop continues, and later triggers are unaffected

### Task Runs Successfully

- Prints `[schedule] task xxx done` only when `app.debug=true`
- Does not trigger exception reporting

### Exception Reporting Dependency

Error and panic reporting depends on the Reporter binding from the `github.com/prismgo/framework/exception` package. Tests can inject a custom Reporter to verify behavior. Production environments should ensure the Reporter is configured correctly.

## Execution Model

### Two Scheduling Modes

| Mode | Driver | Trigger rule | Use cases |
| --- | --- | --- | --- |
| **Fixed interval** | `time.Ticker` | Runs once immediately after startup, then repeats by interval | Health checks, short-cycle polling |
| **Calendar schedule** | `time.Timer` + hit-time calculation | Calculates the next hit time and runs when it arrives | Daily reports, weekly reports, monthly settlement |

### Immediate Run On Startup

The following calendar methods run once immediately after scheduler startup, preserving historical behavior:

- `EveryMinute()`, `EveryTwoMinutes()`, `EveryFiveMinutes()`, `EveryTenMinutes()`
- `EveryFifteenMinutes()`, `EveryThirtyMinutes()`
- `Hourly()`, `Daily()`

Other calendar methods strictly wait for the next hit time. For example, `DailyAt("18:30")` does not run immediately on startup; it waits for 18:30 today or tomorrow.

### Parallel and Serial Execution

- Different tasks execute **in parallel** in their own goroutines and do not affect each other
- The same task executes **serially** within its own goroutine: if the previous run has not finished, the next hit does not start a new copy. This naturally prevents local concurrency; use `WithoutOverlapping()` when cross-process control is needed

## Parameter Parsing Rules

### Time Strings

The following methods accept time string parameters in `HH:MM` or `HH:MM:SS` format:

- `At(timeValue)`
- `DailyAt(timeValue)`
- `WeeklyOn(dayOfWeek, timeValue...)`
- `MonthlyOn(dayOfMonth, timeValue...)`
- `QuarterlyOn(args...)`
- `YearlyOn(args...)`

Invalid times such as `"25:00"` or `"12:99"` panic during registration, exposing configuration errors early during startup.

### Minute and Hour Lists

Offset parameters for methods such as `HourlyAt`, `EveryTwoHours`, and `EveryThreeHours` support these formats:

```go
s.Command("job:a").HourlyAt(15)                  // int: single value
s.Command("job:b").HourlyAt("0,15,30,45")        // string: comma-separated list
s.Command("job:c").HourlyAt("10-20")             // string: range, expanded automatically
s.Command("job:d").HourlyAt([]int{5, 35})         // []int: slice
s.Command("job:e").HourlyAt([]string{"0", "30"})  // []string: string slice
```

Ranges are expanded into continuous values, then sorted and deduplicated automatically.

### Weekday Values

Weekday parsing supports numbers and English abbreviations:

| Number | English (case-insensitive) | Meaning |
| --- | --- | --- |
| `0` | `sun`, `sunday` | Sunday |
| `1` | `mon`, `monday` | Monday |
| `2` | `tue`, `tues`, `tuesday` | Tuesday |
| `3` | `wed`, `wednesday` | Wednesday |
| `4` | `thu`, `thur`, `thurs`, `thursday` | Thursday |
| `5` | `fri`, `friday` | Friday |
| `6` | `sat`, `saturday` | Saturday |

Strings support comma-separated values and hyphen ranges:

```go
s.Command("job:a").Days("mon-wed,fri").At("09:00")  // Monday through Wednesday + Friday
s.Command("job:b").WeeklyOn("mon,wed,fri", "10:00")  // Monday, Wednesday, and Friday
s.Command("job:c").WeeklyOn([]int{1, 3, 5}, "10:00") // Equivalent form
```

## Timer Base Types

```go
type Timer struct {
    Interval time.Duration
}
```

**Fields:**

| Field | Type | Description |
| --- | --- | --- |
| `Interval` | `time.Duration` | Task repeat interval. `Interval == 0` means no repeat and only one execution |

`Timer` is a lightweight base type that only describes execution interval information. It is used by legacy code or structs that need embedded timing information. It does not register, start, or stop tasks.

**New code should prefer `Schedule` and `ScheduledTask`.**

### ResolvedCommand

```go
type ResolvedCommand struct {
    Fn          func(ctx context.Context) error
    Description string
}
```

**Fields:**

| Field | Type | Description |
| --- | --- | --- |
| `Fn` | `func(context.Context) error` | The function ultimately executed by the scheduler |
| `Description` | `string` | Task description shown in `Summary()` output |

`ResolvedCommand` is the bridge result between the command system and the scheduler. It lets `github.com/prismgo/framework/timer` avoid depending on a concrete command framework. The scheduler only cares about receiving an executable function; command registration, argument parsing, and dependency injection are completed by the outer resolver.

### CommandResolver

```go
type CommandResolver func(name string, args []string) (ResolvedCommand, error)
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | Command name |
| `args` | `[]string` | Command argument list |

**Return values:** `ResolvedCommand` - executable function and description; `error` - errors such as an unregistered command.

`CommandResolver` is injected into the scheduler externally. Inside a project, the Console Kernel injects it automatically, so developers generally do not need to configure it manually.

Manual setup example:

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

**Method signature:**

```go
func NewSchedule() *Schedule
```

Creates an empty scheduler instance. Inside a project, the Console Kernel already includes a scheduler. Retrieve it through `kernel.Schedule()`; manual creation is usually unnecessary.

### ScheduledTask Metadata Methods

| Method | Signature | Purpose |
| --- | --- | --- |
| `Name(name)` | `func (t *ScheduledTask) Name(name string) *ScheduledTask` | Sets the task name, affecting logs and `Summary()` |
| `Description(desc)` | `func (t *ScheduledTask) Description(desc string) *ScheduledTask` | Sets the task description, affecting `Summary()` |

```go
s.Call(fn).EveryMinute().Name("tenant_sync").Description("Sync tenant cache")
```

Tasks registered through `Command` automatically get their name and description from the resolver. Tasks registered through `Call` should set both manually.

### Defaults

`ScheduledTask` defaults:

- Default mode: fixed interval mode
- Default interval: `1 * time.Minute`
- Default behavior: run once immediately after startup

Therefore, if you only write `s.Call(fn).Name("demo")`, it runs once immediately after `Start(ctx)`, then runs every minute. In real business code, **explicitly specify the frequency** so the scheduling intent is clear.

## Common Usage Examples

### Adding A New Scheduled Task

Append one line in [app/schedule/register.go](file:///www/code/workorder/app/schedule/register.go). See [Running The Scheduler -> Registering Tasks](#registering-tasks).

### Using The Scheduler Independently Without The Console Kernel

When you need to use the scheduler independently in another background process or test, manually create a `Schedule` instance and inject a command resolver:

```go
s := timer.NewSchedule()

// Option 1: inject a custom command resolver
s.SetResolver(func(name string, args []string) (timer.ResolvedCommand, error) {
    return timer.ResolvedCommand{
        Description: "Sync customer cache",
        Fn: func(ctx context.Context) error {
            return syncCustomers(ctx, args)
        },
    }, nil
})
s.Command("customer:sync --take=500").EveryFiveMinutes()

// Option 2: register a closure directly
s.Call(func(ctx context.Context) error {
    return refreshReportCache(ctx)
}).DailyAt("02:30").Name("report_cache").Description("Refresh report cache")

ctx, cancel := context.WithCancel(context.Background())
defer cancel()

s.Start(ctx)
defer s.Stop()
```

### Selection Guide

| Scenario | Recommended method |
| --- | --- |
| Task already has a CLI command entry point | `Command(...)` |
| Task is only in-process maintenance logic | `Call(...)` |
| Only the interval matters, not top-of-minute or clock alignment | `Every(d)` |
| Task must hit natural time boundaries | Calendar APIs such as `DailyAt(...)` and `WeeklyOn(...)` |
| Need to restrict weekdays before setting time | Call a date constraint first, such as `Weekdays()`, then call `At(...)` |
| Need one catch-up run immediately after startup | Use a method that preserves immediate-run semantics, or use `Every(d)` |

### Printing The Task Summary At Startup

```go
logger.Infof("scheduled tasks:\n%s", s.Summary())
```
