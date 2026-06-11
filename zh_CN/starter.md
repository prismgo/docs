# 快速入门

- [创建项目](#创建项目)
- [启动服务](#启动服务)
- [查看默认路由](#查看默认路由)
- [添加第一个接口](#添加第一个接口)
- [验证结果](#验证结果)
- [接下来](#接下来)

本教程会从一个新 PrismGo 应用开始，启动 HTTP 服务，并添加一个返回 JSON 的接口。

## 创建项目

先安装 installer：

```bash
go install github.com/prismgo/installer/cmd/prismgo@latest
```

创建应用：

```bash
prismgo new hello-prism
cd hello-prism
```

如果你已经安装过 installer，可以直接从 `prismgo new` 开始。

## 启动服务

新应用的入口是 `main.go`。它创建 `bootstrap.NewApplication()`，再把命令行参数交给 PrismGo Console Kernel：

```go
func main() {
    app := bootstrap.NewApplication()

    if err := app.HandleCommand(context.Background(), os.Args); err != nil {
        console.Exit(err.Error())
    }
}
```

启动 HTTP 服务：

```bash
go run . serve
```

默认监听地址来自 `.env`：

```dotenv
SERVER_HOST=127.0.0.1
SERVER_PORT=8080
```

访问健康检查：

```bash
curl http://127.0.0.1:8080/api/health
```

你应该看到：

```json
{"status":"ok"}
```

## 查看默认路由

在另一个终端运行：

```bash
go run . route:list
```

新项目默认注册了 `/api/health` 和 `/api`。路由来源是 `routes/api.go`，并通过 `app/http/register.go` 装配到应用。

## 添加第一个接口

打开 `routes/api.go`，在 `Register` 函数中添加一条路由：

```go
route.Get("/api/ping", func(c *gin.Context) {
    c.JSON(http.StatusOK, gin.H{
        "message": "pong",
    })
})
```

完整结构类似：

```go
func Register(app Dependencies) {
    route.Get("/api/health", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{"status": "ok"})
    })

    route.Get("/api/ping", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{"message": "pong"})
    })

    if app.WelcomeController != nil {
        route.Get("/api", app.WelcomeController.Show)
    }
}
```

如果 `go run . serve` 仍在运行，停止后重新启动：

```bash
go run . serve
```

## 验证结果

访问新接口：

```bash
curl http://127.0.0.1:8080/api/ping
```

你应该看到：

```json
{"message":"pong"}
```

再次查看路由列表：

```bash
go run . route:list --path=ping
```

## 接下来

- 使用 [生成器命令](commands.md#make-生成器) 创建控制器、模型、迁移和任务。
- 阅读 [路由](route.md) 了解分组、命名路由、资源路由和限流。
- 阅读 [HTTP Server](http-server.md) 配置端口、超时、代理和优雅重启。
- 阅读 [Database](database.md) 和 [Queue](queue.md) 构建持久化与后台任务。

