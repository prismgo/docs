---
title: "安装"
---

# 安装

- [服务器要求](#服务器要求)
- [安装 PrismGo Installer](#安装-prismgo-installer)
- [创建应用](#创建应用)
- [项目创建选项](#项目创建选项)
- [初始配置](#初始配置)
- [下一步](#下一步)

## 服务器要求

PrismGo 应用需要：

| 工具 | 要求 | 用途 |
| --- | --- | --- |
| Go | 1.25+ | 安装 installer、编译应用、运行 `go mod tidy` 和测试 |
| Git | 可用 | 拉取官方应用骨架 `github.com/prismgo/prismgo` |
| 网络 | 可访问 GitHub | 创建新项目时获取应用骨架 |

## 安装 PrismGo Installer

使用 Go 工具链安装：

```bash
go install github.com/prismgo/installer/cmd/prismgo@latest
```

也可以使用安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/prismgo/installer/main/scripts/install.sh | sh
```

确保 `go env GOPATH` 下的 `bin` 目录，或 `go env GOBIN`，已经加入 `PATH`。安装后验证：

```bash
prismgo --help
```

## 创建应用

创建短名称项目：

```bash
prismgo new myapp
cd myapp
```

生成目录为 `myapp`，`go.mod` 中的 module 是：

```go
module myapp
```

创建完整 Go module 路径项目：

```bash
prismgo new github.com/acme/myapp
cd myapp
```

生成目录仍为 `myapp`，`go.mod` 中的 module 是：

```go
module github.com/acme/myapp
```

创建完成后，installer 会复制 `.env.example` 为 `.env`，并默认运行：

```bash
go mod tidy
go test ./...
```

启动内置 HTTP 服务：

```bash
go run . serve
```

访问：

```text
http://localhost:8080/api
http://localhost:8080/api/health
```

## 项目创建选项

| 命令 | 说明 |
| --- | --- |
| `prismgo new myapp --module github.com/acme/service` | 显式指定 `go.mod` module |
| `prismgo new myapp --no-install` | 跳过 `go mod tidy` 和 `go test ./...` |
| `prismgo new myapp --git` | 创建后初始化本地 Git 仓库 |
| `prismgo new myapp --git --branch develop` | 初始化 Git 仓库并使用指定初始分支 |
| `prismgo new myapp --force` | 复用已存在的空目录 |

`--no-install` 只跳过依赖整理和测试，不会跳过应用骨架获取。创建项目仍然需要 Git 和 GitHub 访问。

`--force` 只允许使用空目录。它不会删除或覆盖非空目录。

## 初始配置

新项目的 `.env` 来自 `.env.example`。最先需要关注的配置通常是：

```dotenv
APP_NAME=Prismgo
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_URL=http://localhost:8080

SERVER_HOST=127.0.0.1
SERVER_PORT=8080
```

如果应用使用加密、加密队列、加密 Session 或临时签名 URL，请先生成应用密钥：

```bash
go run . key:generate
```

生产环境必须关闭调试模式：

```dotenv
APP_ENV=production
APP_DEBUG=false
```

## 下一步

- 阅读 [快速入门](starter.md)，创建你的第一个 HTTP 接口。
- 阅读 [配置](config.md)，了解 `config/*.go` 和 `.env` 的加载方式。
- 阅读 [命令行](commands.md)，查看 `serve`、`make:*`、`migrate:*` 和 `queue:*` 命令。
- 阅读 [HTTP Server](http-server.md)，了解端口、超时、代理和进程控制。

