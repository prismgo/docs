---
title: "HTTP Server"
---

# HTTP Server

- [简介](#简介)
- [启动服务](#启动服务)
- [监听地址](#监听地址)
- [超时与请求限制](#超时与请求限制)
- [代理与客户端 IP](#代理与客户端-ip)
- [中间件开关](#中间件开关)
- [进程控制](#进程控制)

## 简介

PrismGo 的 HTTP 服务由 `go run . serve` 启动。应用启动时会执行 `bootstrap.NewApplication()`，加载 provider、路由、中间件和异常处理器，然后构造 `net/http.Server`。

新项目在 `bootstrap/app.go` 中注册路由：

```go
foundation.Configure(basePath...).
    WithRouting(func(r *foundation.Routing) {
        r.Routes(apphttp.RegisterRoutes)
    }).
    Create()
```

## 启动服务

```bash
go run . serve
```

指定端口：

```bash
go run . serve --port=8000
```

`--port` 只覆盖本次命令使用的端口；不会修改 `.env` 或 `config/app.go`。

## 监听地址

默认配置位于 `config/app.go` 的 `app.server`：

```go
"server": map[string]interface{}{
    "host": Env("SERVER_HOST", ""),
    "port": Env("SERVER_PORT", 8080),
}
```

对应 `.env`：

```dotenv
SERVER_HOST=127.0.0.1
SERVER_PORT=8080
```

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `app.server.host` | `SERVER_HOST` | `""` | 监听主机。空字符串表示由 Go 使用所有地址 |
| `app.server.port` | `SERVER_PORT` | `8080` | 监听端口 |

## 超时与请求限制

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `app.server.timeout` | `SERVER_TIMEOUT` | `15` | 兼容型请求超时，作为部分超时配置的 fallback |
| `app.server.read_timeout` | `SERVER_READ_TIMEOUT` | `15s` | 读取完整请求的超时 |
| `app.server.read_header_timeout` | `SERVER_READ_HEADER_TIMEOUT` | `5s` | 读取请求头的超时 |
| `app.server.write_timeout` | `SERVER_WRITE_TIMEOUT` | `30s` | 写响应超时 |
| `app.server.idle_timeout` | `SERVER_IDLE_TIMEOUT` | `60s` | keep-alive 空闲超时 |
| `app.server.shutdown_timeout` | `SERVER_SHUTDOWN_TIMEOUT` | `15s` | 优雅关闭等待时间 |
| `app.server.max_header_bytes` | `SERVER_MAX_HEADER_BYTES` | `1048576` | 最大请求头字节数 |
| `app.server.max_multipart_memory` | `SERVER_MAX_MULTIPART_MEMORY` | `33554432` | multipart 表单内存上限 |

持续时间字段支持 Go duration 字符串，例如 `15s`、`1m`、`1m30s`。也支持纯数字秒数。

## 代理与客户端 IP

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `app.server.trusted_proxies` | `SERVER_TRUSTED_PROXIES` | `""` | 逗号分隔的可信代理列表 |
| `app.server.client_ip_headers` | `SERVER_CLIENT_IP_HEADERS` | `X-Forwarded-For,X-Real-IP` | 用于解析客户端 IP 的请求头 |

生产环境位于反向代理之后时，应显式设置可信代理，避免业务逻辑信任伪造的客户端 IP。

## 中间件开关

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `app.server.access_log` | `SERVER_ACCESS_LOG` | `true` | 是否启用 Gin 访问日志 |
| `app.server.exception_handler` | `SERVER_EXCEPTION_HANDLER` | `true` | 是否挂载统一 HTTP 异常处理中间件 |

`app.debug` / `APP_DEBUG` 会影响异常响应是否暴露内部细节。生产环境必须设置为 `false`。

## 进程控制

`serve` 会按端口维护 PID 文件。控制命令会读取当前端口对应的 PID：

| 命令 | 行为 |
| --- | --- |
| `go run . serve --stop` | 优雅停止当前端口服务 |
| `go run . serve --kill` | 强制停止当前端口服务 |
| `go run . serve --reload` | 启动新进程并通知旧进程优雅退出 |
| `go run . serve --restart` | 杀掉旧进程后启动新进程 |

如果服务不是通过 `serve` 启动，或 PID 文件已不存在，控制命令会报告无法读取 PID 文件。

