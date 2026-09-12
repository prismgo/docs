# 日志

- [简介](#简介)
- [配置](#配置)
  - [配置文件](#配置文件)
  - [可用通道驱动](#可用通道驱动)
  - [通道前置条件](#通道前置条件)
  - [配置参数说明](#配置参数说明)
- [构建日志堆栈](#构建日志堆栈)
  - [日志级别](#日志级别)
- [编写日志消息](#编写日志消息)
  - [使用 Facade](#使用-facade)
  - [上下文字段](#上下文字段)
  - [写入特定通道](#写入特定通道)
- [自定义通道](#自定义通道)
  - [自定义 Driver](#自定义-driver)
  - [自定义 Formatter](#自定义-formatter)
- [Manager 生命周期](#manager-生命周期)

---

PrismGo 日志组件提供 Laravel Logging 风格的多通道日志系统。它基于 [logrus](https://github.com/sirupsen/logrus) 封装，提供统一的 Facade、命名通道、Stack 扇出、结构化字段、错误上下文、文件驱动和可配置的 Formatter。

---

## 简介

PrismGo 日志系统基于"通道"（Channel）的概念。每个通道代表一种特定的日志写入方式。例如，`single` 通道将日志写入单个文件，`daily` 通道按天切割日志文件，`stderr` 通道写入进程的标准错误流。日志消息可以根据严重级别写入多个通道。

底层使用 [logrus](https://github.com/sirupsen/logrus) 作为结构化日志引擎，`github.com/prismgo/framework/logger` 包在 logrus 之上提供了 Laravel 风格的配置层，允许你灵活组合不同的驱动（Driver）和格式化器（Formatter）来自定义应用的日志处理。

每个 PrismGo 应用都自带预配置的日志设置。默认使用 `stack` 通道，它聚合多个日志通道为一个通道，让你能同时将日志写入多个目的地。

## 配置

控制应用日志行为的所有配置选项定义在 `config/logging.go` 中。

默认情况下，记录日志时使用 `stack` 通道。`stack` 通道将多个日志通道聚合为一个通道。

### 配置文件

日志配置在 `config/logging.go` 中注册，所有参数均可通过环境变量覆盖：

```go
// config/logging.go
func init() {
    config.Add("logging", func() map[string]interface{} {
        return map[string]interface{}{
            "default": config.Env("LOG_CHANNEL", "stack"),

            "channels": map[string]interface{}{
                "stack": map[string]interface{}{
                    "driver":   "stack",
                    "channels": []string{"single", "error"},
                },
                "single": map[string]interface{}{
                    "driver":    "single",
                    "level":     config.Env("APP_LOGGER_LEVEL", "info"),
                    "formatter": config.Env("APP_LOGGER_FORMATTER", "line"),
                    "path":      config.Env("APP_LOGGER_FILE", "storage/logs/app.log"),
                },
                "daily": map[string]interface{}{
                    "driver":    "daily",
                    "level":     config.Env("APP_LOGGER_LEVEL", "info"),
                    "formatter": config.Env("APP_LOGGER_FORMATTER", "line"),
                    "path":      config.Env("APP_LOGGER_FILE", "storage/logs/app.log"),
                },
                "error": map[string]interface{}{
                    "driver":    config.Env("ERROR_LOGGER_DRIVER", "daily"),
                    "level":     config.Env("ERROR_LOGGER_LEVEL", "warn"),
                    "formatter": config.Env("ERROR_LOGGER_FORMATTER", "line"),
                    "path":      config.Env("ERROR_LOGGER_FILE", "storage/logs/error/error.log"),
                },
                "stderr": map[string]interface{}{
                    "driver":    "stderr",
                    "level":     config.Env("STDERR_LOGGER_LEVEL", "info"),
                    "formatter": config.Env("STDERR_LOGGER_FORMATTER", "line"),
                },
            },
        }
    })
}
```

### 可用通道驱动

每个日志通道由"驱动"（Driver）驱动。驱动决定日志消息实际写入的位置和方式。每个 PrismGo 应用都内置以下驱动：

| 名称 | 说明 |
|---|---|
| `single` | 将所有日志写入单个文件，不轮转。适合开发环境。 |
| `daily` | 按天轮转日志文件。文件名格式为 `base-YYYY-MM-DD.log`。 |
| `stderr` | 写入进程的标准错误流（`os.Stderr`）。适合容器化部署。 |
| `stack` | 聚合多个通道的包装驱动。日志同时扇出到所有子通道。 |
| `null` | 丢弃所有日志消息。适合测试或临时关闭某个通道。 |

### 通道前置条件

#### Single 和 Daily 通道

`single` 和 `daily` 通道都需要 `path` 配置项来指定日志文件路径。`daily` 驱动会自动在文件名中追加当前日期。如果目录不存在，会自动创建（权限 `0755`）。

```go
"single": map[string]interface{}{
    "driver": "single",
    "level":  "info",
    "path":   "storage/logs/app.log",
},
"daily": map[string]interface{}{
    "driver": "daily",
    "level":  "info",
    "path":   "storage/logs/app.log",
},
```

对于 `daily` 驱动，配置文件 `storage/logs/app.log` 会生成类似 `storage/logs/app-2026-06-03.log` 的实际文件。

#### Stderr 通道

`stderr` 通道直接写入 `os.Stderr`，无需配置路径。这是 Docker 和 Kubernetes 部署的首选驱动，日志采集由容器运行时负责。

#### Null 通道

`null` 通道丢弃所有日志消息。它实现了 `Driver` 接口但不执行任何实际 I/O。适用于测试套件，或希望在保持调用链不变的前提下屏蔽某个通道的输出。

### 配置参数说明

#### 顶层配置

| 参数路径 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `logging.default` | `LOG_CHANNEL` | `"stack"` | 默认通道名，未显式指定通道时使用该通道 |

#### 通道配置

`logging.channels` 中每个通道支持以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `driver` | `string` | 驱动名称：`single`、`daily`、`stderr`、`stack` 或 `null`。决定日志输出目的地。 |
| `formatter` | `string` | 格式化器名称：`line`（默认）、`text` 或 `json`。决定每条日志的序列化方式。 |
| `level` | `string` | 通道级日志级别阈值：`debug`、`info`、`warn`、`error`、`fatal`、`panic`。低于该级别的消息会被过滤。 |
| `path` | `string` | 文件型驱动（`single`、`daily`）的输出路径。`daily` 驱动会在文件名中追加日期。 |
| `channels` | `[]string` | 子通道名称列表（仅 `stack` 驱动使用）。日志会广播到所有子通道。 |

#### 部署建议

| 场景 | 推荐配置 | 说明 |
|---|---|---|
| 本地开发 | `LOG_CHANNEL=stack`，formatter 用 `line` | 便于直接查看日志文件 |
| 传统服务器 | `stack` + `single` / `error` | 全量日志一份，warn 以上独立一份 |
| Docker / Kubernetes | `LOG_CHANNEL=stderr`，formatter 用 `json` | 交给容器运行时处理日志持久化 |
| 自动化测试 | 自定义 `null` 通道或手动 Manager | 避免测试产生文件副作用 |
| 高吞吐热路径 | 提升级别到 `info` 或 `warn` | 减少格式化和 I/O 开销 |

## 构建日志堆栈

`stack` 驱动允许你将多个通道组合为一个日志通道。这是生产环境的推荐做法——同时将业务日志写入文件，并将警告和错误路由到专用文件。

来看默认配置：

```go
"stack": map[string]interface{}{
    "driver":   "stack",
    "channels": []string{"single", "error"},
},
"single": map[string]interface{}{
    "driver":    "single",
    "level":     "info",
    "formatter": "line",
    "path":      "storage/logs/app.log",
},
"error": map[string]interface{}{
    "driver":    "daily",
    "level":     "warn",
    "formatter": "line",
    "path":      "storage/logs/error/error.log",
},
```

在此配置中，`stack` 通道聚合了 `single` 和 `error` 两个子通道。当写入日志到 `stack` 通道时：

- `single` 通道将所有 `info` 及以上级别的消息写入 `app.log`。
- `error` 通道将所有 `warn` 及以上级别的消息写入按天轮转的错误日志。

每个子通道保留自己的级别过滤和格式化器。这意味着 `logger.Info("...")` 只会到达 `single` 而不会到达 `error`，而 `logger.Error("...")` 会到达两个通道。

### 日志级别

PrismGo 支持以下日志级别（按严重程度降序排列）：

| 级别 | 说明 |
|---|---|
| `fatal` | 发生致命错误。记录日志后进程退出。 |
| `panic` | 发生恐慌。记录日志后进程退出。 |
| `error` | 运行时错误，阻止某个操作完成。 |
| `warn` | 发生了意外事件，但应用可以继续运行。 |
| `info` | 应用事件的常规操作信息。 |
| `debug` | 详细的诊断信息，用于调试。 |

每个通道的 `level` 选项决定了该通道记录消息的最低严重级别。例如，配置 `level: "warn"` 的通道会记录 `warn`、`error`、`fatal` 和 `panic` 消息，但会过滤掉 `info` 和 `debug`。

## 编写日志消息

### 使用 Facade

`github.com/prismgo/framework/logger` 包提供了一组包级函数作为默认日志通道的 Facade。这是业务代码中写入日志的主要方式：

```go
import "github.com/prismgo/framework/logger"

func Notify(userID uint) {
    logger.Debug("debug detail")
    logger.Info("notification started")
    logger.Warn("provider slow")
    logger.Error("provider failed")
}
```

同时提供格式化变体：

```go
logger.Infof("queue processed jobs=%d failed=%d", 100, 2)
logger.Errorf("payment failed: order=%s reason=%v", orderID, err)
```

`Fatal` 和 `Fatalf` 方法在记录日志后会调用 `os.Exit(1)`。请谨慎使用：

```go
logger.Fatal("critical component failed to start")
```

### 上下文字段

你可以使用 `WithField`、`WithFields`、`WithError` 和 `WithContext` 为日志消息附加结构化上下文。这些方法返回一个新的 `Logger` 实例，携带已附加的上下文，支持链式调用。

#### 单个字段

```go
logger.WithField("request_id", requestID).Info("request started")
```

#### 多个字段

```go
logger.WithFields(map[string]any{
    "tenant_id": tenantID,
    "user_id":   userID,
    "role":      "admin",
}).Info("permission checked")
```

#### 错误上下文

```go
if err != nil {
    logger.WithError(err).WithFields(map[string]any{
        "order_id": orderID,
        "job":      "SyncOrderJob",
    }).Error("job failed")
}
```

错误对象会被 `line` 格式化器特殊处理——当错误携带堆栈信息时，会自动追加 `[stacktrace]` 段落。

#### Context 字段提取

```go
logger.WithContext(ctx).Info("request finished")
```

`WithContext` 使用通道配置的 `ContextExtractor` 从 `context.Context` 中提取字段（如 `request_id`、`trace_id`、`tenant_id`）。如果没有配置 extractor，`WithContext` 是安全的空操作（no-op）。

ContextExtractor 在 Manager 或通道级别设置：

```go
type ContextExtractor func(context.Context) map[string]any
```

从 context 中读取请求 ID 的 extractor 示例：

```go
manager, err := logger.NewManager(logger.Config{
    Default: "stack",
    ContextExtractor: func(ctx context.Context) map[string]any {
        if reqID, ok := ctx.Value("request_id").(string); ok {
            return map[string]any{"request_id": reqID}
        }
        return nil
    },
    Channels: map[string]logger.ChannelOptions{...},
})
```

### 写入特定通道

有时你需要将日志写入默认通道以外的特定通道。使用 `Channel` 函数获取指定名称的通道并写入：

```go
logger.Channel("single").Info("business log")
logger.Channel("error").Warn("recoverable error")
logger.Channel("stderr").Info("container visible log")
```

如果请求的通道名称不存在，会回退到默认通道，避免配置漂移导致业务代码恐慌。

你也可以在特定通道上链式附加上下文：

```go
logger.Channel("error").
    WithField("order_id", orderID).
    WithError(err).
    Error("order sync failed")
```

#### 接口参考

| 函数 / 方法 | 说明 |
|---|---|
| `logger.Debug(args ...any)` | 向默认通道写入 debug 级别日志 |
| `logger.Info(args ...any)` | 向默认通道写入 info 级别日志 |
| `logger.Warn(args ...any)` | 向默认通道写入 warn 级别日志 |
| `logger.Error(args ...any)` | 向默认通道写入 error 级别日志 |
| `logger.Fatal(args ...any)` | 写入 fatal 级别日志并退出进程 |
| `logger.Debugf/Infof/Warnf/Errorf/Fatalf` | 上述方法的格式化变体 |
| `logger.Channel(name string) Logger` | 获取指定名称的通道 Logger |
| `logger.WithField(key string, value any) Logger` | 附加单个上下文字段 |
| `logger.WithFields(fields map[string]any) Logger` | 附加多个上下文字段 |
| `logger.WithError(err error) Logger` | 附加错误对象作为上下文 |
| `logger.WithContext(ctx context.Context) Logger` | 附加从 context 提取的字段 |
| `logger.Resolve() *Manager` | 从应用容器解析 Manager |
| `logger.DefaultName() string` | 获取默认通道名称 |
| `logger.Close() error` | 关闭 Manager 并释放所有驱动资源 |

## 自定义通道

### 自定义 Driver

如果内置驱动（`single`、`daily`、`stderr`、`null`）不能满足需求，可以使用 `Extend` 函数注册自定义驱动。这相当于 Laravel 通过 Monolog Handler 创建自定义通道。

自定义驱动需要实现 `Driver` 接口：

```go
type Driver interface {
    io.Writer
    Close() error
}
```

示例：注册一个写入外部日志服务的驱动：

```go
type syslogDriver struct {
    // ...
}

func (d *syslogDriver) Write(p []byte) (int, error) {
    // 将日志字节发送到外部服务
    return len(p), nil
}

func (d *syslogDriver) Close() error {
    // 释放网络连接等
    return nil
}

func init() {
    logger.Extend("syslog", func(opts logger.ChannelOptions) (logger.Driver, error) {
        return &syslogDriver{}, nil
    })
}
```

注册后即可在通道配置中通过名称引用自定义驱动：

```go
"channels": map[string]interface{}{
    "syslog": map[string]interface{}{
        "driver": "syslog",
        "level":  "warn",
    },
}
```

`Extend` 函数接受：
- 字符串 `name`（通道配置中使用的驱动标识符）
- `factory` 函数：接收 `ChannelOptions`，返回 `Driver`（或错误）

如果同名的驱动被再次注册，新工厂会覆盖旧工厂（后注册生效语义，与 Laravel 的 `LogManager::extend` 一致）。

### 自定义 Formatter

如果内置格式化器（`line`、`text`、`json`）不能满足格式化需求，可以使用 `RegisterFormatter` 函数注册自定义格式化器。

Formatter 工厂的函数签名：

```go
type FormatterFactory func(params map[string]any) (Formatter, error)
```

其中 `Formatter` 是 `logrus.Formatter` 的类型别名：

```go
type Formatter = logrus.Formatter
```

示例：注册一个纯文本格式化器：

```go
func init() {
    logger.RegisterFormatter("plain", func(params map[string]any) (logger.Formatter, error) {
        return &logrus.TextFormatter{
            DisableTimestamp: true,
            DisableColors:    true,
        }, nil
    })
}
```

注册后即可在通道配置中使用：

```go
"stderr": map[string]interface{}{
    "driver":    "stderr",
    "level":     "info",
    "formatter": "plain",
},
```

传递给工厂的 `params` map 包含 `"channel"` 键（通道名称），以及 `ChannelOptions.FormatterParams` 中的自定义参数。

#### 内置 Formatter

| 名称 | 说明 |
|---|---|
| `line` | 默认格式化器。输出格式与 Laravel/Monolog LineFormatter 一致：`[%datetime%] %channel%.%level_name%: %message% %context% [stacktrace]`。支持自动检测错误堆栈信息。 |
| `text` | logrus 原生文本格式。key=value 风格输出，适合向后兼容。 |
| `json` | JSON 行格式。每条日志是一个 JSON 对象。适合日志聚合系统（ELK、Loki 等）。 |

## Manager 生命周期

### 程序化初始化

在测试或独立程序中，可以使用 `NewManager` 手动创建 Manager：

```go
manager, err := logger.NewManager(logger.Config{
    Default: "stack",
    Channels: map[string]logger.ChannelOptions{
        "stack": {
            Driver:   "stack",
            Channels: []string{"app", "error"},
        },
        "app": {
            Driver:    "single",
            Level:     "info",
            Formatter: "text",
            Path:      "storage/logs/app.log",
        },
        "error": {
            Driver:    "daily",
            Level:     "warn",
            Formatter: "json",
            Path:      "storage/logs/error/error.log",
        },
    },
})
if err != nil {
    return err
}
defer manager.Close()
```

### Service Provider

在标准 PrismGo 应用中，`ServiceProvider` 将日志 Manager 作为单例注册到应用容器。Manager 是惰性构造的——在第一次写入日志之前不会打开任何文件或构建任何通道。这避免了在启动阶段进行 I/O 操作。

`ServiceProvider` 还注册了关闭器，使得应用容器关闭时会自动调用 `Manager.Close()`，确保所有日志文件被正确刷新并释放文件句柄。

### 资源清理

调用 `Manager.Close()` 执行以下操作：

1. 获取内部锁，防止关闭期间并发写入。
2. 遍历所有已解析的通道，调用每个通道驱动的 `Close()`。
3. 将 Manager 标记为已关闭。之后对已关闭 Manager 的日志写入会被静默丢弃（文件驱动返回 `os.ErrClosed`）。

请确保在应用关闭时调用 `Close()`（通常由容器生命周期自动处理）。

### 与全局 logrus 的关系

应用代码应直接使用 `logger.*` Facade 或注入 `*logger.Manager`。全局的 `logrus.StandardLogger()` 被配置为一个钩子，将调用路由到默认通道，确保迁移期间已有的 `logrus.*` 调用可以向后兼容。新代码不应继续扩散对全局 `logrus` 的依赖。日志 Manager 首次从应用容器解析时安装该钩子；默认通道仍延迟到首次写入时创建。应用关闭时会移除对应 Manager 的桥接。