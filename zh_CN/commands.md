# 命令行

- [简介](#简介)
- [查看命令](#查看命令)
- [HTTP 服务命令](#http-服务命令)
- [make 生成器](#make-生成器)
- [数据库迁移命令](#数据库迁移命令)
- [队列命令](#队列命令)
- [定时任务命令](#定时任务命令)
- [密钥与 Stub 命令](#密钥与-stub-命令)

## 简介

PrismGo 应用的 `main.go` 会把 `os.Args` 交给 `app.HandleCommand`。因此项目根目录下的常用命令都用 `go run .` 执行：

```bash
go run . list
go run . serve
go run . migrate
```

已编译二进制时，把 `go run .` 替换为你的二进制文件名即可。

## 查看命令

| 命令 | 说明 |
| --- | --- |
| `go run . list` | 查看所有可用命令 |
| `go run . list make` | 按命名空间筛选 |
| `go run . list --format=json` | 以 JSON 输出 |
| `go run . list --format=md` | 以 Markdown 输出 |
| `go run . list --raw` | 只输出原始命令名 |
| `go run . help migrate` | 查看单个命令帮助 |

## HTTP 服务命令

`serve` 启动或控制内置 HTTP 服务。配置详见 [HTTP Server](http-server.md)。

| 命令 | 说明 |
| --- | --- |
| `go run . serve` | 按 `.env` / `config/app.go` 启动 HTTP 服务 |
| `go run . serve --port=8000` | 临时覆盖监听端口 |
| `go run . serve --reload` | 优雅启动新进程，再关闭旧进程 |
| `go run . serve --restart` | 杀掉旧进程，再启动新进程 |
| `go run . serve --stop` | 优雅停止当前端口服务 |
| `go run . serve --kill` | 强制停止当前端口服务 |

## make 生成器

PrismGo 提供 Laravel 风格的 `make:*` 命令。所有生成器都支持：

| 选项 | 说明 |
| --- | --- |
| `{name}` | 生成对象名称，可包含目录，如 `Admin/UserController` |
| `--force` | 文件已存在时覆盖 |
| `--fullpath` | 输出绝对路径 |

### 生成器列表

| 命令 | 默认目录 | 说明 |
| --- | --- | --- |
| `make:command` | `app/cmd` | 创建 Console 命令 |
| `make:controller` | `app/http/controllers` | 创建 HTTP 控制器 |
| `make:event` | `app/events` | 创建事件 |
| `make:job` | `app/jobs` | 创建队列任务 |
| `make:listener` | `app/listeners` | 创建事件监听器 |
| `make:middleware` | `app/http/middleware` | 创建 Gin 中间件 |
| `make:migration` | `database/migrations` | 创建迁移 |
| `make:model` | `app/models` | 创建 GORM 模型 |
| `make:provider` | `app/providers` | 创建服务提供者 |
| `make:resource` | `app/http/resources` | 创建 API 资源转换器 |
| `make:seeder` | `database/seeders` | 创建 Seeder |

### 常用示例

```bash
go run . make:controller UserController
go run . make:model User --migration --controller --resource
go run . make:job SendWelcomeEmail
go run . make:listener SendWelcomeEmail --queued --event=UserRegistered
go run . make:provider BillingServiceProvider
```

`make:model` 可链式生成相关文件：

| 选项 | 说明 |
| --- | --- |
| `-m, --migration` | 同时生成 `create_<model>s_table` 迁移 |
| `-c, --controller` | 同时生成控制器 |
| `-r, --resource` | 同时生成 API Resource |
| `-s, --seeder` / `--seed` | 同时生成 Seeder |
| `--api` | 生成 API 控制器；未显式 `--controller` 时也会生成控制器 |
| `--table=` | 传给模型生成流程的表名提示 |

`make:model` 当前不支持 `--factory`、`--policy`、`--requests`、`--all`、`--test`、`--pest`、`--pivot`、`--morph-pivot`。传入这些选项会返回错误。

`make:controller` 支持：

| 选项 | 说明 |
| --- | --- |
| `-m, --model=` | 在生成文件中加入模型连接 TODO，不自动推断 import |
| `--api` | 生成 API 风格控制器 |
| `-r, --resource` | 生成 resource 风格控制器 |

`make:command` 支持：

| 选项 | 说明 |
| --- | --- |
| `--command=` | 覆盖生成命令中的 signature |

例如：

```bash
go run . make:command Report/DailyReportCommand --command=report:daily
```

`make:listener` 支持：

| 选项 | 说明 |
| --- | --- |
| `--queued` | 生成队列监听器 |
| `--async` | 生成异步监听器 |
| `--event=` | 在文件中写入事件提示 |

`--queued` 和 `--async` 不能同时使用。

`make:migration` 支持：

| 选项 | 说明 |
| --- | --- |
| `--create=` | 生成建表迁移，并指定表名 |
| `--table=` | 生成修改表迁移，并指定表名 |
| `--path=` | 自定义迁移目录 |
| `--realpath` | 允许 `--path` 使用绝对路径 |

```bash
go run . make:migration create_users_table --create=users
go run . make:migration add_avatar_to_users_table --table=users
```

如果没有传 `--create` 或 `--table`，生成器会根据迁移名称推断意图。

### 自定义生成器 Stub

发布内置 stub：

```bash
go run . stub:publish
```

生成器会优先读取项目根目录的 `stubs/*.stub`。已存在文件默认跳过，使用 `--force` 覆盖：

```bash
go run . stub:publish --force
```

## 数据库迁移命令

迁移命令默认扫描应用在 `bootstrap/app.go` 中注册的 migration path。新项目默认导入 `database/migrations`。

| 命令 | 说明 |
| --- | --- |
| `go run . migrate` | 执行未运行迁移 |
| `go run . migrate:install` | 创建迁移元数据表 |
| `go run . migrate:status` | 查看迁移运行状态 |
| `go run . migrate:rollback` | 回滚最近一批迁移 |
| `go run . migrate:reset` | 回滚所有迁移 |
| `go run . migrate:refresh` | 回滚后重新执行迁移 |
| `go run . migrate:fresh` | 删除所有表后重新执行迁移 |
| `go run . db:seed` | 执行 Seeder |

常用选项：

| 选项 | 命令 | 说明 |
| --- | --- | --- |
| `--database=` | 所有迁移命令、`db:seed` | 使用指定数据库连接 |
| `--force` | 会修改数据的命令 | 允许在生产环境执行 |
| `--path=*` | 迁移命令 | 指定迁移文件目录，可传多个 |
| `--realpath` | 迁移命令 | `--path` 是绝对路径 |
| `--pretend` | `migrate`、rollback/reset/refresh | 输出将执行的操作，不实际修改 |
| `--seed` | `migrate`、refresh/fresh | 迁移后执行 Seeder |
| `--seeder=` | `migrate`、refresh/fresh | 指定根 Seeder |
| `--step` | `migrate` | 每个迁移独立 batch，方便逐条回滚 |
| `--step=` | rollback/refresh | 回滚指定条数 |
| `--batch=` | rollback | 回滚指定 batch |
| `--drop-views` | fresh | 删除视图 |
| `--drop-types` | fresh | 删除 Postgres enum/type |
| `--class=` | `db:seed` | 指定 Seeder class |

生产环境保护由 `app.env` / `APP_ENV` 驱动。生产环境执行会修改数据的命令时，必须显式传 `--force`。

使用 SQLite 时必须先安装并注册 `github.com/prismgo/sqlite` 扩展。`migrate:fresh` 会通过当前连接的 Dialector 删除 SQLite 视图（传 `--drop-views` 时）和所有用户表，再执行迁移；命令入口和选项与 MySQL 相同。

## 队列命令

| 命令 | 说明 |
| --- | --- |
| `go run . queue` | 启动队列 worker |
| `go run . queue:work` | `queue` 的别名 |
| `go run . queue:failed` | 查看失败任务 |
| `go run . queue:retry <id...>` | 重试失败任务 |
| `go run . queue:forget <id>` | 删除单个失败任务 |
| `go run . queue:flush` | 删除所有失败任务 |
| `go run . queue:restart` | 通知 worker 优雅重启 |

Worker 选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `{connection?}` | `queue.default` | 队列连接 |
| `--queue=` | `default` | 队列名，支持逗号分隔 |
| `--once` | `false` | 只处理一个任务 |
| `--stop-when-empty` | `false` | 队列为空时退出 |
| `--sleep=` | `3` | 空队列睡眠秒数 |
| `--timeout=` | `60` | 单个任务超时秒数 |
| `--tries=` | `1` | 最大尝试次数 |
| `--backoff=` | `0` | 重试退避秒数，支持逗号分隔 |
| `--max-jobs=` | `0` | 处理指定数量后退出；`0` 表示不限制 |
| `--max-time=` | `0` | 运行指定秒数后退出；`0` 表示不限制 |
| `--retry-after=` | `90` | Redis reserved 任务重新可见秒数 |

## 定时任务命令

```bash
go run . cron
```

`cron` 会注册 `bootstrap/app.go` 中的 `r.Schedules(...)` 回调，并阻塞运行直到收到应用关闭信号或系统 `SIGINT` / `SIGTERM`。

## 密钥与 Stub 命令

生成应用密钥：

```bash
go run . key:generate
```

| 选项 | 说明 |
| --- | --- |
| `--show` | 只输出新 key，不修改 `.env` |
| `--force` | `APP_KEY` 已存在时覆盖 |

`key:generate` 会生成 `base64:` 前缀加 32 字节随机 key 的值，并写入 `.env` 的 `APP_KEY=` 行。详见 [加密](encryption.md)。

