# 路由

- [简介](#简介)
- [快速开始](#快速开始)
  - [使用 Facade（推荐）](#使用-facade推荐)
  - [挂载到 Gin Engine](#挂载到-gin-engine)
  - [使用独立 Router 实例](#使用独立-router-实例)
- [基本路由](#基本路由)
  - [注册 HTTP 方法路由](#注册-http-方法路由)
  - [多个 HTTP 方法共用一个 Handler](#多个-http-方法共用一个-handler)
  - [注册所有常见 HTTP 方法](#注册所有常见-http-方法)
- [路由参数](#路由参数)
  - [参数写法](#参数写法)
  - [可选参数](#可选参数)
  - [通配参数](#通配参数)
- [参数约束](#参数约束)
  - [单条路由约束](#单条路由约束)
  - [约束方法速查](#约束方法速查)
  - [分组约束](#分组约束)
  - [全局参数约束](#全局参数约束)
- [命名路由](#命名路由)
  - [给路由命名](#给路由命名)
  - [生成 URL](#生成-url)
  - [分组命名前缀](#分组命名前缀)
  - [重复命名](#重复命名)
- [路由分组](#路由分组)
  - [路径前缀](#路径前缀)
  - [链式组合](#链式组合)
  - [嵌套分组](#嵌套分组)
- [中间件](#中间件)
  - [分组中间件](#分组中间件)
  - [路由级中间件](#路由级中间件)
  - [命名中间件与排除](#命名中间件与排除)
- [参数绑定（模型绑定）](#参数绑定模型绑定)
  - [注册绑定器](#注册绑定器)
  - [在 Handler 中读取绑定结果](#在-handler-中读取绑定结果)
  - [绑定失败处理](#绑定失败处理)
- [控制器 Action](#控制器-action)
- [资源路由](#资源路由)
  - [API 资源路由](#api-资源路由)
  - [完整资源路由（含页面型动作）](#完整资源路由含页面型动作)
  - [资源路由选项](#资源路由选项)
  - [批量注册 API 资源](#批量注册-api-资源)
  - [嵌套资源](#嵌套资源)
- [重定向路由](#重定向路由)
- [静态文件](#静态文件)
- [Fallback 路由](#fallback-路由)
- [域名约束](#域名约束)
- [限流](#限流)
  - [注册限流器](#注册限流器)
  - [挂载到路由](#挂载到路由)
- [当前路由信息](#当前路由信息)
  - [RouteInfo 结构体](#routeinfo-结构体)
- [路由列表与调试](#路由列表与调试)
  - [代码中查看](#代码中查看)
  - [命令行查看](#命令行查看)
- [处理器执行顺序](#处理器执行顺序)
- [全局 Facade 生命周期](#全局-facade-生命周期)
  - [获取全局 Router](#获取全局-router)
  - [测试隔离](#测试隔离)
- [Router 完整 API 参考](#router-完整-api-参考)
  - [构造函数](#构造函数)
  - [路由注册](#路由注册)
  - [特殊路由](#特殊路由)
  - [声明器入口](#声明器入口)
  - [全局配置](#全局配置)
  - [查询与挂载](#查询与挂载)
- [Route 链式配置 API 参考](#route-链式配置-api-参考)
- [Registrar 声明器 API 参考](#registrar-声明器-api-参考)
  - [属性设置](#属性设置)
  - [路由注册与分组](#路由注册与分组)
- [资源路由 API 参考](#资源路由-api-参考)
  - [接口](#接口)
  - [注册函数](#注册函数)
  - [选项函数](#选项函数)
- [限流 API 参考](#限流-api-参考)
- [全局 Facade 函数速查](#全局-facade-函数速查)
- [ServiceProvider](#serviceprovider)
- [项目内推荐写法](#项目内推荐写法)
- [测试](#测试)

---

## 简介

`prismgo/route` 是面向 Gin 的 Laravel 风格路由声明库。它将路由定义、分组、中间件、参数约束、命名路由和模型绑定等能力封装为声明式 API，降低手写 `gin.Engine` 路由时重复的前缀拼接和中间件管理代码。

**核心设计原则：**

- 路由声明不与 HTTP 服务绑定 —— `Router` 只收集定义，`Mount(engine)` 才挂载到 Gin。
- 业务 handler 保持原生 `func(*gin.Context)` 签名，无需适配。
- 支持全局 facade 便捷调用，也支持独立 `Router` 实例用于测试隔离。
- 路由元数据在挂载前完整收集，支持 `route:list` 命令行、命名 URL 生成和资源路由。
- 参数约束、绑定失败、域名检查等横切逻辑在请求链路最前端统一处理。

当前项目的业务路由集中注册在 [routes/api.go](../../routes/api.go)，静态文件路由在 [routes/storage.go](../../routes/storage.go)，命令行路由查看能力在 [prismgo/cmd/route.go](../cmd/route.go)。

---

## 快速开始

### 使用 Facade（推荐）

```go
package routes

import (
    "net/http"

    "github.com/gin-gonic/gin"
    "github.com/prismgo/framework/route"
)

func Register() {
    route.Get("/health", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{"status": "ok"})
    })

    route.Prefix("/api/v1").Group(func() {
        route.Post("/auth/login", login)
        route.Get("/users/{id}", showUser).WhereNumber("id").Name("users.show")
    })
}

func login(c *gin.Context)   {}
func showUser(c *gin.Context) {}
```

### 挂载到 Gin Engine

```go
engine := gin.New()
if err := route.Mount(engine); err != nil {
    return err
}
```

### 使用独立 Router 实例

```go
router := route.New()
router.Get("/ping", func(c *gin.Context) {
    c.String(http.StatusOK, "pong")
})

engine := gin.New()
if err := router.Mount(engine); err != nil {
    return err
}
```

---

## 基本路由

### 注册 HTTP 方法路由

所有路由注册返回 `*Route`，支持链式追加名称、约束、绑定失败处理等。

```go
route.Get("/users", index)
route.Post("/users", store)
route.Put("/users/{id}", replace)
route.Patch("/users/{id}", update)
route.Delete("/users/{id}", destroy)
route.Options("/users", options)
```

### 多个 HTTP 方法共用一个 Handler

```go
route.Match([]string{"PUT", "PATCH"}, "/users/{id}", update)
```

### 注册所有常见 HTTP 方法

```go
route.Any("/webhook", webhook)
```

`Any` 包含的方法：`GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`OPTIONS`、`HEAD`。

---

## 路由参数

### 参数写法

推荐使用 `{name}` 写法（Laravel 风格），兼容 Gin 原生 `:name` 写法：

```go
route.Get("/users/{id}", showUser)       // 必填参数
route.Get("/posts/{slug?}", showPost)    // 可选参数
route.Get("/files/{path}", serveFile).Where("path", ".*")  // 通配参数
```

兼容旧写法：

```go
route.Get("/prismgos/:id", showPrismgo)
```

handler 中读取参数与 Gin 原生一致：

```go
func showUser(c *gin.Context) {
    id := c.Param("id")
    // ...
}
```

### 可选参数

可选参数仅支持 `{id?}` 写法。路由编译时会生成两条 Gin 路径：带参数版本和不带参数版本，确保 Gin 两种请求都能匹配。

### 通配参数

使用 `{path}` 配合 `Where("path", ".*")` 时，会编译为 Gin 的 `*path` 通配路径，匹配任意多级路径段。常用于静态文件、文件代理等场景。

---

## 参数约束

参数约束在请求进入业务 handler 之前执行，约束不通过时返回 `404`。

### 单条路由约束

```go
route.Get("/users/{id}", showUser).WhereNumber("id")
route.Get("/tags/{name}", showTag).WhereAlpha("name")
route.Get("/codes/{code}", showCode).WhereAlphaNumeric("code")
route.Get("/orders/{uuid}", showOrder).WhereUuid("uuid")
route.Get("/events/{ulid}", showEvent).WhereUlid("ulid")
route.Get("/status/{value}", showStatus).WhereIn("value", []string{"open", "closed"})
route.Get("/files/{path}", serveFile).Where("path", ".*")
```

### 约束方法速查

| 方法 | 名称 | 参数 | 用途 |
| --- | --- | --- | --- |
| `Where(param, expr)` | 自定义正则 | `param string` — 参数名；`expr string` — 正则表达式 | 设置任意正则约束 |
| `WhereNumber(param)` | 数字 | `param string` — 参数名 | 约束参数为正则 `^\d+$`，匹配纯数字 |
| `WhereAlpha(param)` | 字母 | `param string` — 参数名 | 约束参数为 `^[A-Za-z]+$`，匹配纯字母 |
| `WhereAlphaNumeric(param)` | 字母数字 | `param string` — 参数名 | 约束参数为 `^[A-Za-z0-9]+$`，匹配字母或数字 |
| `WhereUuid(param)` | UUID | `param string` — 参数名 | 约束参数为 UUID v1-v5 格式 |
| `WhereUlid(param)` | ULID | `param string` — 参数名 | 约束参数为 ULID 格式（26 位 Crockford Base32） |
| `WhereIn(param, values)` | 枚举值 | `param string` — 参数名；`values []string` — 允许的值集合 | 约束参数必须在给定集合中 |

### 分组约束

分组约束会作用于组内所有路由的同名参数：

```go
route.Prefix("/api").Where("id", `\d+`).Group(func() {
    route.Get("/users/{id}", showUser)
    route.Get("/orders/{id}", showOrder)
})
```

### 全局参数约束

`Pattern` 注册全局约束，作用于所有路由的同名参数。局部 `Where` 会覆盖同名全局 `Pattern`：

```go
route.Pattern("slug", `[a-z0-9-]+`)
route.Get("/posts/{slug}", showPost)
```

---

## 命名路由

命名路由允许通过名称生成 URL，避免在代码中硬编码路径。

### 给路由命名

```go
route.Get("/users/{id}", showUser).Name("users.show")
```

### 生成 URL

```go
path, err := route.URL("users.show", map[string]any{"id": 100})
if err != nil {
    return err
}
// path == "/users/100"
```

参数会经过 `url.PathEscape` 编码。缺少参数时返回错误。

### 分组命名前缀

```go
route.Prefix("/admin").Name("admin.").Group(func() {
    route.Get("/users/{id}", showUser).Name("users.show")
})

path, _ := route.URL("admin.users.show", map[string]any{"id": 100})
// path == "/admin/users/100"
```

### 重复命名

同一路由多次调用 `.Name(...)` 时，会保留分组前缀，只覆盖当前路由自身的名称后缀：

```go
routeRef := route.Name("admin.").Get("/users/{id}", showUser)
routeRef.Name("users.show")
routeRef.Name("users.detail")

path, _ := route.URL("admin.users.detail", map[string]any{"id": 100})
```

---

## 路由分组

路由分组允许批量共享路径前缀、命名前缀、中间件、域名约束和参数约束。

### 路径前缀

```go
route.Prefix("/api/v1").Group(func() {
    route.Get("/users", userIndex)       // GET /api/v1/users
    route.Get("/users/{id}", userShow)   // GET /api/v1/users/{id}
})
```

### 链式组合

```go
route.Prefix("/api/v1").
    Name("api.").
    Middleware(authMiddleware).
    Group(func() {
        route.Get("/profile", profile).Name("profile")
    })
```

### 嵌套分组

内层分组会继承外层的所有属性：

```go
route.Prefix("/api").Name("api.").Group(func() {
    route.Prefix("/admin").Name("admin.").Group(func() {
        route.Get("/users", adminUsers).Name("users.index")
    })
})
```

最终命名为 `api.admin.users.index`，路径为 `/api/admin/users`。

---

## 中间件

### 分组中间件

分组中间件会自动作用于组内所有路由：

```go
route.Prefix("/api/v1").
    Middleware(authRequired, tenantActive).
    Group(func() {
        route.Get("/profile", profile)
    })
```

### 路由级中间件

路由级中间件直接放在 handler 参数前面，最后一个 handler 被当作业务 action：

```go
route.Get("/prismgos",
    middleware.RequirePermission(permission.PrismgoList),
    app.PrismgoHandler.List,
)
```

### 命名中间件与排除

通过 `NamedMiddleware` 给中间件附加稳定名称后，可以按名称排除。未命名时回退到 Go 函数名匹配：

```go
auth := route.NamedMiddleware("auth", authRequired)

route.Middleware(auth).Group(func() {
    route.Get("/profile", profile)
    route.Get("/public-info", publicInfo).WithoutMiddleware("auth")
})
```

也可以在分组声明阶段排除：

```go
route.Middleware(auth).Group(func() {
    route.WithoutMiddleware("auth").Get("/callback", callback)
})
```

---

## 参数绑定（模型绑定）

参数绑定器在路由参数解析后、业务 handler 前执行，将原始参数值转换为业务对象并写入 `gin.Context`。概念上等价于 Laravel 的隐式模型绑定。

### 注册绑定器

```go
route.Bind("user", func(c *gin.Context, value string) (any, error) {
    user, err := userRepo.Find(c.Request.Context(), value)
    if err != nil {
        return nil, err
    }
    return user, nil
})
```

`Model` 是 `Bind` 的语义化别名，表达"模型绑定"意图：

```go
route.Model("prismgo", bindPrismgo)
```

### 在 Handler 中读取绑定结果

```go
route.Get("/users/{user}", func(c *gin.Context) {
    value, ok := c.Get("user")
    if !ok {
        c.AbortWithStatus(http.StatusNotFound)
        return
    }
    user := value.(*model.User)
    c.JSON(http.StatusOK, user)
})
```

### 绑定失败处理

绑定器返回错误时：
- 如果路由配置了 `Missing`，执行 `Missing` 回调并中断请求。
- 未配置 `Missing`，默认返回 `404`。

```go
route.Get("/users/{user}", showUser).Missing(func(c *gin.Context) {
    c.JSON(http.StatusNotFound, gin.H{"message": "user not found"})
})
```

---

## 控制器 Action

将控制器对象放入分组属性，通过方法名字符串解析 handler：

```go
type UserController struct{}

func (c *UserController) Index(ctx *gin.Context) {}
func (c *UserController) Show(ctx *gin.Context)  {}

controller := &UserController{}

users := route.Controller(controller).Prefix("/users")
users.Action(http.MethodGet, "/", "Index")
users.Action(http.MethodGet, "/{id}", "Show")
```

- 控制器方法签名必须为 `func(*gin.Context)`。
- 控制器为空、方法不存在或签名不符合要求时 **panic**，适合在启动阶段尽早暴露配置错误。

---

## 资源路由

控制器实现 `ResourceController` 接口后，可通过 `ApiResource` 或 `Resource` 一键注册 REST 风格路由。

### API 资源路由

```go
type PhotoController struct{}

func (c *PhotoController) Index(ctx *gin.Context)   {}
func (c *PhotoController) Store(ctx *gin.Context)   {}
func (c *PhotoController) Show(ctx *gin.Context)    {}
func (c *PhotoController) Update(ctx *gin.Context)  {}
func (c *PhotoController) Destroy(ctx *gin.Context) {}

route.ApiResource("photos", &PhotoController{})
```

`ApiResource("photos", controller)` 注册的路由：

| Method | URI | Action | Name |
| --- | --- | --- | --- |
| GET | `/photos` | `Index` | `photos.index` |
| POST | `/photos` | `Store` | `photos.store` |
| GET | `/photos/{photo}` | `Show` | `photos.show` |
| PUT,PATCH | `/photos/{photo}` | `Update` | `photos.update` |
| DELETE | `/photos/{photo}` | `Destroy` | `photos.destroy` |

### 完整资源路由（含页面型动作）

`Resource` 除了上述 5 个动作外，还支持 `Create` 和 `Edit`。只有控制器实现了 `CreateController` 或 `EditController` 接口时才注册：

```go
type FullPhotoController struct{}

func (c *FullPhotoController) Index(ctx *gin.Context)   {}
func (c *FullPhotoController) Store(ctx *gin.Context)   {}
func (c *FullPhotoController) Show(ctx *gin.Context)    {}
func (c *FullPhotoController) Update(ctx *gin.Context)  {}
func (c *FullPhotoController) Destroy(ctx *gin.Context) {}
func (c *FullPhotoController) Create(ctx *gin.Context)  {}
func (c *FullPhotoController) Edit(ctx *gin.Context)    {}

route.Resource("photos", &FullPhotoController{})
```

### 资源路由选项

```go
// 只注册指定动作
route.ApiResource("photos", controller, route.Only("index", "show"))

// 排除指定动作
route.ApiResource("photos", controller, route.Except("destroy"))

// 自定义动作名称
route.Resource("widgets", controller,
    route.Names(map[string]string{
        "index": "widgets",
        "show":  "widgets.detail",
    }),
)

// 自定义参数名（默认参数名为资源名单数形式）
route.Resource("widgets", controller,
    route.Parameters(map[string]string{
        "widgets": "widget_id",
    }),
)
```

### 批量注册 API 资源

```go
route.ApiResources(map[string]route.ResourceController{
    "photos": photoController,
    "posts":  postController,
})
```

### 嵌套资源

资源名中的点号会转换为路径分隔符：

```go
route.ApiResource("users.photos", controller)
// /users/photos
// /users/photos/{photo}
```

---

## 重定向路由

```go
// 临时重定向（302）
route.Redirect("/old", "/new")

// 指定状态码
route.Redirect("/temp", "/target", http.StatusTemporaryRedirect)

// 永久重定向（301）
route.PermanentRedirect("/old", "/new")
```

---

## 静态文件

```go
route.Static("/assets", "./public/assets")
```

等价于注册 `GET /assets/*filepath`，通过 `http.Dir(root)` 读取文件。

---

## Fallback 路由

当所有路由都不匹配时，执行 Fallback 处理函数。当前项目中用它实现 SPA 回退：非 `/api` 路径返回 `public/index.html`。

```go
route.Fallback(func(c *gin.Context) {
    c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
})
```

---

## 域名约束

域名约束在请求进入业务 handler 前检查 `Host` 头，不匹配时返回 `404`。

```go
route.Domain("api.example.test").Group(func() {
    route.Get("/health", health)
})
```

支持占位符（只匹配子域名段，不做类型限制）：

```go
route.Domain("{tenant}.example.test").Group(func() {
    route.Get("/dashboard", dashboard)
})
```

---

## 限流

### 注册限流器

```go
route.RateLimiter("login", func(c *gin.Context) []route.Limit {
    return []route.Limit{
        route.PerMinute(5).By(func(c *gin.Context) string {
            return c.ClientIP()
        }),
    }
})
```

### 挂载到路由

```go
// 单条路由
route.Post("/auth/login", route.Throttle("login"), login)

// 分组
route.Middleware(route.Throttle("api")).Group(func() {
    route.Get("/profile", profile)
})
```

- 限流状态使用 `github.com/prismgo/framework/cache`。
- 如果命名限流器不存在，`Throttle` 会直接放行。
- 超过限制时返回 `429`：`{"message":"too many requests"}`。

---

## 当前路由信息

每条已挂载路由会在业务 handler 前写入当前路由元数据到 `gin.Context`，key 为 `route.current`：

```go
func handler(c *gin.Context) {
    value, ok := c.Get("route.current")
    if !ok {
        return
    }

    info := value.(route.RouteInfo)
    // info.Name   — 路由名称
    // info.URI    — 声明时的 URI
    // info.GinPath — 编译后的 Gin 路径
}
```

### RouteInfo 结构体

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Methods` | `[]string` | HTTP 方法列表 |
| `URI` | `string` | 声明时的原始 URI |
| `GinPath` | `string` | 编译后注册到 Gin 的路径 |
| `Name` | `string` | 路由名称 |
| `Domain` | `string` | 域名约束 |
| `Handler` | `string` | 业务 handler 的函数名 |
| `Middleware` | `[]string` | 中间件名称列表 |
| `SourcePath` | `string` | 业务 handler 所在源文件路径 |

---

## 路由列表与调试

### 代码中查看

```go
routes := route.List()
for _, item := range routes {
    fmt.Println(item.Methods, item.URI, item.Name)
}
```

### 命令行查看

```powershell
go run ./ route:list
go run ./ route:list --path=/api/v1
go run ./ route:list --name=users
go run ./ route:list --method=POST
```

---

## 处理器执行顺序

`Mount(engine)` 按声明顺序挂载路由到 Gin。每条路由的 handler 链路顺序为：

1. **域名约束检查** — 不匹配返回 `404`。
2. **参数正则约束检查** — 不匹配返回 `404`。
3. **参数绑定器** — 失败执行 `Missing` 回调或返回 `404`。
4. **分组和路由中间件** — 按声明顺序执行。
5. **当前路由信息注入** — 写入 `route.current`。
6. **业务 action** — 你的 handler。

> 需要依赖绑定对象或权限上下文的业务中间件，应放在路由中间件阶段；参数格式校验和绑定失败会先于业务中间件返回。

---

## 全局 Facade 生命周期

### 获取全局 Router

```go
router := route.Resolve()
```

`Resolve` 从 Application Container 中获取 key 为 `"route.router"` 的单例。首次调用时通过 `ServiceProvider` 的 lazy factory 创建 `Router` 实例。

### 测试隔离

测试中优先创建独立 `Router` 实例，避免污染全局 facade：

```go
router := route.New()
router.Get("/health", handler)
```

独立 `Router` 实例支持 `Reset`：

```go
router.Reset()
```

---

## Router 完整 API 参考

### 构造函数

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `New` | `func New() *Router` | 创建一个空路由器，所有注册表初始化为空 |
| `Reset` | `func (r *Router) Reset()` | 清空所有路由、命名索引、绑定器和全局约束 |
| `Clone` | `func (r *Router) Clone() *Router` | 深拷贝当前路由表，不复制声明期 group scope |

### 路由注册

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `Add` | `func (r *Router) Add(methods []string, uri string, handlers ...HandlerFunc) *Route` | 底层注册方法，最后一个 handler 为 action |
| `Get` | `func (r *Router) Get(uri string, handlers ...HandlerFunc) *Route` | 注册 GET 路由 |
| `Post` | `func (r *Router) Post(uri string, handlers ...HandlerFunc) *Route` | 注册 POST 路由 |
| `Put` | `func (r *Router) Put(uri string, handlers ...HandlerFunc) *Route` | 注册 PUT 路由 |
| `Patch` | `func (r *Router) Patch(uri string, handlers ...HandlerFunc) *Route` | 注册 PATCH 路由 |
| `Delete` | `func (r *Router) Delete(uri string, handlers ...HandlerFunc) *Route` | 注册 DELETE 路由 |
| `Options` | `func (r *Router) Options(uri string, handlers ...HandlerFunc) *Route` | 注册 OPTIONS 路由 |
| `Match` | `func (r *Router) Match(methods []string, uri string, handlers ...HandlerFunc) *Route` | 为指定方法集合注册路由 |
| `Any` | `func (r *Router) Any(uri string, handlers ...HandlerFunc) *Route` | 注册支持 GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD 的路由 |

### 特殊路由

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `Redirect` | `func (r *Router) Redirect(uri, destination string, status ...int) *Route` | 注册重定向路由，默认 302 |
| `PermanentRedirect` | `func (r *Router) PermanentRedirect(uri, destination string) *Route` | 注册 301 永久重定向 |
| `Static` | `func (r *Router) Static(uri, root string) *Route` | 注册静态文件目录路由 |
| `Fallback` | `func (r *Router) Fallback(handler HandlerFunc) *Route` | 注册 NoRoute 兜底处理 |

### 声明器入口

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `Prefix` | `func (r *Router) Prefix(prefix string) *Registrar` | 创建带路径前缀的声明器 |
| `Name` | `func (r *Router) Name(name string) *Registrar` | 创建带命名前缀的声明器 |
| `Domain` | `func (r *Router) Domain(domain string) *Registrar` | 创建带域名约束的声明器 |
| `Middleware` | `func (r *Router) Middleware(handlers ...HandlerFunc) *Registrar` | 创建带中间件的声明器 |
| `Controller` | `func (r *Router) Controller(controller any) *Registrar` | 创建带控制器对象的声明器 |
| `Group` | `func (r *Router) Group(fn func())` | 直接在 Router 上执行分组闭包 |

### 全局配置

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `Bind` | `func (r *Router) Bind(param string, binder Binder)` | 注册参数绑定器，参数名 + 绑定函数 |
| `Model` | `func (r *Router) Model(param string, binder Binder)` | `Bind` 的语义化别名 |
| `Pattern` | `func (r *Router) Pattern(param, expr string)` | 注册全局参数约束，被局部 `Where` 覆盖 |

### 查询与挂载

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `List` | `func (r *Router) List() []RouteInfo` | 获取当前所有路由快照 |
| `URL` | `func (r *Router) URL(name string, params map[string]any) (string, error)` | 根据命名路由生成 URL |
| `Mount` | `func (r *Router) Mount(engine *gin.Engine) error` | 将路由表挂载到 Gin engine |

---

## Route 链式配置 API 参考

`Route` 是单条路由的链式配置对象，由路由注册方法返回。

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `Name` | `func (r *Route) Name(name string) *Route` | 设置路由名称后缀，覆盖前次调用 |
| `Where` | `func (r *Route) Where(param, expr string) *Route` | 设置参数正则约束 |
| `WhereNumber` | `func (r *Route) WhereNumber(param string) *Route` | 约束参数为数字 |
| `WhereAlpha` | `func (r *Route) WhereAlpha(param string) *Route` | 约束参数为纯字母 |
| `WhereAlphaNumeric` | `func (r *Route) WhereAlphaNumeric(param string) *Route` | 约束参数为字母或数字 |
| `WhereUuid` | `func (r *Route) WhereUuid(param string) *Route` | 约束参数为 UUID |
| `WhereUlid` | `func (r *Route) WhereUlid(param string) *Route` | 约束参数为 ULID |
| `WhereIn` | `func (r *Route) WhereIn(param string, values []string) *Route` | 约束参数在枚举值集合中 |
| `Missing` | `func (r *Route) Missing(handler HandlerFunc) *Route` | 设置绑定失败时的兜底处理 |
| `Middleware` | `func (r *Route) Middleware(handlers ...HandlerFunc) *Route` | 追加路由级中间件 |
| `WithoutMiddleware` | `func (r *Route) WithoutMiddleware(names ...string) *Route` | 按名称或函数名排除中间件 |
| `ScopeBindings` | `func (r *Route) ScopeBindings() *Route` | 保留 Laravel 链式语义，当前无副作用 |
| `WithoutScopedBindings` | `func (r *Route) WithoutScopedBindings() *Route` | 保留 Laravel 链式语义，当前无副作用 |

---

## Registrar 声明器 API 参考

`Registrar` 保存链式分组声明中的属性，通过 `Router.Prefix`、`Router.Name` 等入口创建。

### 属性设置

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `Prefix` | `func (r *Registrar) Prefix(prefix string) *Registrar` | 追加路径前缀 |
| `Name` | `func (r *Registrar) Name(name string) *Registrar` | 追加命名前缀 |
| `Domain` | `func (r *Registrar) Domain(domain string) *Registrar` | 设置域名约束，覆盖外层 |
| `Middleware` | `func (r *Registrar) Middleware(handlers ...HandlerFunc) *Registrar` | 追加分组中间件 |
| `WithoutMiddleware` | `func (r *Registrar) WithoutMiddleware(names ...string) *Registrar` | 从分组排除指定中间件 |
| `Controller` | `func (r *Registrar) Controller(controller any) *Registrar` | 设置控制器对象，覆盖外层 |
| `Where` | `func (r *Registrar) Where(param, expr string) *Registrar` | 追加分组参数约束 |
| `ScopeBindings` | `func (r *Registrar) ScopeBindings() *Registrar` | 保留 Laravel 链式语义 |
| `WithoutScopedBindings` | `func (r *Registrar) WithoutScopedBindings() *Registrar` | 保留 Laravel 链式语义 |

### 路由注册与分组

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `Group` | `func (r *Registrar) Group(fn func())` | 执行分组闭包，闭包内路由继承当前属性 |
| `Get` | `func (r *Registrar) Get(uri string, handlers ...HandlerFunc) *Route` | 注册 GET 路由 |
| `Post` | `func (r *Registrar) Post(uri string, handlers ...HandlerFunc) *Route` | 注册 POST 路由 |
| `Put` | `func (r *Registrar) Put(uri string, handlers ...HandlerFunc) *Route` | 注册 PUT 路由 |
| `Patch` | `func (r *Registrar) Patch(uri string, handlers ...HandlerFunc) *Route` | 注册 PATCH 路由 |
| `Delete` | `func (r *Registrar) Delete(uri string, handlers ...HandlerFunc) *Route` | 注册 DELETE 路由 |
| `Options` | `func (r *Registrar) Options(uri string, handlers ...HandlerFunc) *Route` | 注册 OPTIONS 路由 |
| `Match` | `func (r *Registrar) Match(methods []string, uri string, handlers ...HandlerFunc) *Route` | 为指定方法集合注册路由 |
| `Any` | `func (r *Registrar) Any(uri string, handlers ...HandlerFunc) *Route` | 注册全方法路由 |
| `Redirect` | `func (r *Registrar) Redirect(uri, destination string, status ...int) *Route` | 注册重定向路由 |
| `PermanentRedirect` | `func (r *Registrar) PermanentRedirect(uri, destination string) *Route` | 注册 301 永久重定向 |
| `Action` | `func (r *Registrar) Action(method, uri, action string, middleware ...HandlerFunc) *Route` | 从 Controller 按方法名注册 handler |

---

## 资源路由 API 参考

### 接口

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `ResourceController` | `Index`, `Store`, `Show`, `Update`, `Destroy` | API 资源路由必须实现的 5 个方法 |
| `CreateController` | `Create` | 完整资源路由可选，提供创建页面 |
| `EditController` | `Edit` | 完整资源路由可选，提供编辑页面 |

### 注册函数

| 函数 | 签名 | 用途 |
| --- | --- | --- |
| `Resource` | `func Resource(name string, controller ResourceController, options ...ResourceOption) []*Route` | 注册完整资源路由（含 create/edit） |
| `ApiResource` | `func ApiResource(name string, controller ResourceController, options ...ResourceOption) []*Route` | 注册 API 资源路由（不含 create/edit） |
| `ApiResources` | `func ApiResources(resources map[string]ResourceController, options ...ResourceOption) []*Route` | 批量注册 API 资源路由 |

### 选项函数

| 函数 | 签名 | 用途 |
| --- | --- | --- |
| `Only` | `func Only(actions ...string) ResourceOption` | 只注册指定动作 |
| `Except` | `func Except(actions ...string) ResourceOption` | 排除指定动作 |
| `Names` | `func Names(names map[string]string) ResourceOption` | 自定义动作的路由名称 |
| `Parameters` | `func Parameters(parameters map[string]string) ResourceOption` | 自定义资源参数名 |

---

## 限流 API 参考

| 类型/函数 | 签名 | 用途 |
| --- | --- | --- |
| `Limit` | 结构体 `{Max, Every, KeyFunc}` | 描述一次限流窗口 |
| `PerMinute` | `func PerMinute(max int) Limit` | 构造每分钟限流规则 |
| `By` | `func (l Limit) By(fn func(*gin.Context) string) Limit` | 设置限流 key 的来源函数 |
| `RateLimiter` | `func RateLimiter(name string, limiter RateLimiterFunc)` | 注册命名限流器 |
| `Throttle` | `func Throttle(name string) gin.HandlerFunc` | 返回可挂载到路由/分组的限流中间件 |

---

## 全局 Facade 函数速查

| 函数 | 签名 | 用途 |
| --- | --- | --- |
| `Resolve` | `func Resolve() *Router` | 获取全局 Router 实例 |
| `Bind` | `func Bind(param string, binder Binder)` | 注册参数绑定器 |
| `Model` | `func Model(param string, binder Binder)` | `Bind` 的语义化别名 |
| `Pattern` | `func Pattern(param, expr string)` | 注册全局参数约束 |
| `Mount` | `func Mount(engine *gin.Engine) error` | 挂载路由到 Gin engine |
| `List` | `func List() []RouteInfo` | 获取路由快照 |
| `URL` | `func URL(name string, params map[string]any) (string, error)` | 生成命名路由 URL |
| `Get` | `func Get(uri string, handlers ...HandlerFunc) *Route` | 注册 GET 路由 |
| `Post` | `func Post(uri string, handlers ...HandlerFunc) *Route` | 注册 POST 路由 |
| `Put` | `func Put(uri string, handlers ...HandlerFunc) *Route` | 注册 PUT 路由 |
| `Patch` | `func Patch(uri string, handlers ...HandlerFunc) *Route` | 注册 PATCH 路由 |
| `Delete` | `func Delete(uri string, handlers ...HandlerFunc) *Route` | 注册 DELETE 路由 |
| `Options` | `func Options(uri string, handlers ...HandlerFunc) *Route` | 注册 OPTIONS 路由 |
| `Match` | `func Match(methods []string, uri string, handlers ...HandlerFunc) *Route` | 注册多方法路由 |
| `Any` | `func Any(uri string, handlers ...HandlerFunc) *Route` | 注册全方法路由 |
| `Redirect` | `func Redirect(uri, destination string, status ...int) *Route` | 注册重定向路由 |
| `PermanentRedirect` | `func PermanentRedirect(uri, destination string) *Route` | 注册 301 永久重定向 |
| `Static` | `func Static(uri, root string) *Route` | 注册静态文件路由 |
| `Fallback` | `func Fallback(handler HandlerFunc) *Route` | 注册 NoRoute 兜底 |
| `Prefix` | `func Prefix(prefix string) *Registrar` | 创建带路径前缀的声明器 |
| `Name` | `func Name(name string) *Registrar` | 创建带命名前缀的声明器 |
| `Domain` | `func Domain(domain string) *Registrar` | 创建带域名约束的声明器 |
| `Middleware` | `func Middleware(handlers ...HandlerFunc) *Registrar` | 创建带中间件的声明器 |
| `WithoutMiddleware` | `func WithoutMiddleware(names ...string) *Registrar` | 创建排除中间件的声明器 |
| `Controller` | `func Controller(controller any) *Registrar` | 创建带控制器的声明器 |
| `Group` | `func Group(fn func())` | 执行分组闭包 |
| `Resource` | `func Resource(name string, controller ResourceController, options ...ResourceOption) []*Route` | 注册完整资源路由 |
| `ApiResource` | `func ApiResource(name string, controller ResourceController, options ...ResourceOption) []*Route` | 注册 API 资源路由 |
| `ApiResources` | `func ApiResources(resources map[string]ResourceController, options ...ResourceOption) []*Route` | 批量注册 API 资源路由 |

---

## ServiceProvider

`ServiceProvider` 将 `Router` 注册到 Application Container，通过 lazy factory 在首次 `Resolve` 时创建：

```go
type ServiceProvider struct{}

func (ServiceProvider) Name() string { return "route" }
func (ServiceProvider) Register(app providerApplication) error { /* ... */ }
func (ServiceProvider) Boot(providerApplication) error { return nil }
```

- 容器绑定 key：`"route.router"`
- 如果调用方已显式注入 Router，provider 保留该实例，不覆盖。
- 支持 `container.Singleton` 语义，全局只有一个 Router 实例。

---

## 项目内推荐写法

业务路由集中放在 `routes/api.go`，基础设施路由放在 `routes/storage.go`。

**推荐模式：**

```go
route.Prefix("/api/v1").
    Middleware(middleware.AuthRequired(), tenantActive, injectPerms).
    Group(func() {
        route.Get("/prismgos",
            middleware.RequirePermission(permission.PrismgoList),
            app.PrismgoHandler.List,
        )
    })
```

**新增路由时的建议：**

- 有公共前缀就用 `Prefix` 分组，不重复手写完整路径。
- 有鉴权、租户、审计等公共逻辑就挂在分组上。
- 需要细粒度权限的业务接口，在 action 前显式追加 `RequirePermission`。
- 新写参数优先使用 `{id}`，保持与 Laravel 风格一致。
- 需要 URL 生成或外部引用的路由补充 `Name`。
- 需要参数格式限制时使用 `WhereNumber`、`WhereIn` 等约束，让非法请求在进入业务层前返回 `404`。

---

## 测试

`prismgo/route` 是通用包，修改实现后至少运行：

```powershell
go test ./prismgo/route -cover
```

如果改动影响应用装配或命令行路由列表，建议补充：

```powershell
go test ./prismgo/cmd ./prismgo/route
```