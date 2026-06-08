# Session

- [简介](#简介)
- [配置](#配置)
  - [配置文件](#配置文件)
  - [驱动前置条件](#驱动前置条件)
  - [配置参数](#配置参数)
- [Session 使用](#session-使用)
  - [中间件](#中间件)
  - [读取数据](#读取数据)
  - [写入数据](#写入数据)
  - [Flash 临时数据](#flash-临时数据)
  - [删除数据](#删除数据)
  - [Session ID 再生成](#session-id-再生成)
- [Session 阻塞](#session-阻塞)
- [Cookie 处理](#cookie-处理)
- [加密](#加密)
- [自定义 Session Driver](#自定义-session-driver)
  - [实现 Driver](#实现-driver)
  - [注册 Driver](#注册-driver)
- [错误常量](#错误常量)
- [与 Laravel Session 的对应关系](#与-laravel-session-的对应关系)

---

## 简介

由于 HTTP 驱动的应用是无状态的，Session 提供了一种在多个请求之间保存用户信息的方式。PrismGo 的 session 组件提供 Laravel 风格的服务端 Session 能力。客户端 Cookie 只保存不透明的 session ID，真正的业务数据保存在服务端 driver 中。当前默认 driver 为 `file`，数据落在 `storage/framework/sessions`。

Session 系统使用 `Manager` 编排 session 生命周期（启动、恢复、保存），使用 `Store` 提供单次请求的读写操作，并提供包级 facade 函数供 Gin handler 快速使用。所有与 driver 交互的操作都显式接收 `context.Context`。

## 配置

### 配置文件

Session 配置注册在 `config/session.go` 中，你可以通过环境变量覆盖任何参数：

```go
// config/session.go
func init() {
    config.Add("session", func() map[string]interface{} {
        return map[string]interface{}{
            "driver":          config.Env("SESSION_DRIVER", "file"),
            "lifetime":        config.Env("SESSION_LIFETIME", 120),
            "expire_on_close": config.Env("SESSION_EXPIRE_ON_CLOSE", false),
            "encrypt":         config.Env("SESSION_ENCRYPT", false),
            "encoding":        config.Env("SESSION_ENCODING", ""),
            "connection":      config.Env("SESSION_CONNECTION", "default"),
            "prefix":          config.Env("SESSION_PREFIX", "prismgo_session"),
            "cookie":          config.Env("SESSION_COOKIE", "prismgo_session"),
            "path":            config.Env("SESSION_PATH", "/"),
            "domain":          config.Env("SESSION_DOMAIN", ""),
            "secure":          config.Env("SESSION_SECURE_COOKIE", false),
            "http_only":       config.Env("SESSION_HTTP_ONLY", true),
            "same_site":       config.Env("SESSION_SAME_SITE", "lax"),
            "files":           config.Env("SESSION_FILES", "storage/framework/sessions"),
            "lock_seconds":    config.Env("SESSION_LOCK_SECONDS", 10),
            "lock_wait":       config.Env("SESSION_LOCK_WAIT_SECONDS", 10),
        }
    })
}
```

### 驱动前置条件

#### File

无需额外依赖。Session 以独立文件存储在 `storage/framework/sessions` 目录下，每个 session ID 对应一个文件。请确保应用进程对该目录有读写权限。适用于本地开发和单实例部署。

#### Redis

需要 `prismgo/redis` 包已注册连接池。通过 `SESSION_CONNECTION` 环境变量指定命名连接（默认 `"default"`）。连接池配置在 `config/redis.go` 中管理。推荐在多实例部署、需要跨进程共享 session 数据的场景下使用。

### 配置参数

#### 顶层配置

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `session.driver` | `SESSION_DRIVER` | `"file"` | Session 持久化 driver 名称。内置 driver：`file`、`redis` |
| `session.lifetime` | `SESSION_LIFETIME` | `120` | 服务端 session 有效期，单位分钟 |
| `session.expire_on_close` | `SESSION_EXPIRE_ON_CLOSE` | `false` | 为 `true` 时浏览器 Cookie 省略 `Expires` 和 `Max-Age`，变为会话 Cookie |
| `session.encrypt` | `SESSION_ENCRYPT` | `false` | 为 `true` 时对服务端 payload 加密后落盘，不影响 session ID Cookie |
| `session.encoding` | `SESSION_ENCODING` | `""`（继承 `encoding.default`） | Payload 编码方式：`msgpack` 或 `json` |

#### Cookie 配置

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `session.cookie` | `SESSION_COOKIE` | `"prismgo_session"` | 保存 session ID 的 Cookie 名称 |
| `session.path` | `SESSION_PATH` | `"/"` | Cookie 的 `Path` 属性 |
| `session.domain` | `SESSION_DOMAIN` | `""` | Cookie 的 `Domain` 属性 |
| `session.secure` | `SESSION_SECURE_COOKIE` | `false` | 是否只允许 HTTPS 发送 Cookie |
| `session.http_only` | `SESSION_HTTP_ONLY` | `true` | 是否禁止 JavaScript 读取 Cookie |
| `session.same_site` | `SESSION_SAME_SITE` | `"lax"` | Cookie 的 `SameSite` 属性，可取 `lax`、`strict`、`none` |

#### File Driver 配置

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `session.files` | `SESSION_FILES` | `"storage/framework/sessions"` | File driver 的 session 文件存储目录 |

#### Redis Driver 配置

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `session.connection` | `SESSION_CONNECTION` | `"default"` | Redis 连接池名称 |
| `session.prefix` | `SESSION_PREFIX` | `"prismgo_session"` | Redis session key 前缀，与 cache key 隔离 |

#### 锁配置

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `session.lock_seconds` | `SESSION_LOCK_SECONDS` | `10` | 同 session ID 独占锁最大持有时间，单位秒 |
| `session.lock_wait` | `SESSION_LOCK_WAIT_SECONDS` | `10` | 获取同 session ID 独占锁的最大等待时间，单位秒 |

也可以在代码中显式构造配置：

```go
cfg := session.DefaultConfig()
cfg.Lifetime = 30 * time.Minute
cfg.Cookie.Name = "admin_session"
cfg.Cookie.Secure = true
cfg.Cookie.SameSite = "lax"
cfg.Files = "storage/framework/admin_sessions"

manager, err := session.NewManager(cfg, nil)
if err != nil {
    return err
}
```

## Session 使用

### 中间件

`StartSession` 中间件处理请求的完整 session 生命周期。在需要 session 的路由组上挂载它：

```go
package routes

import (
    "net/http"

    "github.com/gin-gonic/gin"
    httpkit "github.com/prismgo/framework/http"
    "github.com/prismgo/framework/http/middleware"
    "github.com/prismgo/framework/route"
    "github.com/prismgo/framework/session"
)

func RegisterWebRoutes() {
    route.Prefix("/web").
        Middleware(middleware.StartSession()).
        Group(func() {
            route.Get("/profile", profile)
            route.Post("/profile", updateProfile)
        })
}

func profile(c *gin.Context) {
    userID := session.Get(c, "user_id", int64(0))
    notice := session.Pull(c, "notice", "")

    httpkit.Ok(c, gin.H{
        "user_id": userID,
        "notice":  notice,
    })
}

func updateProfile(c *gin.Context) {
    _ = session.Put(c, "user_id", int64(1001))
    _ = session.Flash(c, "notice", "资料已保存")

    c.Status(http.StatusNoContent)
}
```

中间件执行流程：

1. 从请求 Cookie 读取 session ID。
2. 调用 `Manager.Start` 恢复服务端 payload；缺失、过期、损坏或 ID 非法时创建新 Store。
3. 把 `*session.Store` 写入 `gin.Context`，后续 handler 可通过 `StoreFrom` 或包级快捷函数使用。
4. 同时创建 `prismgo/cookie` 请求级队列，允许业务在同一中间件链里排队普通 Cookie。
5. handler 执行结束后自动保存 session。
6. 写出 session ID Cookie，再 flush 普通 Cookie 队列。
7. 最后提交业务响应。

> **注意**：中间件会缓冲响应头和响应体，目的是保证 handler 返回后还能写入 `Set-Cookie`。因此它不适合 SSE、下载流、长连接等需要边写边 flush 的路由。

#### 使用自定义 Manager

`WithManager` 选项允许向中间件注入指定的 `Manager`，适用于测试、隔离配置或特殊路由组：

```go
cfg := session.DefaultConfig()
cfg.Cookie.Name = "admin_session"
cfg.Files = "storage/framework/admin_sessions"

manager, err := session.NewManager(cfg, nil)
if err != nil {
    return err
}

route.Prefix("/admin").
    Middleware(middleware.StartSession(session.WithManager(manager))).
    Group(func() {
        route.Get("/dashboard", dashboard)
    })
```

如果不传 `WithManager`，中间件使用 `session.Default()`。应用正常启动后，默认 manager 由 facade 懒加载工厂创建。

### 读取数据

#### 基本读取

`Get` 读取 session 中的值。key 不存在时返回第一个默认值；没有默认值时返回 `nil`：

```go
name := session.Get(c, "name", "guest").(string)
```

#### 读取所有 Session 数据

`All` 返回所有 session 值的浅拷贝。修改返回的 map 不会影响 Store：

```go
store, ok := session.StoreFrom(c)
if ok {
    values := store.All()
}
```

#### 读取部分 Session 数据

`Only` 和 `Except` 方法用于获取 session 数据的子集：

```go
store, _ := session.StoreFrom(c)
profile := store.Only("user_id", "nickname", "avatar")
safeValues := store.Except("csrf_token", "notice")
```

#### 判断 Session 中是否存在某个 Key

`Has` 方法在 key 存在且值不为 `nil` 时返回 `true`：

```go
if session.Has(c, "user_id") {
    // key 存在且值非 nil
}
```

`Exists` 方法在 key 存在时返回 `true`，即使值为 `nil`：

```go
if session.Exists(c, "draft") {
    // key 存在（值可能为 nil）
}
```

`Missing` 方法在 key 不存在时返回 `true`：

```go
if session.Missing(c, "csrf_token") {
    _ = session.Put(c, "csrf_token", newToken())
}
```

### 写入数据

#### 基本写入

`Put` 向 session 写入值。值需要能被底层 driver 序列化；file driver 使用 JSON，因此推荐保存字符串、数字、布尔、数组、map 或简单结构体：

```go
_ = session.Put(c, "user_id", int64(1001))
_ = session.Put(c, "filters", map[string]any{
    "status": "open",
    "page":   1,
})
```

#### 递增与递减 Session 值

如果 session 数据中包含需要递增或递减的整数，可以使用 `Increment` 和 `Decrement` 方法：

```go
store, _ := session.StoreFrom(c)
count, err := store.Increment("retry_count")
if err != nil {
    return err
}

remaining, err := store.Decrement("quota", 2)
if err != nil {
    return err
}
```

只接受整数语义的值，非数值或小数会返回错误。

### Flash 临时数据

有时你可能希望只在下一次请求中存储数据。Flash 数据主要用于短生命周期的状态消息，如表单提交后的提示。

Flash 数据生命周期：

- `Flash` 写入后，当前请求可读。
- 下一次请求仍可读。
- 再下一次请求自动清理，除非调用 `Keep` 或 `Reflash`。

#### `Flash(key string, value any)`

写入当前请求和下一次请求都可读的临时值：

```go
_ = session.Flash(c, "status", "操作成功！")
```

#### `Now(key string, value any)`

写入仅当前请求可读的临时值，保存时会被清理：

```go
_ = session.Now(c, "preview_error", "仅本次请求展示")
```

#### `Reflash()`

延长所有当前 flash 数据一个请求周期：

```go
if shouldRedirectAgain {
    _ = session.Reflash(c)
}
```

#### `Keep(keys ...string)`

只延长指定 flash key 一个请求周期：

```go
_ = session.Keep(c, "status")
```

### 删除数据

#### `Forget(keys ...string)`

从 session 中删除一个或多个 key：

```go
_ = session.Forget(c, "draft", "notice")
```

#### `Flush()`

清空当前 session 的所有业务数据和 flash 元数据，但不换发 session ID：

```go
_ = session.Flush(c)
```

> 如果是退出登录或安全边界切换，优先使用 `Invalidate`，因为它会同时换发 session ID。

#### `Pull(key string, def ...any) any`

读取后立即删除，适合一次性提示、跳转状态、临时草稿：

```go
notice := session.Pull(c, "notice", "")
```

如果被删除的 key 是 flash 数据，也会同步清理 flash 元数据。

### Session ID 再生成

再生成 session ID 通常用于防止[会话固定攻击](https://owasp.org/www-community/attacks/Session_fixation)。

#### `Regenerate(ctx context.Context) error`

换发新的 session ID，并保留当前所有业务数据。旧 ID 会交给 driver 销毁。典型场景：登录成功后：

```go
func login(c *gin.Context) {
    // 校验账号密码成功后
    _ = session.Put(c, "user_id", int64(1001))

    if err := session.Regenerate(c); err != nil {
        httpkit.Fail(c, err)
        return
    }

    httpkit.Ok(c, gin.H{"ok": true})
}
```

#### `Invalidate(ctx context.Context) error`

清空当前 session 数据并换发 session ID，一步完成。典型场景：退出登录、切换身份、检测到风险状态：

```go
func logout(c *gin.Context) {
    if err := session.Invalidate(c); err != nil {
        httpkit.Fail(c, err)
        return
    }

    c.Status(http.StatusNoContent)
}
```

## Session 阻塞

默认情况下，PrismGo 允许使用同一 session 的请求并发执行。对于大多数应用来说这没有问题；但当并发请求同时写入 session 数据时，可能会发生数据丢失。

为了缓解这个问题，PrismGo 的 session 系统在 driver 实现 `Locker` 接口时，会对同一 session ID 加独占锁。内置的 `file` 和 `redis` driver 均支持锁。

锁行为由两个配置参数控制：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `SESSION_LOCK_SECONDS` | `10` | 同 session ID 独占锁最大持有时间，超时后自动释放 |
| `SESSION_LOCK_WAIT_SECONDS` | `10` | 获取独占锁的最大等待时间，超时返回 `ErrLockTimeout` |

**File driver 锁**：使用 `O_CREATE|O_EXCL` 创建锁文件并写入随机 token。检测到过期锁（mtime 超过 TTL）时先删除再重试。以 10ms 间隔轮询。

**Redis driver 锁**：使用 `SET NX PX`（仅在 key 不存在时设置，带毫秒级 TTL）。释放时通过 Lua 脚本校验 owner token 后再删除，防止 TTL 过期后误删其他请求的锁。以 10ms 间隔轮询。

## Cookie 处理

`StartSession` 中间件会写出 session ID Cookie，Cookie 属性来自 session 配置：

- `Name` — 承载不透明 session ID 的 Cookie 键名
- `Path` — Cookie 作用路径
- `Domain` — Cookie 域名
- `Secure` — 是否仅限 HTTPS 传输
- `HTTPOnly` — 是否禁止 JavaScript 读取
- `SameSite` — `lax`、`strict` 或 `none`
- `Expires` / `Max-Age` — 由 `SESSION_LIFETIME` 推算

如果 `SESSION_EXPIRE_ON_CLOSE=true`，浏览器 Cookie 不写 `Expires` 和 `Max-Age`（变为会话 Cookie），但服务端 payload 仍按 `SESSION_LIFETIME` 过期。

中间件也会安装 `prismgo/cookie` 的请求级队列。业务可以在同一请求中排队普通 Cookie，session 保存后统一 flush：

```go
import cookiepkg "github.com/prismgo/framework/cookie"

func rememberLocale(c *gin.Context) {
    if _, err := cookiepkg.QueueMakeFrom(c, "locale", "zh-CN", 60*24,
        cookiepkg.Path("/"),
        cookiepkg.HTTPOnly(false),
        cookiepkg.SameSite(cookiepkg.SameSiteLax),
    ); err != nil {
        httpkit.Fail(c, err)
        return
    }

    c.Status(http.StatusNoContent)
}
```

> Session ID Cookie 和普通 Cookie 队列是两个概念：前者只保存 session ID，由 session manager 写出；后者由业务显式排队。由于 `StartSession` 已包含 Cookie 队列能力，不要在同一路由组上再添加 `QueuedCookies()` 中间件。

## 加密

`SESSION_ENCRYPT=true` 控制服务端 payload 加密，不影响客户端 session ID Cookie。

加密扩展点是 `Encryptor` 接口：

```go
type Encryptor interface {
    Encrypt(ctx context.Context, plaintext []byte) ([]byte, error)
    Decrypt(ctx context.Context, ciphertext []byte) ([]byte, error)
}
```

默认使用 `NopEncryptor`，直接复制并返回输入字节，不做任何转换。使用自定义加密器：

```go
type AppEncryptor struct{}

func (AppEncryptor) Encrypt(ctx context.Context, plaintext []byte) ([]byte, error) {
    return encryptWithAppKey(ctx, plaintext)
}

func (AppEncryptor) Decrypt(ctx context.Context, ciphertext []byte) ([]byte, error) {
    return decryptWithAppKey(ctx, ciphertext)
}

cfg := session.DefaultConfig()
cfg.Encrypt = true
cfg.Encryptor = AppEncryptor{}

manager, err := session.NewManager(cfg, nil)
if err != nil {
    return err
}
```

加密或解密失败会被包装为脱敏错误 `SensitiveError`，其 `Error()` 方法只输出操作名称，不会泄露 payload 内容、密文或明文片段。

## 自定义 Session Driver

### 实现 Driver

如果内置 driver 都不满足需求，你可以编写自己的 session driver。自定义 driver 必须实现 `Driver` 接口：

```go
type Driver interface {
    Read(ctx context.Context, id string) (session.Payload, error)
    Write(ctx context.Context, id string, payload session.Payload, expiresAt *time.Time) error
    Destroy(ctx context.Context, id string) error
    GC(ctx context.Context, before time.Time) error
}
```

方法语义：

- `Read` — 按 session ID 读取 payload。
- `Write` — 写入 payload，使用 `expiresAt` 保存服务端过期时间。
- `Destroy` — 销毁指定 session ID 的记录。
- `GC` — 清理指定时间点之前过期的 session。

如需支持 session 阻塞，可选实现 `Locker` 接口：

```go
type Locker interface {
    Lock(ctx context.Context, id string, ttl time.Duration, wait time.Duration) (session.Lock, error)
}
```

已获取锁的 `Lock` 接口：

```go
type Lock interface {
    Release(ctx context.Context) error
}
```

### 注册 Driver

使用 `session.Extend` 注册命名 driver 工厂。注册必须在 session manager 首次解析 driver 之前完成：

```go
func init() {
    session.Extend("memory", func(cfg session.Config) (session.Driver, error) {
        return NewMemoryDriver(cfg), nil
    })
}
```

启用方式：

```env
SESSION_DRIVER=memory
```

或者显式构造 Manager：

```go
cfg := session.DefaultConfig()
cfg.Driver = "memory"

manager, err := session.NewManager(cfg, nil)
if err != nil {
    return err
}
```

> 重复注册同名 driver 时后注册工厂会覆盖前注册工厂；空名称或 nil 工厂会被忽略；未知 driver 会返回 `ErrDriverNotFound`。

## 错误常量

| 错误常量 | 说明 |
| --- | --- |
| `ErrInvalidConfig` | 配置非法、缺少 Store、Manager/driver 为空等 |
| `ErrDriverNotFound` | 指定 driver 未注册 |
| `ErrInvalidSessionID` | 请求携带的 session ID 格式不合法 |
| `ErrSessionNotFound` | 持久化层没有找到记录 |
| `ErrSessionExpired` | Session 已超过服务端有效期 |
| `ErrPayloadMalformed` | Payload 字段结构不符合约定 |
| `ErrPayloadSerialize` | 写入前序列化失败 |
| `ErrPayloadDeserialize` | 读取后反序列化失败 |
| `ErrEncryptionFailed` | Payload 加密失败 |
| `ErrDecryptionFailed` | Payload 解密失败 |
| `ErrLockTimeout` | 等待同 session ID 独占锁超时 |
| `ErrLockNotHeld` | 释放锁时当前调用方不再持有该锁 |

Manager 会把以下读取错误视为可恢复，并创建新 session：

- `ErrSessionNotFound`
- `ErrSessionExpired`
- `ErrPayloadMalformed`
- `ErrPayloadDeserialize`
- `ErrDecryptionFailed`
- `ErrInvalidSessionID`

## 与 Laravel Session 的对应关系

| Laravel 方法 | PrismGo 对应 |
| --- | --- |
| `$request->session()->get('key', 'default')` | `session.Get(c, "key", "default")` |
| `$request->session()->all()` | `store.All()` |
| `$request->session()->only(['key'])` | `store.Only("key")` |
| `$request->session()->except(['key'])` | `store.Except("key")` |
| `$request->session()->has('key')` | `session.Has(c, "key")` |
| `$request->session()->exists('key')` | `session.Exists(c, "key")` |
| `$request->session()->missing('key')` | `session.Missing(c, "key")` |
| `$request->session()->put('key', 'value')` | `session.Put(c, "key", "value")` |
| `$request->session()->increment('key')` | `store.Increment("key")` |
| `$request->session()->decrement('key')` | `store.Decrement("key")` |
| `$request->session()->flash('key', 'value')` | `session.Flash(c, "key", "value")` |
| `$request->session()->now('key', 'value')` | `session.Now(c, "key", "value")` |
| `$request->session()->reflash()` | `session.Reflash(c)` |
| `$request->session()->keep(['key'])` | `session.Keep(c, "key")` |
| `$request->session()->pull('key', 'default')` | `session.Pull(c, "key", "default")` |
| `$request->session()->forget('key')` | `session.Forget(c, "key")` |
| `$request->session()->flush()` | `session.Flush(c)` |
| `$request->session()->regenerate()` | `session.Regenerate(c)` |
| `$request->session()->invalidate()` | `session.Invalidate(c)` |
| `Route::get('/profile', ...)->block(10, 10)` | `SESSION_LOCK_SECONDS=10` + `SESSION_LOCK_WAIT_SECONDS=10` |
| `Session::extend($name, $factory)` | `session.Extend(name, factory)` |
