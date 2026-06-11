# Prismgo Lens

- [简介](#简介)
- [安装](#安装)
  - [快速安装](#快速安装)
  - [交互式安装向导](#交互式安装向导)
  - [非交互安装](#非交互安装)
  - [配置文件说明](#配置文件说明)
- [支持的 Agent](#支持的-agent)
- [命令参考](#命令参考)
  - [install](#install)
  - [update](#update)
  - [doctor](#doctor)
  - [mcp](#mcp)
  - [execute-tool](#execute-tool)
  - [browser-proxy](#browser-proxy)
  - [list-skills](#list-skills)
  - [add-skill](#add-skill)
- [MCP 工具](#mcp-工具)
  - [application-info](#application-info)
  - [search-docs](#search-docs)
  - [database-connections](#database-connections)
  - [database-schema](#database-schema)
  - [database-query](#database-query)
  - [run-diagnostic](#run-diagnostic)
  - [get-config](#get-config)
  - [list-available-config-keys](#list-available-config-keys)
  - [list-routes](#list-routes)
  - [list-console-commands](#list-console-commands)
  - [get-absolute-url](#get-absolute-url)
  - [get-env](#get-env)
  - [read-log-entries](#read-log-entries)
  - [last-error](#last-error)
  - [browser-logs](#browser-logs)
- [MCP 资源](#mcp-资源)
- [MCP 提示词](#mcp-提示词)
- [Skill 系统](#skill-系统)
  - [内置 Skill](#内置-skill)
  - [安装 Skill](#安装-skill)
  - [Skill 审计](#skill-审计)
- [Package Assets](#package-assets)
- [安全边界](#安全边界)

---

Prismgo Lens 是 PrismGo 的**开发环境辅助工具**，为 AI 编程 Agent（如 Claude Code、Cursor、GitHub Copilot、Codex 等）提供项目上下文感知能力。它让 Agent 能够读取项目配置、路由、数据库 schema、日志等运行时信息，从而做出更精准的开发决策。

> **重要**：Prismgo Lens 是纯开发工具，不进入生产应用构建，不影响生产环境性能。

---

## 安装

### 快速安装

安装 Prismgo Lens CLI：

```bash
go install github.com/prismgo/lens/cmd/prismgolens@latest
```

在 PrismGo 项目根目录运行：

```bash
prismgolens install
```

命令会自动：
1. 检测应用项目已配置的 Agent（如 `.claude/skills`、`.cursor/rules` 等）
2. 写入 `.prismgo-lens.json`（团队共享配置）和 `.prismgo-lens.local.json`（本机状态）
3. 将 guidelines 安装到 `.ai/guidelines`
4. 将 skills 安装到 `.ai/skills` 并同步到各 Agent skills 目录
5. 合并 MCP server 配置到每个 Agent 的 MCP 配置文件中
6. 在需要时自动把 Lens 二进制目录加入用户 PATH

### 交互式安装向导

```bash
prismgolens install --interactive
```

交互式向导会引导你选择：
- 要配置的 Agent
- 启用哪些功能（guidelines、skills、MCP、browser-logs、GitHub docs provider）
- 是否启用测试强制执行
- 要选择的第三方包 AI assets

### 非交互安装

```bash
# 仅为 Codex 安装 guidelines 和 MCP
prismgolens install --no-interaction \
  --agent codex --guidelines --mcp

# 安装所有功能并为指定 Agent 配置
prismgolens install --no-interaction \
  --agent claude_code --guidelines --skills --mcp --browser-logs

# 安装时启用指定第三方包的 AI assets
prismgolens install --no-interaction \
  --agent cursor --package-module github.com/prismgo/framework
```

### 预览安装（不写文件）

```bash
prismgolens install --dry-run --no-interaction
```

输出示例：
```
Dry run: true
Project: /www/wwwroot/work/workorder
Agents: claude_code, codex
Features: guidelines, skills, mcp, browser-logs
PATH fix: enabled
Enforce tests: true
Will write:
  - .prismgo-lens.json
  - .prismgo-lens.local.json
  - .ai guidelines
  - .ai/skills and selected Agent skills directories
  - Agent MCP config
```

### 配置文件说明

| 文件 | 用途 | 是否应提交 |
|------|------|-----------|
| `.prismgo-lens.json` | 团队共享配置：启用功能、Agent 列表、MCP 过滤规则、选择的包模块 | 是 |
| `.prismgo-lens.local.json` | 本机状态：绝对项目路径、检测到的 Agent | 否（`.gitignore`） |

`.prismgo-lens.json` 示例：
```json
{
  "version": 1,
  "agents": ["claude_code", "cursor"],
  "features": {
    "guidelines": true,
    "skills": true,
    "mcp": true,
    "browser_logs": true,
    "github_docs_provider": false
  },
  "selected_package_modules": ["github.com/prismgo/framework"],
  "enforce_tests": true,
  "mcp": {
    "tools": {
      "exclude": ["browser-logs"]
    }
  },
  "updated_at": "2026-06-05T10:00:00Z"
}
```

---

## 支持的 Agent

Prismgo Lens 自动检测并适配以下 Agent 的配置格式：

| Agent | 检测标识 | Guidelines 路径 | Skills 路径 | MCP 配置文件 |
|-------|---------|----------------|-------------|-------------|
| Codex | `codex` | `AGENTS.md` | `.agents/skills` | `.codex/config.toml` |
| Claude Code | `claude_code` | `CLAUDE.md` | `.claude/skills` | `.mcp.json` |
| Cursor | `cursor` | `.cursor/rules/prismgo-lens.md` | `.cursor/skills` | `.cursor/mcp.json` |
| GitHub Copilot | `copilot` | `.github/copilot-instructions.md` | `.github/skills` | `.vscode/mcp.json` |
| OpenCode | `opencode` | `AGENTS.md` | `.opencode/skills` | `.opencode.json` |
| Kiro | `kiro` | `.kiro/steering/prismgo-lens.md` | `.kiro/skills` | `.kiro/settings/mcp.json` |
| Junie | `junie` | `.junie/guidelines.md` | `.junie/skills` | `.junie/mcp.json` |

**自定义 Agent**：在 `.prismgo-lens.json` 的 `custom_agents` 中配置自定义 Agent 的路径和策略。

---

## 命令参考

### install

安装 guidelines、skills、MCP 配置到应用项目和 Agent。

```bash
# 交互式安装（推荐首次使用）
prismgolens install --interactive

# 指定 Agent 和功能
prismgolens install --no-interaction \
  --agent claude_code --guidelines --skills --mcp

# 预览不写文件
prismgolens install --dry-run
```

**可用选项：**

| 选项 | 说明 |
|------|------|
| `--project PATH` | 指定项目根目录 |
| `--agent NAME` | 指定 Agent（可多次使用） |
| `--guidelines` | 启用 guidelines |
| `--skills` | 启用 skills |
| `--mcp` | 启用 MCP 配置 |
| `--browser-logs` | 启用浏览器日志 |
| `--github-docs-provider` | 启用 GitHub 文档 provider |
| `--package-module MODULE` | 选择第三方包模块（可多次使用） |
| `--enforce-tests` / `--no-enforce-tests` | 是否启用测试强制 |
| `--no-fix-path` | 安装时不更新用户 PATH |
| `--mcp-command auto\|name\|absolute` | 选择 Agent MCP 配置启动 Prismgo Lens 的命令形式 |
| `--interactive` | 启动交互向导 |
| `--no-interaction` | 跳过交互 |
| `--dry-run` | 仅预览，不写文件 |

### update

按 `.prismgo-lens.json` 中的配置重新同步。

```bash
# 重新同步所有已安装内容
prismgolens update

# 预览更新，不同步 skills
prismgolens update --dry-run --ignore-skills

# 更新并显示发现的第三方包 assets
prismgolens update --discover
```

### doctor

输出检测到的项目根目录、当前可执行命令、PATH 状态和安装警告。

```bash
prismgolens doctor
```

### mcp

启动 stdio MCP server，供 Agent 调用。

```bash
prismgolens mcp
```

通常由 Agent 的 MCP 配置自动调用，无需手动执行。

### execute-tool

隔离执行一个 MCP 工具，参数为 base64 编码的 JSON。

```bash
# 执行 application-info 工具（e30= 是 {} 的 base64）
prismgolens execute-tool application-info e30=

# 执行 get-config 工具，查询 app.name
# {"key":"app.name"} 的 base64 是 eyJrZXkiOiJhcHAubmFtZSJ9
prismgolens execute-tool get-config eyJrZXkiOiJhcHAubmFtZSJ9
```

### browser-proxy

启动开发用反向代理，在 HTML 响应中注入浏览器日志脚本。

```bash
# 代理到本地服务，从 8052 端口访问
prismgolens browser-proxy \
  --target http://127.0.0.1:8051 --listen 127.0.0.1:8052
```

浏览器访问 `http://127.0.0.1:8052` 时：
- 所有 `console.log`、`console.error` 等输出会被捕获
- 前端 JavaScript 错误和未处理的 Promise rejection 也会被记录
- 日志写入 `storage/logs/browser.log`
- 非 HTML 响应（API JSON、静态资源等）直接透传

### list-skills

列出 `.ai/skills` 中已安装的 skills。

```bash
prismgolens list-skills
```

### add-skill

审计并安装 Skill。

```bash
# 安装本地 skill 目录
prismgolens add-skill /path/to/local/skill

# 从 GitHub 安装（自动审计）
prismgolens add-skill owner/repo/path/to/skill

# 列出仓库中所有可用 skills
prismgolens add-skill owner/repo --list

# 安装指定 skill
prismgolens add-skill owner/repo --skill skill-name

# 安装所有发现的 skills
prismgolens add-skill owner/repo --all

# 跳过审计（需要 --force 配合）
prismgolens add-skill owner/repo --skill skill-name --force --skip-audit
```

---

## MCP 工具

以下工具通过 MCP 协议暴露给 AI Agent。所有工具都是**只读**的，确保 Agent 不会意外修改数据。

### application-info

返回项目运行时概览：Go 版本、模块依赖、PrismGo 框架功能信号、前端依赖等。

**使用场景**：Agent 开始工作前，先获取项目上下文。

**示例：**
```
Agent 调用 → application-info()

返回：
{
  "go_version": "go1.22.5",
  "root_module": "workorder",
  "go_directive": "1.22",
  "app_env": "local",
  "app_debug": "true",
  "database_engine": "mysql",
  "framework_module": "github.com/prismgo/framework",
  "features": {
    "cache": true,
    "console": true,
    "database": true,
    "queue": true,
    "horizon": true,
    "route": true,
    "vue-vite": true
  },
  "packages": [...],
  "frontend_packages": [...]
}
```

### search-docs

搜索本地 PrismGo 文档、项目文档和 Agent guidelines。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `query` | string | 单个搜索词 |
| `queries` | []string | 多个搜索词 |
| `packages` | []string | 过滤包名，如 `prismgo`、`lens`、`project` |
| `token_limit` | int | 最大响应 token 数，默认 4000，最大 1,000,000 |

**示例：**
```
# 搜索缓存相关文档
Agent 调用 → search-docs(queries=["cache remember", "cache lock"], packages=["prismgo"])

# 搜索项目规则
Agent 调用 → search-docs(queries=["permission", "tenant"], packages=["project"])
```

**返回：**
```json
{
  "results": [
    {
      "path": "github.com/prismgo/docs/zh_CN/cache.md",
      "snippet": "缓存系统以 Manager 管理多个缓存 store...",
      "source": "local",
      "package": "prismgo",
      "language": "zh_CN"
    }
  ],
  "source": "local",
  "truncated": false
}
```

> **GitHub Docs Provider**：在 `.prismgo-lens.json` 中启用 `features.github_docs_provider` 并设置环境变量 `PRISMGO_LENS_GITHUB_DOCS_URL` 后，可同时搜索远程预构建的文档索引。

### database-connections

列出所有已配置的数据库连接（敏感值脱敏）。

**示例：**
```
Agent 调用 → database-connections()

返回：
{
  "default": "mysql",
  "connections": [
    {
      "name": "mysql",
      "driver": "mysql",
      "host": "127.0.0.1",
      "port": "3306",
      "database": "workorder",
      "username": "root",
      "password": "[redacted]"
    }
  ]
}
```

### database-schema

返回数据库表结构元数据，支持 MySQL、PostgreSQL、SQLite。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `connection` | string | 连接名，默认使用配置中的默认连接 |
| `mode` | string | `summary`（摘要）或 `full`（完整，含列、索引、外键） |
| `filter` | string | 按表名子串过滤 |
| `include_column_details` | bool | 即使在 summary 模式也包含列信息 |

**示例：**
```
# 获取所有表摘要
Agent 调用 → database-schema(mode="summary")

# 获取完整表结构
Agent 调用 → database-schema(mode="full")

# 只查看包含 "order" 的表
Agent 调用 → database-schema(mode="summary", filter="order")
```

### database-query

执行只读 SQL 查询。仅支持 MySQL，拒绝所有写入和 DDL 操作。

**安全限制：**
- 仅允许 `SELECT`、`SHOW`、`EXPLAIN`、`DESCRIBE`、`DESC` 和以 `SELECT` 结尾的 `WITH` 语句
- 拒绝 `INSERT`、`UPDATE`、`DELETE`、`ALTER`、`DROP`、`TRUNCATE`、`CREATE`、`REPLACE`、`RENAME`
- 拒绝多语句执行（内部有分号）
- 拒绝 `FOR UPDATE`、`LOCK IN SHARE MODE` 等锁定语句
- 拒绝 `INTO OUTFILE` 等文件写入语句
- 默认最多返回 100 行，可调整至最大 500 行
- 默认最多 256KB 响应，可调整至最大 1MB
- 敏感列名自动脱敏

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `sql` | string | 只读 SQL 语句（必填） |
| `connection` | string | 连接名 |
| `max_rows` | int | 最大行数，默认 100，最大 500 |
| `max_bytes` | int | 最大响应字节数，默认 262144 |

**示例：**
```
# 查询工单表前 10 条
Agent 调用 → database-query(sql="SELECT id, title, status FROM workorders LIMIT 10")

# 查看表结构
Agent 调用 → database-query(sql="DESCRIBE workorders")

# 查看索引使用
Agent 调用 → database-query(sql="SHOW INDEX FROM workorders")
```

### run-diagnostic

运行预注册的只读诊断项，是替代 Laravel Boost `tinker` 的安全方案。

**内置诊断项：**

| 诊断项 | 说明 |
|--------|------|
| `current-config-summary` | 列出配置 key 和数据库连接名 |
| `route-match-dry-run` | 按 method/path 过滤路由 |
| `console-command-metadata` | 返回控制台命令元数据 |
| `database-connection-ping` | Ping 数据库连接测试 |
| `queue-connection-summary` | 汇总队列配置 |
| `horizon-store-health-summary` | Horizon 存储和日志可用性 |

**示例：**
```
# 测试数据库连接
Agent 调用 → run-diagnostic(name="database-connection-ping")

# 查看配置概览
Agent 调用 → run-diagnostic(name="current-config-summary")
```

### get-config

读取配置值（按点路径），敏感值自动脱敏。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `key` | string | 配置点路径，如 `app.name`、`database.default` |

**示例：**
```
Agent 调用 → get-config(key="database.default")
返回：{"key": "database.default", "value": "mysql", "found": true}

Agent 调用 → get-config(key="app.secret")
返回：{"key": "app.secret", "value": "[redacted]", "found": true}
```

### list-available-config-keys

列出所有从 `config/*.go` 中发现的配置 key。

**示例：**
```
Agent 调用 → list-available-config-keys()

返回：
{
  "keys": [
    "app.debug",
    "app.name",
    "app.url",
    "cache.default",
    "cache.stores.redis.driver",
    "database.default",
    ...
  ]
}
```

### list-routes

列出 PrismGo 路由声明，支持按方法、路径、名称过滤。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `method` | string | 按 HTTP 方法过滤 |
| `path` | string | 按路径子串过滤 |
| `name` | string | 按路由名称子串过滤 |

**示例：**
```
# 列出所有 GET 路由
Agent 调用 → list-routes(method="GET")

# 查找包含 "workorder" 的路由
Agent 调用 → list-routes(path="workorder")

# 查找名称包含 "api" 的路由
Agent 调用 → list-routes(name="api")
```

### list-console-commands

列出所有 PrismGo 控制台命令定义。

**示例：**
```
Agent 调用 → list-console-commands()

返回：
{
  "commands": [
    {"name": "migrate", "description": "Run database migrations"},
    {"name": "seed", "description": "Seed the database"},
    {"name": "queue", "description": "Start queue worker"},
    ...
  ]
}
```

### get-absolute-url

根据 `APP_URL` 构建绝对 URL。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | string | 路径 |
| `name` | string | 路由名称（通过路由解析路径） |

**示例：**
```
Agent 调用 → get-absolute-url(path="/api/workorders")
返回：{"url": "http://127.0.0.1:8051/api/workorders"}

Agent 调用 → get-absolute-url(name="workorder.show")
返回：{"url": "http://127.0.0.1:8051/api/workorders/123"}
```

### get-env

读取非敏感环境变量。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `key` | string | 环境变量名（包含 secret/token/password/key 的名称会被拒绝） |

**示例：**
```
Agent 调用 → get-env(key="APP_ENV")
返回：{"key": "APP_ENV", "value": "local"}

Agent 调用 → get-env(key="DB_PASSWORD")
返回：错误 "get-env: secret-like keys are refused"
```

### read-log-entries

读取 `storage/logs` 下的日志尾部条目。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `entries` | int | 条目数，默认 50，最大 200 |
| `channel` | string | 日志 channel 文件名（不含 .log），默认 `app` |
| `path` | string | `storage/logs` 下的相对路径，覆盖 channel |

**示例：**
```
# 读取最近 20 条 app 日志
Agent 调用 → read-log-entries(entries=20)

# 读取队列日志
Agent 调用 → read-log-entries(channel="queue")

# 读取指定日志文件
Agent 调用 → read-log-entries(path="horizon.log")
```

### last-error

返回应用日志中最新的 error 条目。

**示例：**
```
Agent 调用 → last-error()

返回：
{
  "entry": "2026-06-05 10:00:00 ERROR: database connection timeout..."
}
```

### browser-logs

读取开发环境浏览器日志。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `entries` | int | 条目数，默认 50，最大 200 |

**示例：**
```
# 读取最近 30 条浏览器日志
Agent 调用 → browser-logs(entries=30)
```

---

## MCP 资源

| 资源 URI | 说明 |
|----------|------|
| `file://instructions/application-info.md` | 项目运行时、包和 PrismGo 功能上下文 |

---

## MCP 提示词

| 提示词名称 | 说明 |
|-----------|------|
| `prismgo-code-simplifier` | 简化最近的 Go/PrismGo 代码变更，保持行为不变 |

---

## Skill 系统

Prismgo Lens 提供 Skill 管理能力，Agent 可以通过 Skills 获取框架最佳实践和调试指导。

### 内置 Skill

| Skill | 说明 |
|-------|------|
| `prismgo-debug` | 使用 MCP 工具调试 PrismGo 应用，先复现再修改代码 |
| `prismgo-best-practices` | PrismGo 框架最佳实践（架构、Provider、Facade、路由、数据库、队列、缓存等） |

`prismgo-best-practices` 包含以下规则文件：
- `architecture.md` — 包边界和框架/应用分离
- `provider-facade.md` — Service Providers 和 Facades 使用
- `command-console.md` — 控制台命令定义
- `routing.md` — 路由注册、中间件、命名路由
- `database-schema.md` — Schema 构建和只读数据库工具
- `migrations.md` — 迁移管理和不可变部署
- `db-performance.md` — 查询优化、预加载、索引
- `queue-jobs.md` — 队列任务、批处理、失败处理
- `horizon.md` — Horizon 配置和可观测性
- `scheduling.md` — 定时任务调度
- `caching.md` — 缓存策略、分布式锁
- `config-env.md` — 配置管理和环境边界
- `error-handling.md` — 边界错误、异常处理、Panic 恢复
- `logging.md` — 日志 channel、结构化日志
- `events-notifications.md` — 事件监听和通知隔离
- `filesystem.md` — 文件系统磁盘、上传、临时 URL
- `rate-limiting.md` — 限流器和中间件
- `translation.md` — 多语言和翻译 key
- `session-cookie.md` — Session 中间件和 Cookie 安全
- `validation.md` — Gin 请求绑定和边界校验
- `frontend-vue-vite.md` — Vue/Vite 前端约定
- `testing-coverage.md` — 测试策略和覆盖率
- `security.md` — 安全边界（SQL 注入、密钥保护等）
- `style.md` — Go 代码风格

### 安装 Skill

```bash
# 从本地目录安装
prismgolens add-skill ./my-custom-skill

# 从 GitHub 安装
prismgolens add-skill github.com/owner/repo/skills/my-skill

# 查看仓库有哪些 skill 可选
prismgolens add-skill github.com/owner/repo --list
```

安装后 skill 会自动同步到所有已配置 Agent 的 skills 目录。

### Skill 审计

安装 Skill 时，Lens 会自动审计风险：

| 风险等级 | 行为 |
|---------|------|
| `low` | 正常安装 |
| `medium` | 正常安装，记录发现 |
| `high` | 需要 `--force` 确认 |
| `critical` | 需要 `--force --skip-audit` 手动审查后安装 |

审计规则包括：
- `rm -rf` 递归删除（critical）
- `sudo` 提权命令（high）
- 远程脚本执行（critical）
- `git reset --hard` 破坏性重置（high）
- `DROP TABLE` 破坏性数据库语句（critical）
- `../` 路径穿越（medium）
- 绝对路径写入（high）
- 未声明的 shell/进程执行（high）
- 隐藏文件/大型隐藏文件（medium/high）
- 可执行文件（high）
- 符号链接（high）

---

## Package Assets

第三方 Go 模块可以在 `resources/prismgo-lens/` 目录下分发 AI assets：

```
some-module/
  resources/
    prismgo-lens/
      guidelines/
        some-feature.md      # guideline 文件
      skills/
        some-skill/
          SKILL.md           # skill 目录
```

**发现和安装：**

```bash
# 发现所有已依赖模块中的 AI assets
prismgolens update --discover

# 在 .prismgo-lens.json 中启用指定模块
# "selected_package_modules": ["github.com/prismgo/framework"]

# 或安装时直接指定
prismgolens install \
  --package-module github.com/prismgo/framework
```

启用的 module 中：
- `guidelines/*.md` → 复制到 `.ai/guidelines/packages/{module}/`
- `skills/{name}/SKILL.md` → 审计后复制到 `.ai/skills/{name}/`

---

## 安全边界

- **模块路径**：`github.com/prismgo/lens`
- **工具白名单**：MCP 调用只能访问注册的工具
- **隔离执行**：MCP `tools/call` 通过子进程执行，带超时和输出限制
- **SQL 安全**：`database-query` 仅允许只读 SQL，拒绝写入、DDL、多语句
- **密钥保护**：`get-config`、`get-env`、`database-connections` 自动脱敏
- **路径限制**：`read-log-entries` 只能读取 `storage/logs` 内的文件
- **Skill 审计**：安装远程 skill 时自动执行静态风险扫描

---
