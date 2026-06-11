# Routing

- [Introduction](#introduction)
- [Quick Start](#quick-start)
- [Basic Routing](#basic-routing)
- [Route Parameters](#route-parameters)
- [Parameter Constraints](#parameter-constraints)
- [Named Routes](#named-routes)
- [Route Groups](#route-groups)
- [Middleware](#middleware)
- [Parameter Binding](#parameter-binding)
- [Controller Actions](#controller-actions)
- [Resource Routes](#resource-routes)
- [Redirect Routes](#redirect-routes)
- [Static Files](#static-files)
- [Fallback Routes](#fallback-routes)
- [Domain Constraints](#domain-constraints)
- [Rate Limiting](#rate-limiting)
- [Current Route Information](#current-route-information)
- [Route List and Debugging](#route-list-and-debugging)
- [Handler Execution Order](#handler-execution-order)
- [Global Facade Lifecycle](#global-facade-lifecycle)
- [Router API Reference](#router-api-reference)
- [Route Chain API Reference](#route-chain-api-reference)
- [Registrar API Reference](#registrar-api-reference)
- [Resource Route API Reference](#resource-route-api-reference)
- [Rate Limiting API Reference](#rate-limiting-api-reference)
- [Global Facade Function Reference](#global-facade-function-reference)
- [ServiceProvider](#serviceprovider)
- [Recommended Project Usage](#recommended-project-usage)

---

## Introduction

`prismgo/route` is a Laravel-style routing declaration library for Gin. It wraps route definitions, groups, middleware, parameter constraints, named routes, and model binding in declarative APIs, reducing repetitive prefix concatenation and middleware management when writing raw `gin.Engine` routes.

Core design principles:

- Route declarations are not bound to the HTTP server. `Router` only collects definitions; `Mount(engine)` attaches them to Gin.
- Business handlers keep the native `func(*gin.Context)` signature.
- Both a convenient global facade and isolated `Router` instances are supported.
- Route metadata is collected before mounting, enabling `route:list`, named URL generation, and resource routes.
- Cross-cutting checks such as parameter constraints, binding failures, and domain checks run at the front of the request chain.

Application routes are usually registered in `routes/api.go`, static file routes in `routes/storage.go`, and route listing support is implemented by the route command.

## Quick Start

### Using the Facade

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

func login(c *gin.Context)    {}
func showUser(c *gin.Context) {}
```

### Mounting to Gin

```go
engine := gin.New()
if err := route.Mount(engine); err != nil {
    return err
}
```

### Using an Isolated Router

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

## Basic Routing

All route registration methods return `*Route`, which can be chained with names, constraints, binding failure handlers, and other options.

```go
route.Get("/users", index)
route.Post("/users", store)
route.Put("/users/{id}", replace)
route.Patch("/users/{id}", update)
route.Delete("/users/{id}", destroy)
route.Options("/users", options)
```

Use one handler for multiple HTTP methods:

```go
route.Match([]string{"PUT", "PATCH"}, "/users/{id}", update)
```

Register all common HTTP methods:

```go
route.Any("/webhook", webhook)
```

`Any` includes `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, and `HEAD`.

## Route Parameters

Laravel-style `{name}` parameters are recommended. Native Gin `:name` parameters are also supported:

```go
route.Get("/users/{id}", showUser)
route.Get("/posts/{slug?}", showPost)
route.Get("/files/{path}", serveFile).Where("path", ".*")
route.Get("/prismgos/:id", showPrismgo)
```

Read parameters with the native Gin API:

```go
func showUser(c *gin.Context) {
    id := c.Param("id")
}
```

Optional parameters only support the `{id?}` syntax. During compilation, the router generates both the parameterized and non-parameterized Gin paths.

Wildcard parameters are created by combining `{path}` with `Where("path", ".*")`. The route is compiled to Gin's `*path` wildcard syntax and can match multiple path segments.

## Parameter Constraints

Parameter constraints run before the business handler. If a constraint fails, the router returns `404`.

```go
route.Get("/users/{id}", showUser).WhereNumber("id")
route.Get("/tags/{name}", showTag).WhereAlpha("name")
route.Get("/codes/{code}", showCode).WhereAlphaNumeric("code")
route.Get("/orders/{uuid}", showOrder).WhereUuid("uuid")
route.Get("/events/{ulid}", showEvent).WhereUlid("ulid")
route.Get("/status/{value}", showStatus).WhereIn("value", []string{"open", "closed"})
route.Get("/files/{path}", serveFile).Where("path", ".*")
```

| Method | Meaning | Parameters | Purpose |
| --- | --- | --- | --- |
| `Where(param, expr)` | Custom regex | `param string`, `expr string` | Set an arbitrary regular expression constraint |
| `WhereNumber(param)` | Number | `param string` | Require `^\d+$` |
| `WhereAlpha(param)` | Letters | `param string` | Require `^[A-Za-z]+$` |
| `WhereAlphaNumeric(param)` | Alphanumeric | `param string` | Require `^[A-Za-z0-9]+$` |
| `WhereUuid(param)` | UUID | `param string` | Require UUID v1-v5 format |
| `WhereUlid(param)` | ULID | `param string` | Require a 26-character Crockford Base32 ULID |
| `WhereIn(param, values)` | Enum | `param string`, `values []string` | Require a value from the provided set |

Group constraints apply to every route in the group that uses the same parameter name:

```go
route.Prefix("/api").Where("id", `\d+`).Group(func() {
    route.Get("/users/{id}", showUser)
    route.Get("/orders/{id}", showOrder)
})
```

Global constraints are registered with `Pattern` and apply to all routes using the same parameter name. A route-level `Where` overrides a global `Pattern`:

```go
route.Pattern("slug", `[a-z0-9-]+`)
route.Get("/posts/{slug}", showPost)
```

## Named Routes

Named routes allow URL generation without hard-coding paths.

```go
route.Get("/users/{id}", showUser).Name("users.show")

path, err := route.URL("users.show", map[string]any{"id": 100})
// path == "/users/100"
```

Parameters are encoded with `url.PathEscape`. Missing parameters return an error.

Groups may define name prefixes:

```go
route.Prefix("/admin").Name("admin.").Group(func() {
    route.Get("/users/{id}", showUser).Name("users.show")
})

path, _ := route.URL("admin.users.show", map[string]any{"id": 100})
// path == "/admin/users/100"
```

If `.Name(...)` is called multiple times on the same route, the group prefix is preserved and only the route's own suffix is replaced.

## Route Groups

Groups share path prefixes, name prefixes, middleware, domain constraints, and parameter constraints.

```go
route.Prefix("/api/v1").Group(func() {
    route.Get("/users", userIndex)
    route.Get("/users/{id}", userShow)
})
```

Chain group attributes:

```go
route.Prefix("/api/v1").
    Name("api.").
    Middleware(authMiddleware).
    Group(func() {
        route.Get("/profile", profile).Name("profile")
    })
```

Nested groups inherit all outer attributes:

```go
route.Prefix("/api").Name("api.").Group(func() {
    route.Prefix("/admin").Name("admin.").Group(func() {
        route.Get("/users", adminUsers).Name("users.index")
    })
})
```

The final route name is `api.admin.users.index`, and the path is `/api/admin/users`.

## Middleware

Group middleware applies to every route inside the group:

```go
route.Prefix("/api/v1").
    Middleware(authRequired, tenantActive).
    Group(func() {
        route.Get("/profile", profile)
    })
```

Route-level middleware is passed before the final business action. The last handler is treated as the action:

```go
route.Get("/prismgos",
    middleware.RequirePermission(permission.PrismgoList),
    app.PrismgoHandler.List,
)
```

Use `NamedMiddleware` to assign stable names, then exclude middleware by name. When a middleware is unnamed, the router falls back to the Go function name:

```go
auth := route.NamedMiddleware("auth", authRequired)

route.Middleware(auth).Group(func() {
    route.Get("/profile", profile)
    route.Get("/public-info", publicInfo).WithoutMiddleware("auth")
})
```

You can also exclude middleware while declaring the group:

```go
route.Middleware(auth).Group(func() {
    route.WithoutMiddleware("auth").Get("/callback", callback)
})
```

## Parameter Binding

Parameter binders run after route parameters are parsed and before the business handler. They convert raw parameter values into business objects and write them to `gin.Context`. This is conceptually similar to Laravel model binding.

```go
route.Bind("user", func(c *gin.Context, value string) (any, error) {
    user, err := userRepo.Find(c.Request.Context(), value)
    if err != nil {
        return nil, err
    }
    return user, nil
})
```

`Model` is a semantic alias of `Bind`:

```go
route.Model("prismgo", bindPrismgo)
```

Read the bound value in a handler:

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

When a binder returns an error, the route's `Missing` handler runs if configured. Otherwise the router returns `404`.

```go
route.Get("/users/{user}", showUser).Missing(func(c *gin.Context) {
    c.JSON(http.StatusNotFound, gin.H{"message": "user not found"})
})
```

## Controller Actions

Place a controller object on a group and register handlers by method name:

```go
type UserController struct{}

func (c *UserController) Index(ctx *gin.Context) {}
func (c *UserController) Show(ctx *gin.Context)  {}

controller := &UserController{}

users := route.Controller(controller).Prefix("/users")
users.Action(http.MethodGet, "/", "Index")
users.Action(http.MethodGet, "/{id}", "Show")
```

Controller methods must have the signature `func(*gin.Context)`. A nil controller, missing method, or invalid method signature panics so route configuration errors surface during startup.

## Resource Routes

When a controller implements `ResourceController`, `ApiResource` or `Resource` can register REST-style routes.

```go
type PhotoController struct{}

func (c *PhotoController) Index(ctx *gin.Context)   {}
func (c *PhotoController) Store(ctx *gin.Context)   {}
func (c *PhotoController) Show(ctx *gin.Context)    {}
func (c *PhotoController) Update(ctx *gin.Context)  {}
func (c *PhotoController) Destroy(ctx *gin.Context) {}

route.ApiResource("photos", &PhotoController{})
```

`ApiResource("photos", controller)` registers:

| Method | URI | Action | Name |
| --- | --- | --- | --- |
| GET | `/photos` | `Index` | `photos.index` |
| POST | `/photos` | `Store` | `photos.store` |
| GET | `/photos/{photo}` | `Show` | `photos.show` |
| PUT,PATCH | `/photos/{photo}` | `Update` | `photos.update` |
| DELETE | `/photos/{photo}` | `Destroy` | `photos.destroy` |

`Resource` additionally supports `Create` and `Edit`. Those routes are registered only when the controller implements `CreateController` or `EditController`.

```go
route.Resource("photos", &FullPhotoController{})
```

Options:

```go
route.ApiResource("photos", controller, route.Only("index", "show"))
route.ApiResource("photos", controller, route.Except("destroy"))

route.Resource("widgets", controller,
    route.Names(map[string]string{
        "index": "widgets",
        "show":  "widgets.detail",
    }),
)

route.Resource("widgets", controller,
    route.Parameters(map[string]string{
        "widgets": "widget_id",
    }),
)
```

Register multiple API resources:

```go
route.ApiResources(map[string]route.ResourceController{
    "photos": photoController,
    "posts":  postController,
})
```

Dots in resource names become path separators:

```go
route.ApiResource("users.photos", controller)
// /users/photos
// /users/photos/{photo}
```

## Redirect Routes

```go
route.Redirect("/old", "/new")
route.Redirect("/temp", "/target", http.StatusTemporaryRedirect)
route.PermanentRedirect("/old", "/new")
```

## Static Files

```go
route.Static("/assets", "./public/assets")
```

This registers `GET /assets/*filepath` and serves files through `http.Dir(root)`.

## Fallback Routes

Fallback handlers run when no route matches. This project uses a fallback route for SPA fallback: non-`/api` paths return `public/index.html`.

```go
route.Fallback(func(c *gin.Context) {
    c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
})
```

## Domain Constraints

Domain constraints check the `Host` header before the business handler. Non-matching hosts return `404`.

```go
route.Domain("api.example.test").Group(func() {
    route.Get("/health", health)
})
```

Placeholders are supported for subdomain segments:

```go
route.Domain("{tenant}.example.test").Group(func() {
    route.Get("/dashboard", dashboard)
})
```

## Rate Limiting

Register a named limiter:

```go
route.RateLimiter("login", func(c *gin.Context) []route.Limit {
    return []route.Limit{
        route.PerMinute(5).By(func(c *gin.Context) string {
            return c.ClientIP()
        }),
    }
})
```

Attach it to routes:

```go
route.Post("/auth/login", route.Throttle("login"), login)

route.Middleware(route.Throttle("api")).Group(func() {
    route.Get("/profile", profile)
})
```

Limiter state uses `github.com/prismgo/framework/cache`. If the named limiter does not exist, `Throttle` allows the request through. Over-limit requests return `429` with `{"message":"too many requests"}`.

## Current Route Information

Before the business handler runs, every mounted route writes its metadata to `gin.Context` under the key `route.current`:

```go
func handler(c *gin.Context) {
    value, ok := c.Get("route.current")
    if !ok {
        return
    }

    info := value.(route.RouteInfo)
}
```

| Field | Type | Description |
| --- | --- | --- |
| `Methods` | `[]string` | HTTP methods |
| `URI` | `string` | Original declared URI |
| `GinPath` | `string` | Compiled Gin path |
| `Name` | `string` | Route name |
| `Domain` | `string` | Domain constraint |
| `Handler` | `string` | Business handler function name |
| `Middleware` | `[]string` | Middleware names |
| `SourcePath` | `string` | Source file path of the business handler |

## Route List and Debugging

In code:

```go
routes := route.List()
for _, item := range routes {
    fmt.Println(item.Methods, item.URI, item.Name)
}
```

From the command line:

```powershell
go run ./ route:list
go run ./ route:list --path=/api/v1
go run ./ route:list --name=users
go run ./ route:list --method=POST
```

## Handler Execution Order

`Mount(engine)` attaches routes to Gin in declaration order. Each route's handler chain runs as follows:

1. Domain constraint check.
2. Parameter regex constraint check.
3. Parameter binders.
4. Group and route middleware.
5. Current route information injection.
6. Business action.

Business middleware that depends on bound objects or permission context should be placed in the route middleware stage. Parameter format validation and binding failure handling run before business middleware.

## Global Facade Lifecycle

```go
router := route.Resolve()
```

`Resolve` reads the singleton under the `"route.router"` key from the Application Container. The first call creates the `Router` through the `ServiceProvider` lazy factory.

Tests should prefer isolated routers to avoid polluting the global facade:

```go
router := route.New()
router.Get("/health", handler)
router.Reset()
```

## Router API Reference

### Constructors

| Method | Signature | Purpose |
| --- | --- | --- |
| `New` | `func New() *Router` | Create an empty router |
| `Reset` | `func (r *Router) Reset()` | Clear routes, named index, binders, and global constraints |
| `Clone` | `func (r *Router) Clone() *Router` | Deep-copy the current route table without declaration-time group scope |

### Route Registration

| Method | Signature | Purpose |
| --- | --- | --- |
| `Add` | `func (r *Router) Add(methods []string, uri string, handlers ...HandlerFunc) *Route` | Low-level registration; the last handler is the action |
| `Get` | `func (r *Router) Get(uri string, handlers ...HandlerFunc) *Route` | Register GET |
| `Post` | `func (r *Router) Post(uri string, handlers ...HandlerFunc) *Route` | Register POST |
| `Put` | `func (r *Router) Put(uri string, handlers ...HandlerFunc) *Route` | Register PUT |
| `Patch` | `func (r *Router) Patch(uri string, handlers ...HandlerFunc) *Route` | Register PATCH |
| `Delete` | `func (r *Router) Delete(uri string, handlers ...HandlerFunc) *Route` | Register DELETE |
| `Options` | `func (r *Router) Options(uri string, handlers ...HandlerFunc) *Route` | Register OPTIONS |
| `Match` | `func (r *Router) Match(methods []string, uri string, handlers ...HandlerFunc) *Route` | Register a route for selected methods |
| `Any` | `func (r *Router) Any(uri string, handlers ...HandlerFunc) *Route` | Register all common methods |

### Special Routes

| Method | Signature | Purpose |
| --- | --- | --- |
| `Redirect` | `func (r *Router) Redirect(uri, destination string, status ...int) *Route` | Register a redirect route, default `302` |
| `PermanentRedirect` | `func (r *Router) PermanentRedirect(uri, destination string) *Route` | Register a permanent `301` redirect |
| `Static` | `func (r *Router) Static(uri, root string) *Route` | Register a static file directory |
| `Fallback` | `func (r *Router) Fallback(handler HandlerFunc) *Route` | Register a NoRoute fallback |

### Declarative Entry Points

| Method | Signature | Purpose |
| --- | --- | --- |
| `Prefix` | `func (r *Router) Prefix(prefix string) *Registrar` | Create a registrar with a path prefix |
| `Name` | `func (r *Router) Name(name string) *Registrar` | Create a registrar with a name prefix |
| `Domain` | `func (r *Router) Domain(domain string) *Registrar` | Create a registrar with a domain constraint |
| `Middleware` | `func (r *Router) Middleware(handlers ...HandlerFunc) *Registrar` | Create a registrar with middleware |
| `Controller` | `func (r *Router) Controller(controller any) *Registrar` | Create a registrar with a controller |
| `Group` | `func (r *Router) Group(fn func())` | Execute a group closure directly on the router |

### Global Configuration

| Method | Signature | Purpose |
| --- | --- | --- |
| `Bind` | `func (r *Router) Bind(param string, binder Binder)` | Register a parameter binder |
| `Model` | `func (r *Router) Model(param string, binder Binder)` | Semantic alias of `Bind` |
| `Pattern` | `func (r *Router) Pattern(param, expr string)` | Register a global parameter constraint |

### Query and Mount

| Method | Signature | Purpose |
| --- | --- | --- |
| `List` | `func (r *Router) List() []RouteInfo` | Return a snapshot of all routes |
| `URL` | `func (r *Router) URL(name string, params map[string]any) (string, error)` | Generate a URL from a named route |
| `Mount` | `func (r *Router) Mount(engine *gin.Engine) error` | Attach the route table to a Gin engine |

## Route Chain API Reference

`Route` is the chainable configuration object returned by route registration methods.

| Method | Signature | Purpose |
| --- | --- | --- |
| `Name` | `func (r *Route) Name(name string) *Route` | Set the route name suffix, replacing previous calls |
| `Where` | `func (r *Route) Where(param, expr string) *Route` | Set a parameter regex constraint |
| `WhereNumber` | `func (r *Route) WhereNumber(param string) *Route` | Require a numeric parameter |
| `WhereAlpha` | `func (r *Route) WhereAlpha(param string) *Route` | Require letters only |
| `WhereAlphaNumeric` | `func (r *Route) WhereAlphaNumeric(param string) *Route` | Require letters or digits |
| `WhereUuid` | `func (r *Route) WhereUuid(param string) *Route` | Require a UUID |
| `WhereUlid` | `func (r *Route) WhereUlid(param string) *Route` | Require a ULID |
| `WhereIn` | `func (r *Route) WhereIn(param string, values []string) *Route` | Require one of the listed values |
| `Missing` | `func (r *Route) Missing(handler HandlerFunc) *Route` | Set the fallback handler for binding failure |
| `Middleware` | `func (r *Route) Middleware(handlers ...HandlerFunc) *Route` | Append route-level middleware |
| `WithoutMiddleware` | `func (r *Route) WithoutMiddleware(names ...string) *Route` | Exclude middleware by name or function name |
| `ScopeBindings` | `func (r *Route) ScopeBindings() *Route` | Preserve Laravel chain semantics; currently no side effect |
| `WithoutScopedBindings` | `func (r *Route) WithoutScopedBindings() *Route` | Preserve Laravel chain semantics; currently no side effect |

## Registrar API Reference

`Registrar` stores attributes used in chainable group declarations.

### Attribute Methods

| Method | Signature | Purpose |
| --- | --- | --- |
| `Prefix` | `func (r *Registrar) Prefix(prefix string) *Registrar` | Append a path prefix |
| `Name` | `func (r *Registrar) Name(name string) *Registrar` | Append a name prefix |
| `Domain` | `func (r *Registrar) Domain(domain string) *Registrar` | Set a domain constraint, replacing the outer value |
| `Middleware` | `func (r *Registrar) Middleware(handlers ...HandlerFunc) *Registrar` | Append group middleware |
| `WithoutMiddleware` | `func (r *Registrar) WithoutMiddleware(names ...string) *Registrar` | Exclude selected middleware from the group |
| `Controller` | `func (r *Registrar) Controller(controller any) *Registrar` | Set the controller object, replacing the outer value |
| `Where` | `func (r *Registrar) Where(param, expr string) *Registrar` | Append a group parameter constraint |
| `ScopeBindings` | `func (r *Registrar) ScopeBindings() *Registrar` | Preserve Laravel chain semantics |
| `WithoutScopedBindings` | `func (r *Registrar) WithoutScopedBindings() *Registrar` | Preserve Laravel chain semantics |

### Registration and Group Methods

| Method | Signature | Purpose |
| --- | --- | --- |
| `Group` | `func (r *Registrar) Group(fn func())` | Execute a group closure whose routes inherit current attributes |
| `Get` | `func (r *Registrar) Get(uri string, handlers ...HandlerFunc) *Route` | Register GET |
| `Post` | `func (r *Registrar) Post(uri string, handlers ...HandlerFunc) *Route` | Register POST |
| `Put` | `func (r *Registrar) Put(uri string, handlers ...HandlerFunc) *Route` | Register PUT |
| `Patch` | `func (r *Registrar) Patch(uri string, handlers ...HandlerFunc) *Route` | Register PATCH |
| `Delete` | `func (r *Registrar) Delete(uri string, handlers ...HandlerFunc) *Route` | Register DELETE |
| `Options` | `func (r *Registrar) Options(uri string, handlers ...HandlerFunc) *Route` | Register OPTIONS |
| `Match` | `func (r *Registrar) Match(methods []string, uri string, handlers ...HandlerFunc) *Route` | Register selected methods |
| `Any` | `func (r *Registrar) Any(uri string, handlers ...HandlerFunc) *Route` | Register all methods |
| `Redirect` | `func (r *Registrar) Redirect(uri, destination string, status ...int) *Route` | Register a redirect route |
| `PermanentRedirect` | `func (r *Registrar) PermanentRedirect(uri, destination string) *Route` | Register a permanent `301` redirect |
| `Action` | `func (r *Registrar) Action(method, uri, action string, middleware ...HandlerFunc) *Route` | Register a controller method by name |

## Resource Route API Reference

| Interface | Methods | Purpose |
| --- | --- | --- |
| `ResourceController` | `Index`, `Store`, `Show`, `Update`, `Destroy` | Required for API resource routes |
| `CreateController` | `Create` | Optional for full resource routes |
| `EditController` | `Edit` | Optional for full resource routes |

| Function | Signature | Purpose |
| --- | --- | --- |
| `Resource` | `func Resource(name string, controller ResourceController, options ...ResourceOption) []*Route` | Register a full resource route set |
| `ApiResource` | `func ApiResource(name string, controller ResourceController, options ...ResourceOption) []*Route` | Register API resource routes |
| `ApiResources` | `func ApiResources(resources map[string]ResourceController, options ...ResourceOption) []*Route` | Register multiple API resources |

| Option | Signature | Purpose |
| --- | --- | --- |
| `Only` | `func Only(actions ...string) ResourceOption` | Register only selected actions |
| `Except` | `func Except(actions ...string) ResourceOption` | Exclude selected actions |
| `Names` | `func Names(names map[string]string) ResourceOption` | Customize route names |
| `Parameters` | `func Parameters(parameters map[string]string) ResourceOption` | Customize resource parameter names |

## Rate Limiting API Reference

| Type / function | Signature | Purpose |
| --- | --- | --- |
| `Limit` | struct `{Max, Every, KeyFunc}` | Describe one limiter window |
| `PerMinute` | `func PerMinute(max int) Limit` | Build a per-minute limiter |
| `By` | `func (l Limit) By(fn func(*gin.Context) string) Limit` | Set the limiter key source |
| `RateLimiter` | `func RateLimiter(name string, limiter RateLimiterFunc)` | Register a named limiter |
| `Throttle` | `func Throttle(name string) gin.HandlerFunc` | Return limiter middleware for routes or groups |

## Global Facade Function Reference

| Function | Signature | Purpose |
| --- | --- | --- |
| `Resolve` | `func Resolve() *Router` | Get the global router |
| `Bind` | `func Bind(param string, binder Binder)` | Register a parameter binder |
| `Model` | `func Model(param string, binder Binder)` | Semantic alias of `Bind` |
| `Pattern` | `func Pattern(param, expr string)` | Register a global parameter constraint |
| `Mount` | `func Mount(engine *gin.Engine) error` | Mount routes to Gin |
| `List` | `func List() []RouteInfo` | Return route snapshots |
| `URL` | `func URL(name string, params map[string]any) (string, error)` | Generate a named route URL |
| `Get` | `func Get(uri string, handlers ...HandlerFunc) *Route` | Register GET |
| `Post` | `func Post(uri string, handlers ...HandlerFunc) *Route` | Register POST |
| `Put` | `func Put(uri string, handlers ...HandlerFunc) *Route` | Register PUT |
| `Patch` | `func Patch(uri string, handlers ...HandlerFunc) *Route` | Register PATCH |
| `Delete` | `func Delete(uri string, handlers ...HandlerFunc) *Route` | Register DELETE |
| `Options` | `func Options(uri string, handlers ...HandlerFunc) *Route` | Register OPTIONS |
| `Match` | `func Match(methods []string, uri string, handlers ...HandlerFunc) *Route` | Register multiple methods |
| `Any` | `func Any(uri string, handlers ...HandlerFunc) *Route` | Register all methods |
| `Redirect` | `func Redirect(uri, destination string, status ...int) *Route` | Register a redirect |
| `PermanentRedirect` | `func PermanentRedirect(uri, destination string) *Route` | Register a permanent redirect |
| `Static` | `func Static(uri, root string) *Route` | Register static files |
| `Fallback` | `func Fallback(handler HandlerFunc) *Route` | Register a NoRoute fallback |
| `Prefix` | `func Prefix(prefix string) *Registrar` | Create a prefix registrar |
| `Name` | `func Name(name string) *Registrar` | Create a name-prefix registrar |
| `Domain` | `func Domain(domain string) *Registrar` | Create a domain registrar |
| `Middleware` | `func Middleware(handlers ...HandlerFunc) *Registrar` | Create a middleware registrar |
| `WithoutMiddleware` | `func WithoutMiddleware(names ...string) *Registrar` | Create a registrar excluding middleware |
| `Controller` | `func Controller(controller any) *Registrar` | Create a controller registrar |
| `Group` | `func Group(fn func())` | Execute a group closure |
| `Resource` | `func Resource(name string, controller ResourceController, options ...ResourceOption) []*Route` | Register full resource routes |
| `ApiResource` | `func ApiResource(name string, controller ResourceController, options ...ResourceOption) []*Route` | Register API resource routes |
| `ApiResources` | `func ApiResources(resources map[string]ResourceController, options ...ResourceOption) []*Route` | Register multiple API resources |

## ServiceProvider

`ServiceProvider` registers `Router` in the Application Container and creates it lazily on first `Resolve`:

```go
type ServiceProvider struct{}

func (ServiceProvider) Name() string { return "route" }
func (ServiceProvider) Register(app providerApplication) error { /* ... */ }
func (ServiceProvider) Boot(providerApplication) error { return nil }
```

- Container binding key: `"route.router"`.
- If the caller has explicitly injected a Router, the provider keeps it.
- The binding uses singleton semantics, so there is one global Router instance.

## Recommended Project Usage

Business routes should live in `routes/api.go`; infrastructure routes should live in `routes/storage.go`.

Recommended pattern:

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

Recommendations for new routes:

- Use `Prefix` groups when routes share a common prefix.
- Put shared authentication, tenant, audit, and similar logic on groups.
- Add fine-grained permission middleware explicitly before the action.
- Prefer `{id}` syntax for new parameters to stay consistent with Laravel-style routes.
- Add `Name` when a route needs URL generation or external references.
- Use constraints such as `WhereNumber` and `WhereIn` so invalid requests return `404` before entering the business layer.
