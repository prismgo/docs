# prismgo/config 使用说明

`prismgo/config` 提供 Laravel 风格的运行时配置仓库：配置文件通过 `Add` 注册为命名空间，`.env` 和系统环境变量通过 `Env` 读取，业务代码再用点路径读取配置值。

在当前项目里，业务层通常导入 `prismgo/config`。这个包会注册 `config/*.go` 里的业务配置，并把 `prismgo/config` 的常用入口重新导出。通用包内部则直接导入 `github.com/prismgo/framework/config`。

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

	"prismgo/config"
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

`prismgo/config` 主要解决四类问题：

| 能力 | 用途 |
| --- | --- |
| 配置注册 | 用 `Add(name, fn)` 注册 `app`、`database`、`cache` 等配置命名空间 |
| 环境变量读取 | 用 `Env` 在注册函数里读取 `.env` 或系统环境变量 |
| 运行时读取 | 用 `GetString("app.name")` 这类点路径读取嵌套配置 |
| facade 管理 | 用 `Resolve` 接入应用容器懒加载，测试通过容器显式绑定配置实例 |

配置仓库只负责“加载静态运行时配置”。租户后台可变配置、系统参数表等业务数据不应该放进这个包。

## 加载流程

当前应用启动时，`prismgo/foundation` 会注册配置工厂：

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

`prismgo/config` 的全局默认配置由 `prismgo/facade` 托管。

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

- 业务代码优先导入 `prismgo/config`，不要在业务层直接重复封装环境变量读取。
- 配置命名空间使用小写英文名，例如 `app`、`database`、`wechat`。
- 新配置项应放进 `config/*.go`，不要在 service 中直接 `os.Getenv`。
- 环境变量命名固定为一套当前名称，不为未上线阶段的旧变量名新增兼容入口。
- 配置值缺失时要给出合理默认值，尤其是端口、超时、开关类配置。
- 可变业务配置应放入业务表或专用 repository，不要塞进运行时配置仓库。
