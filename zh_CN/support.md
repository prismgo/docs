# Support

`prismgo/support` 提供框架级的辅助函数。这些函数与业务逻辑解耦，覆盖五个场景：**值判断**、**类型转换**、**URL 生成**、**路径解析**和**环境判断**。路径函数是应用中唯一定义目录结构的地方，所有需要定位项目目录的代码都应该通过 `support` 包获取路径，而不是自行拼接或依赖 `os.Getwd`。

- [功能概览](#功能概览)
- [环境依赖](#环境依赖)
  - [路径解析的依赖](#路径解析的依赖)
  - [URL 生成的配置来源](#url-生成的配置来源)
  - [IsProduction 的环境变量](#isproduction-的环境变量)
- [值判断](#值判断)
  - [Empty](#empty)
- [类型转换](#类型转换)
  - [ParseInt](#parseint)
- [URL 生成](#url-生成)
  - [URL](#url)
- [路径解析](#路径解析)
  - [路径解析规则](#路径解析规则)
  - [BasePath](#basepath)
  - [AppPath](#apppath)
  - [ConfigPath](#configpath)
  - [DatabasePath](#databasepath)
  - [PublicPath](#publicpath)
  - [ResourcePath](#resourcepath)
  - [StoragePath](#storagepath)
  - [LangPath](#langpath)
- [环境判断](#环境判断)
  - [IsProduction](#isproduction)
- [使用建议](#使用建议)
- [测试](#测试)

## 功能概览

| 函数 | 分类 | 用途 |
| --- | --- | --- |
| `Empty` | 值判断 | 判断一个值是否为"空"（nil、空字符串、零值、空切片/空 map 等） |
| `ParseInt` | 类型转换 | 将字符串解析为整数，解析失败时返回默认值 |
| `URL` | URL 生成 | 基于应用 `app.url` 生成完整 URL，并支持追加路径参数 |
| `BasePath` | 路径解析 | 返回应用根目录下的路径 |
| `AppPath` | 路径解析 | 返回 `app/` 目录下的路径 |
| `ConfigPath` | 路径解析 | 返回 `config/` 目录下的路径 |
| `DatabasePath` | 路径解析 | 返回 `database/` 目录下的路径 |
| `PublicPath` | 路径解析 | 返回 `public/` 目录下的路径 |
| `ResourcePath` | 路径解析 | 返回 `resources/` 目录下的路径 |
| `StoragePath` | 路径解析 | 返回 `storage/` 目录下的路径 |
| `LangPath` | 路径解析 | 返回 `lang/` 目录下的路径 |
| `IsProduction` | 环境判断 | 判断当前是否运行在生产环境 |

## 环境依赖

### 路径解析的依赖

路径函数依赖 `container` 中注册的路径绑定。应用启动时，`foundation` 会自动将应用根目录注入 `container`：

| 容器 key | 对应目录 | 对应函数 |
| --- | --- | --- |
| `path.base` | 应用根目录 | `BasePath` |
| `path.app` | `app/` | `AppPath` |
| `path.config` | `config/` | `ConfigPath` |
| `path.database` | `database/` | `DatabasePath` |
| `path.public` | `public/` | `PublicPath` |
| `path.resources` | `resources/` | `ResourcePath` |
| `path.storage` | `storage/` | `StoragePath` |
| `path.lang` | `lang/` | `LangPath` |

如果容器中不存在对应绑定（例如在测试中未初始化 Application），路径函数会通过 `internal/path` 自动探测项目根目录。探测规则：从当前工作目录向上查找 `go.work`、`.git` 或 `go.mod`，或检查是否有 `storage`/`config`/`app` 等标准目录布局。

### URL 生成的配置来源

`URL` 会读取当前应用配置中的 `app.url` 作为基础地址。读取顺序如下：

1. 优先从容器中的 `config.default` 读取 `app.url`
2. 如果应用尚未启动或配置服务不可用，读取 `APP_URL` 环境变量
3. 如果两者都为空，回退到 `http://localhost:8080`

`app.url` 末尾的 `/` 会被自动去除，传入的相对路径开头的 `/` 会被自动去除，最终只保留一个路径分隔符。

### IsProduction 的环境变量

`IsProduction` 通过读取 `APP_ENV` 环境变量判断当前环境。判断逻辑：

1. 读取 `APP_ENV` 环境变量
2. 如果 `APP_ENV` 为空，兜底返回 `true`（视为生产环境，保守策略）
3. 如果 `APP_ENV` 等于 `"production"`（不区分大小写），返回 `true`
4. 其他情况返回 `false`

默认行为：未设置 `APP_ENV` 时视为生产环境。这意味着如果忘记在开发环境配置 `APP_ENV`，路径函数和值判断函数仍可正常工作，但 `IsProduction` 会返回 `true`。

## 值判断

### Empty

判断一个值是否为"空"。空值定义对齐 Laravel `blank()` 辅助函数：`nil`、空字符串、空数组、空切片、空 map、`false`、零值数字、零值结构体、nil 指针/接口都视为空。

```go
import "github.com/prismgo/framework/support"

support.Empty(nil)           // true
support.Empty("")            // true
support.Empty("hello")       // false
support.Empty(false)         // true
support.Empty(true)          // false
support.Empty(0)             // true
support.Empty(1)             // false
support.Empty(0.0)           // true
support.Empty([]string{})    // true
support.Empty([]string{"a"}) // false
support.Empty(map[string]int{}) // true
support.Empty(MyStruct{})    // true（零值结构体）
```

典型使用场景：验证请求参数、判断可选字段是否提供、检查配置项是否为空。

```go
func UpdateProfile(ctx context.Context, req UpdateProfileRequest) error {
    if support.Empty(req.Nickname) {
        return errors.New("昵称不能为空")
    }
    // ...
}
```

## 类型转换

### ParseInt

将字符串解析为整数，解析失败时返回默认值。适合处理请求参数、环境变量、配置值等需要容错转换的场景。

```go
import "github.com/prismgo/framework/support"

support.ParseInt("10", 1)    // 10
support.ParseInt("bad", 7)   // 7（解析失败，返回默认值）
support.ParseInt("", 8)      // 8（空字符串，返回默认值）
support.ParseInt(" 12 ", 9)  // 12（自动去除首尾空格）
```

典型使用场景：处理分页参数、解析查询字符串中的数字字段。

```go
page := support.ParseInt(r.URL.Query().Get("page"), 1)
limit := support.ParseInt(r.URL.Query().Get("limit"), 20)
```

## URL 生成

### URL

基于应用 `app.url` 生成完整 URL。这个函数对齐 Laravel 的 `url()` 辅助函数，适合生成站内链接、回调地址、邮件中的绝对链接等。

```go
import "github.com/prismgo/framework/support"

// 假设 app.url 或 APP_URL 为 https://example.test/base/

support.URL("user/profile")  // https://example.test/base/user/profile
support.URL("/user/profile") // https://example.test/base/user/profile
support.URL("")              // https://example.test/base
```

如果传入的 `path` 已经是完整 URL，会原样返回，不会再拼接 `app.url`。这可以避免破坏 CDN 地址、外部跳转地址或调用方显式传入的绝对链接。

```go
support.URL("https://cdn.example.test/assets/app.js")
// https://cdn.example.test/assets/app.js
```

第二个及后续参数会作为额外路径段追加到 URL 末尾，并使用 `url.PathEscape` 编码。参数支持普通值、slice、array 和 map 的值；`nil` 和空字符串会被忽略。map 参数会按 key 排序后追加对应的值，确保生成结果稳定。

```go
support.URL("orders", 10, "items")
// https://example.test/base/orders/10/items

support.URL("user/profile", []any{1, "张 三"})
// https://example.test/base/user/profile/1/%E5%BC%A0%20%E4%B8%89

support.URL("files", map[string]any{"name": "合同.pdf", "team": "sales"})
// https://example.test/base/files/%E5%90%88%E5%90%8C.pdf/sales
```

`support.URL` 只负责把应用基础地址和路径片段拼成绝对 URL，不会根据路由名称解析路径。如果需要通过命名路由生成 URL，应使用 `route.URL`。

## 路径解析

路径函数接收可变参数，拼接后返回绝对路径。路径函数是应用中唯一定义目录结构的地方，直接拼接字符串或依赖 `os.Getwd` 会导致部署时路径错乱。

### 路径解析规则

所有路径函数遵循统一的解析规则：

1. **绝对路径原样返回**：如果传入的路径已是绝对路径，直接返回，不做任何拼接。
2. **前缀去重**：如果传入的路径以目录名开头（如 `StoragePath("storage/framework")`），会自动去除重复的前缀，等价于 `StoragePath("framework")`。
3. **应用启动后不随 cwd 变化**：一旦 Application 启动，路径绑定被写入容器，后续即使 `os.Chdir` 也不会影响路径函数的返回值。

```go
import "github.com/prismgo/framework/support"

// 假设应用根目录为 /www/code/workorder

// 基本用法：拼接子路径
support.StoragePath("logs", "app.log")   // /www/code/workorder/storage/logs/app.log
support.ConfigPath("app.go")             // /www/code/workorder/config/app.go
support.LangPath("en", "messages.json")  // /www/code/workorder/lang/en/messages.json

// 前缀去重：以下两种写法等价
support.StoragePath("storage/framework/cache/data")
support.StoragePath("framework/cache/data")
// 都返回 /www/code/workorder/storage/framework/cache/data

// 绝对路径原样返回
support.StoragePath("/tmp/logs/app.log") // /tmp/logs/app.log
```

### BasePath

返回应用根目录下的路径。适合定位 `.env`、`go.mod`、`composer.json` 等根目录文件。

```go
support.BasePath(".env")          // /www/code/workorder/.env
support.BasePath("go.mod")        // /www/code/workorder/go.mod
support.BasePath("storage", "app.log") // /www/code/workorder/storage/app.log
```

### AppPath

返回 `app/` 目录下的路径。适合在代码生成、模板编译等场景中定位业务代码。

```go
support.AppPath("models", "user.go") // /www/code/workorder/app/models/user.go
```

### ConfigPath

返回 `config/` 目录下的路径。适合在 Provider 中注册可发布的配置文件。

```go
support.ConfigPath("app.go")      // /www/code/workorder/config/app.go
support.ConfigPath("cache.go")    // /www/code/workorder/config/cache.go
```

### DatabasePath

返回 `database/` 目录下的路径。适合定位迁移文件、种子数据等。

```go
support.DatabasePath("migrations") // /www/code/workorder/database/migrations
```

### PublicPath

返回 `public/` 目录下的路径。适合定位静态资源、编译产物。

```go
support.PublicPath("index.html")   // /www/code/workorder/public/index.html
support.PublicPath("assets", "js") // /www/code/workorder/public/assets/js
```

### ResourcePath

返回 `resources/` 目录下的路径。适合定位视图模板、原始资源文件。

```go
support.ResourcePath("views") // /www/code/workorder/resources/views
```

### StoragePath

返回 `storage/` 目录下的路径。框架内部日志、缓存、文件上传等持久化数据都放在此目录。

```go
support.StoragePath("logs", "app.log")                    // /www/code/workorder/storage/logs/app.log
support.StoragePath("framework", "cache", "data")          // /www/code/workorder/storage/framework/cache/data
support.StoragePath("app", "public", "avatars")           // /www/code/workorder/storage/app/public/avatars
```

### LangPath

返回 `lang/` 目录下的路径。适合定位多语言翻译文件。

```go
support.LangPath("en", "messages.json")     // /www/code/workorder/lang/en/messages.json
support.LangPath("zh_CN", "validation.json") // /www/code/workorder/lang/zh_CN/validation.json
```

## 环境判断

### IsProduction

判断当前是否运行在生产环境。读取 `APP_ENV` 环境变量，不区分大小写。`APP_ENV` 为空时以保守策略兜底视为生产环境。

```go
import "github.com/prismgo/framework/support"

if support.IsProduction() {
    // 生产环境：跳过开发期功能注册、禁用调试输出
}
```

框架内部使用 `IsProduction` 控制以下行为：

| 模块 | 行为 |
| --- | --- |
| `vendor:publish` 命令 | 生产环境隐藏命令、拒绝执行 |
| `publish` 注册表 | 生产环境跳过资源注册 |

业务代码中的典型使用场景：

```go
// 只在非生产环境注册调试路由
if !support.IsProduction() {
    route.Get("/debug/pprof", pprof.Index)
}

// 生产环境使用更保守的配置
ttl := 10 * time.Minute
if support.IsProduction() {
    ttl = 5 * time.Minute
}
```

## 使用建议

- 路径拼接必须使用 `support` 包提供的路径函数，禁止在业务代码中直接使用 `os.Getwd` 或字符串拼接拼接目录。
- 生成站内绝对链接时使用 `support.URL`，不要在业务代码中手写 `APP_URL + path`。通过命名路由生成路径时使用 `route.URL`，再按需要组合成完整链接。
- `Empty` 适合判断表单字段、可选参数；如果场景需要区分"未传"和"传了空值"，建议使用指针类型或 `*string` 代替。
- `ParseInt` 适合容错场景；如果需要严格校验并返回错误，应使用 `strconv.Atoi`。
- `IsProduction` 仅在需要区分环境行为时使用。大部分业务代码不应该根据环境改变逻辑，而是通过配置项控制。
- 路径函数在测试中仍可正常工作：即使未初始化 Application，也会通过 `internal/path` 自动探测项目根目录。
