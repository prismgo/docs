# Config 使用说明

- [快速开始](#快速开始)
- [组件用途](#组件用途)
- [加载流程](#加载流程)
- [环境变量函数](#环境变量函数)
- [配置注册](#配置注册)
- [配置读取](#配置读取)
- [应用配置参考](#应用配置参考)
- [独立实例](#独立实例)
- [facade 入口](#facade-入口)
- [使用建议](#使用建议)

`github.com/prismgo/framework/config` 提供 Laravel 风格的运行时配置仓库：配置文件通过 `Add` 注册为命名空间，`.env` 和系统环境变量通过 `Env` 读取，业务代码再用点路径读取配置值。

业务代码通常直接导入 `github.com/prismgo/framework/config`，并在应用的 `config/*.go` 中注册自己的配置命名空间。

## 快速开始

定义一个配置命名空间：

```go
package config

func init() {
	Add("mail", func() map[string]interface{} {
		return map[string]interface{}{
			"host": Env("MAIL_HOST", "127.0.0.1"),
			"port": Env("MAIL_PORT", 1025),
			"from": map[string]interface{}{
				"address": Env("MAIL_FROM_ADDRESS", "noreply@example.com"),
				"name":    Env("MAIL_FROM_NAME", "prismgo"),
			},
		}
	})
}
```

读取配置：

```go
package service

import (
	"strconv"

	"github.com/prismgo/framework/config"
)

func mailEndpoint() string {
	host := config.GetString("mail.host", "127.0.0.1")
	port := config.GetInt("mail.port", 1025)
	return host + ":" + strconv.Itoa(port)
}
```

本地 `.env` 示例：

```dotenv
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_FROM_ADDRESS=notice@example.com
```

## 组件用途

`github.com/prismgo/framework/config` 主要解决四类问题：

| 能力 | 用途 |
| --- | --- |
| 配置注册 | 用 `Add(name, fn)` 注册 `app`、`database`、`cache` 等配置命名空间 |
| 环境变量读取 | 用 `Env` 在注册函数里读取 `.env` 或系统环境变量 |
| 运行时读取 | 用 `GetString("app.name")` 这类点路径读取嵌套配置 |
| facade 管理 | 用 `Resolve` 接入应用容器懒加载，测试通过容器显式绑定配置实例 |

配置仓库只负责“加载静态运行时配置”。租户后台可变配置、系统参数表等业务数据不应该放进这个包。

## 加载流程

当前应用启动时，`github.com/prismgo/framework/foundation` 会注册配置工厂：

```text
main.go
  -> bootstrap.NewApplication()
  -> foundation.NewApplication()
  -> registerConfigResource()
  -> 首次 config.Resolve / config.GetString
  -> 读取 .env，执行所有 Add 注册函数，生成运行时仓库
```

配置函数是在构建仓库时执行的，不是在包初始化时立即读取最终值。因此 `config/*.go` 中推荐只写声明式结构：

```go
Add("app", func() map[string]interface{} {
	return map[string]interface{}{
		"name":  Env("APP_NAME", "prismgo"),
		"debug": Env("APP_DEBUG", false),
	}
})
```

`.env` 文件不存在时不会报错，会继续使用系统环境变量和默认值。`.env` 与系统环境变量同时存在时，显式提供的值会覆盖默认值。

## 环境变量函数

### Env

读取单个环境变量，缺失或空白时返回默认值：

```go
debug := config.Env("APP_DEBUG", false)
name := config.Env("APP_NAME", "prismgo")
```

返回值会尽量按默认值类型转换。默认值是 `bool`、`int`、`int64`、`uint`、`float64`、`string` 时会得到对应类型。

## 配置注册

`Add(name, fn)` 把一个命名空间注册到全局配置注册表。命名空间会成为点路径的第一段：

```go
config.Add("audit", func() map[string]interface{} {
	return map[string]interface{}{
		"enabled": config.Env("AUDIT_ENABLED", true),
		"rules": map[string]interface{}{
			"prismgo": config.Env("AUDIT_PRISMGO", true),
		},
	}
})
```

读取时：

```go
enabled := config.GetBool("audit.enabled", true)
prismgo := config.GetBool("audit.rules.prismgo", true)
```

注册函数返回的嵌套 map 会被整理成 `map[string]any`，因此 `map[string]interface{}` 和 `map[string]any` 都可以用。

## 配置读取

常用读取函数：

| 函数 | 返回类型 | 用途 |
| --- | --- | --- |
| `Get` / `GetString` | `string` | 字符串配置 |
| `GetInt` | `int` | 端口、数量、秒数等 |
| `GetInt64` | `int64` | 长整型配置 |
| `GetUint` | `uint` | 无符号整数配置 |
| `GetFloat64` | `float64` | 浮点配置 |
| `GetBool` | `bool` | 开关配置 |
| `GetStringMap` | `map[string]any` | 读取嵌套配置块 |
| `GetStringMapString` | `map[string]string` | 读取字符串映射 |

缺失配置可以传默认值：

```go
appName := config.GetString("app.name", "prismgo")
debug := config.GetBool("app.debug", false)
timeout := config.GetInt("app.server.timeout", 15)
```

读取嵌套配置：

```go
server := config.GetStringMap("app.server")
channels := config.GetStringMap("logging.channels")
labels := config.GetStringMapString("map.labels")
```

如果路径不存在，map 读取函数返回空 map，不返回 nil。

## 应用配置参考

新项目的应用级配置位于 `config/app.go`，通过 `config.Add("app", ...)` 注册。`.env` 中的 `APP_*` 和 `SERVER_*` 会覆盖默认值。

### 基础应用配置

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `app.name` | `APP_NAME` | `Prismgo` | 应用名称，用于框架需要展示或引用应用名的场景 |
| `app.env` | `APP_ENV` | `production` | 当前运行环境；迁移等高风险命令会用它判断是否需要 `--force` |
| `app.key` | `APP_KEY` | `""` | 应用加密密钥，见 [加密](encryption.md) |
| `app.debug` | `APP_DEBUG` | `false` | 调试模式；生产环境必须为 `false` |
| `app.url` | `APP_URL` | `http://localhost:8080` | 命令行或非 HTTP 场景生成绝对 URL 时使用 |
| `app.timezone` | `APP_TIMEZONE` | `UTC` | 应用时区配置 |
| `app.locale` | `APP_LOCALE` | `en` | 翻译组件默认语言 |
| `app.fallback_locale` | `APP_FALLBACK_LOCALE` | `en` | 当前语言缺少翻译时的 fallback |
| `app.cipher` | `APP_CIPHER` | `AES-256-GCM` | 加密算法，当前支持 `AES-256-GCM` |
| `app.previous_keys` | `APP_PREVIOUS_KEYS` | `""` | 逗号分隔的旧应用密钥，用于密钥轮换 |

### HTTP Server 配置

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `app.server.host` | `SERVER_HOST` | `""` | 监听主机 |
| `app.server.port` | `SERVER_PORT` | `8080` | 监听端口 |
| `app.server.timeout` | `SERVER_TIMEOUT` | `15` | 兼容型请求超时 fallback |
| `app.server.read_timeout` | `SERVER_READ_TIMEOUT` | `15s` | 读取完整请求超时 |
| `app.server.read_header_timeout` | `SERVER_READ_HEADER_TIMEOUT` | `5s` | 读取请求头超时 |
| `app.server.write_timeout` | `SERVER_WRITE_TIMEOUT` | `30s` | 写响应超时 |
| `app.server.idle_timeout` | `SERVER_IDLE_TIMEOUT` | `60s` | keep-alive 空闲超时 |
| `app.server.shutdown_timeout` | `SERVER_SHUTDOWN_TIMEOUT` | `15s` | 优雅关闭等待时间 |
| `app.server.max_header_bytes` | `SERVER_MAX_HEADER_BYTES` | `1048576` | 最大请求头字节数 |
| `app.server.max_multipart_memory` | `SERVER_MAX_MULTIPART_MEMORY` | `33554432` | multipart 表单内存上限 |
| `app.server.trusted_proxies` | `SERVER_TRUSTED_PROXIES` | `""` | 逗号分隔的可信代理 |
| `app.server.client_ip_headers` | `SERVER_CLIENT_IP_HEADERS` | `X-Forwarded-For,X-Real-IP` | 解析客户端 IP 的请求头 |
| `app.server.access_log` | `SERVER_ACCESS_LOG` | `true` | 是否启用访问日志 |
| `app.server.exception_handler` | `SERVER_EXCEPTION_HANDLER` | `true` | 是否挂载统一异常处理中间件 |

更多 HTTP 服务说明见 [HTTP Server](http-server.md)。

## 独立实例

除了全局 facade，也可以创建独立 `Config` 实例。测试、脚本、临时工具中推荐使用独立实例，避免污染全局配置：

```go
cfg, err := config.NewFromFile("testdata/.env")
if err != nil {
	return err
}

name := cfg.GetString("app.name", "prismgo")
debug := cfg.GetBool("app.debug", false)
```

复制一份当前配置：

```go
clone := config.Clone()
```

`Clone` 返回独立仓库，后续 `Reload` 不会互相影响。

## facade 入口

`github.com/prismgo/framework/config` 的全局默认配置由 `github.com/prismgo/framework/facade` 托管。

| 函数 | 用途 |
| --- | --- |
| `Resolve()` | 从当前 Application 容器解析配置仓库 |
| `Clone()` | 复制当前配置仓库，返回隔离副本 |
| `Reload()` | 从默认 `.env` 重载当前配置对象 |
| `Empty()` | 判断当前配置仓库是否为空 |

测试中常见写法：

```go
func TestWithConfig(t *testing.T) {
	cfg, err := config.NewFromFile("testdata/.env")
	if err != nil {
		t.Fatal(err)
	}
	bindConfigForTest(t, cfg)

	got := config.GetString("app.name", "")
	if got == "" {
		t.Fatal("missing app name")
	}
}
```

## 使用建议

- 业务代码优先导入 `github.com/prismgo/framework/config`，不要在业务层直接重复封装环境变量读取。
- 配置命名空间使用小写英文名，例如 `app`、`database`、`wechat`。
- 新配置项应放进 `config/*.go`，不要在 service 中直接 `os.Getenv`。
- 环境变量命名固定为一套当前名称，不为未上线阶段的旧变量名新增兼容入口。
- 配置值缺失时要给出合理默认值，尤其是端口、超时、开关类配置。
- 可变业务配置应放入业务表或专用 repository，不要塞进运行时配置仓库。
