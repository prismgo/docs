# Cookie

- [简介](#简介)
- [配置](#配置)
  - [默认值](#默认值)
  - [服务提供者](#服务提供者)
  - [中间件](#中间件)
- [创建 Cookie](#创建-cookie)
  - [基础创建](#基础创建)
  - [长期 Cookie](#长期-cookie)
  - [构造参数与选项](#构造参数与选项)
  - [显式过期时间与 Max-Age](#显式过期时间与-max-age)
- [写入响应](#写入响应)
  - [直接附加到响应](#直接附加到响应)
  - [Attach 选项](#attach-选项)
- [请求级 Cookie 队列](#请求级-cookie-队列)
  - [排队 Cookie](#排队-cookie)
  - [查询已排队 Cookie](#查询已排队-cookie)
  - [移除排队项](#移除排队项)
  - [请求级 vs 进程级 API](#请求级-vs-进程级-api)
- [读取请求 Cookie](#读取请求-cookie)
  - [基础读取](#基础读取)
  - [带安全扩展读取](#带安全扩展读取)
- [删除 Cookie](#删除-cookie)
- [SameSite 策略](#samesite-策略)
- [签名与加密](#签名与加密)
  - [安全契约接口](#安全契约接口)
  - [写出与读取顺序](#写出与读取顺序)
  - [默认透传实现](#默认透传实现)
  - [错误脱敏](#错误脱敏)
- [错误常量](#错误常量)
- [与 Laravel Cookie 的对应关系](#与-laravel-cookie-的对应关系)

---

## 简介

`prismgo/cookie` 提供 Laravel 风格的 HTTP Cookie 创建、读取、排队、过期和删除能力。它面向框架层使用，默认保持 Go 的显式错误返回，同时保留 Laravel 文档中的 `Make`、`Forever`、`Queue`、`Expire`、`Forget` 等核心概念。

核心设计思路：

- **值对象分离**：`Cookie` 是纯值对象，创建时不写入响应，可在 middleware 结束前统一排队和去重。
- **请求级队列**：Gin 请求内通过 `QueueMakeFrom` 等请求级 API 声明 cookie 变更，由 `QueuedCookies` 中间件在响应结束前统一写出，避免 controller/service 直接操作响应头。
- **作用域去重**：队列按 `name/path/domain` 三元组去重，同一作用域后入覆盖先入，与浏览器匹配 cookie 的行为一致。
- **安全扩展点**：签名（`Signer`）和加密（`Encryptor`）作为可选依赖注入，默认透传，业务可按需接入真实实现。

## 配置

### 默认值

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `Path` | `/` | 站点全部路径可见 |
| `HTTPOnly` | `true` | 默认禁止客户端脚本读取 |
| `Secure` | `false` | 需要 HTTPS 时显式开启 |
| `SameSite` | 默认模式 | 不额外写出 SameSite 属性 |
| `ForeverMinutes` | `2628000` | 长期 cookie 的过期分钟数，约五年 |

### 服务提供者

`cookie.ServiceProvider` 作为框架默认 provider 注册，在 `Register` 阶段向容器绑定 `cookie.queue` 的懒加载单例工厂。请求级队列由中间件在请求生命周期内创建，不依赖此单例。

```go
// prismgo/provider/provider.go 中注册
cookiepkg.ServiceProvider{}
```

### 中间件

#### QueuedCookies

`prismgo/http/middleware.QueuedCookies()` 为每个 Gin 请求安装请求级 cookie 队列，在 handler 执行完毕后统一将排队的 cookie 写入响应。

```go
engine.Use(middleware.QueuedCookies())
```

工作流程：

1. 请求开始时创建 `cookie.Queue` 实例并存入 `gin.Context`（键为 `cookie.QueueKey`）。
2. 业务代码通过 `QueueMakeFrom`、`QueueForgetFrom` 等 API 声明 cookie 变更。
3. Handler 执行完毕后，中间件调用 `queue.Flush(w)` 将所有排队的 cookie 写入响应。
4. 如果 Flush 失败，响应状态码设为 500 并中止请求。

> **注意**：`StartSession` 中间件内部也会安装同一条 cookie 队列，因此使用 `StartSession` 时无需再单独挂载 `QueuedCookies`。

## 创建 Cookie

`New` 和 `Make` 只创建值对象，不会写入响应。

### 基础创建

```go
c := cookie.New("theme", "dark", 60*24,
    cookie.Path("/"),
    cookie.Domain("example.com"),
    cookie.HTTPOnly(true),
    cookie.Secure(true),
    cookie.SameSite(cookie.SameSiteStrict),
)
```

`Make` 是 `New` 的 Laravel 风格别名：

```go
c := cookie.Make("locale", "zh-CN", 60*24*30,
    cookie.SameSite(cookie.SameSiteLax),
)
```

### 长期 Cookie

`Forever` 创建过期时长约五年的 cookie，适用于"记住我"、设备标识等长期状态：

```go
c := cookie.Forever("device_id", "device-token")
```

### 构造参数与选项

| 参数/选项 | 用途 | 典型值 |
| --- | --- | --- |
| `name` | 浏览器保存的 cookie 名称，必须符合 HTTP token 规则 | `tenant_session` |
| `value` | 写入浏览器的原始值；启用安全扩展后会被加密/签名 | session ID、偏好值、一次性 token |
| `minutes` | 相对过期分钟数；`0` 表示不设置相对过期 | `120`、`60*24*30` |
| `Path("/")` | 浏览器路径作用域；删除时必须与创建时一致 | `/`、`/admin` |
| `Domain("example.com")` | 浏览器域名作用域；空值表示当前 host | `example.com`、`.example.com` |
| `HTTPOnly(true)` | 禁止 JavaScript 读取，认证类 cookie 应保持开启 | 默认 `true` |
| `Secure(true)` | 只在 HTTPS 下发送，生产认证类 cookie 应开启 | `true` |
| `SameSite(...)` | 控制跨站请求是否携带 cookie | `SameSiteLax`、`SameSiteNone` |
| `Raw(true)` | 让 `net/http` 按原始值写出，不进行 URL 编码 | 仅兼容遗留值格式时使用 |
| `ExpiresAt(t)` | 显式过期时间，优先于 `minutes` 生成的过期时间 | 下载 token 固定失效时间 |
| `MaxAge(seconds)` | 显式 `Max-Age` 秒数；负数用于删除 | `900`、`-1` |
| `ScopeOption(scope)` | 将可复用的 `Scope`（Path + Domain）应用到 cookie | 批量创建同作用域 cookie |

### 显式过期时间与 Max-Age

当需要精确控制过期行为时，可以使用 `ExpiresAt` 或 `MaxAge` 替代 `minutes`：

```go
c := cookie.Make("download_token", "token", 0,
    cookie.ExpiresAt(time.Now().Add(15*time.Minute)),
    cookie.MaxAge(15*60),
)
```

> `ExpiresAt` 和 `MaxAge` 同时设置时，两者都会写入 `Set-Cookie` 头。浏览器优先使用 `Max-Age`。

## 写入响应

### 直接附加到响应

`Attach` 将 `Cookie` 转换为 `net/http.Cookie` 并调用 `http.SetCookie` 写入响应：

```go
if err := cookie.Make("notice", "read", 30).Attach(w); err != nil {
    return err
}
```

也可以使用包级 `Attach` 函数：

```go
if err := cookie.Attach(w, c); err != nil {
    return err
}
```

非法 cookie 名称会返回 `cookie.ErrInvalidCookieName`，不会写出无效的 `Set-Cookie` 头。

### Attach 选项

| 选项 | 用途 |
| --- | --- |
| `WithContext(ctx)` | 把请求上下文传给签名器或加密器，用于 trace、tenant key 或超时控制 |
| `WithSigner(signer)` | 写出前对 cookie 值签名，读取时必须用匹配的 `RequestWithSigner` 验签 |
| `WithEncryptor(encryptor)` | 写出前加密 cookie 值，读取时必须用匹配的 `RequestWithEncryptor` 解密 |
| `WithNow(now)` | 固定相对过期时间计算使用的当前时间，常用于测试或需要同一业务时间点的写出 |

## 请求级 Cookie 队列

请求级队列适合业务代码先声明 cookie 变更，再由框架中间件统一写出。这是 Gin HTTP 请求中的推荐方式。

### 排队 Cookie

```go
// 创建普通 cookie 并排队
_, err := cookie.QueueMakeFrom(c, "tenant_session", "session-token", 120,
    cookie.Secure(true),
    cookie.SameSite(cookie.SameSiteLax),
)
if err != nil {
    c.JSON(http.StatusInternalServerError, gin.H{"message": "cookie queue not available"})
    return
}

// 创建长期 cookie 并排队
_, err = cookie.QueueForeverFrom(c, "remember_web", token,
    cookie.Secure(true),
    cookie.SameSite(cookie.SameSiteLax),
)

// 将已构造好的 Cookie 值对象排队
cookie.QueueCookieFrom(c, myCookie)
```

### 查询已排队 Cookie

```go
queued, ok, err := cookie.QueuedFrom(c, "remember_web")
if err != nil {
    return err
}
if ok {
    // queued 是 cookie.Cookie 值对象
    _ = queued.Name
}

// 只判断是否存在
exists, err := cookie.HasQueuedFrom(c, "remember_web")
```

查询时可指定作用域，用于区分同名但不同 path/domain 的 cookie：

```go
queued, ok, err := cookie.QueuedFrom(c, "session",
    cookie.Scope{Path: "/admin", Domain: "example.com"},
)
```

### 移除排队项

移除尚未写出的队列项，常用于条件性取消 cookie：

```go
if err := cookie.UnqueueFrom(c, "notice"); err != nil {
    return err
}
```

### 请求级 vs 进程级 API

| 场景 | 推荐接口 | 说明 |
| --- | --- | --- |
| Gin HTTP 请求中声明 cookie 变更 | `QueueMakeFrom` / `QueueForgetFrom` 等 `*From` API | 借助请求级队列，middleware 结束时统一写出 |
| 普通 `net/http` handler 中立即写 cookie | `cookie.Make(...).Attach(w)` | 直接追加 `Set-Cookie` 响应头 |
| 测试或非 Web 程序模拟队列 | `QueueMake` / `Queued` / `Unqueue` | 使用进程级默认队列；不要作为 Web 请求状态容器 |

请求级 API 列表：

| 接口 | 用途 |
| --- | --- |
| `QueueCookieFrom(c, cookie)` | 把已构造好的 `Cookie` 值对象放入当前请求队列 |
| `QueueMakeFrom(c, name, value, minutes, opts...)` | 创建普通 cookie 并放入当前请求队列 |
| `QueueForeverFrom(c, name, value, opts...)` | 创建长期 cookie 并放入当前请求队列 |
| `QueueExpireFrom(c, name, opts...)` | 创建过期 cookie 并放入当前请求队列 |
| `QueueForgetFrom(c, name, opts...)` | `QueueExpireFrom` 的 Laravel 语义别名 |
| `QueuedFrom(c, name, scope...)` | 查看当前请求是否已排队某个 cookie |
| `HasQueuedFrom(c, name, scope...)` | 只判断是否存在已排队项 |
| `UnqueueFrom(c, name, scope...)` | 移除尚未写出的排队项 |
| `QueueFrom(c)` | 获取 middleware 注入的请求级队列，通常只在底层扩展中使用 |

如果 `*From` 函数返回 `cookie.ErrQueueNotFound`，说明当前 Gin 路由没有安装 cookie 队列中间件，或者业务代码运行在非 Gin 请求上下文中。

## 读取请求 Cookie

### 基础读取

`RequestCookie` 从 `*http.Request` 中读取指定名称的 cookie 值：

```go
value, err := cookie.RequestCookie(r, "tenant_session")
if errors.Is(err, cookie.ErrCookieNotFound) {
    // cookie 不存在
    return ""
}
if err != nil {
    return err.Error()
}
return value
```

> 对齐 Laravel 的 `$request->cookie('name')`：存在时返回解密后的原始值，不存在时返回错误。

### 带安全扩展读取

读取签名/加密的 cookie 时，需要传入与写出时匹配的安全组件：

```go
value, err := cookie.RequestCookie(r, "secure_token",
    cookie.RequestWithContext(ctx),
    cookie.RequestWithSigner(signer),
    cookie.RequestWithEncryptor(encryptor),
)
```

## 删除 Cookie

删除浏览器 cookie 必须使用与创建时一致的 `Path` 和 `Domain`，浏览器才能匹配并清除对应记录。

在 Gin 请求中通过队列删除：

```go
_, err := cookie.QueueForgetFrom(c, "tenant_session",
    cookie.Path("/"),
    cookie.Domain("example.com"),
)
if err != nil {
    return err
}
```

在普通 `net/http` handler 中直接附加过期 cookie：

```go
if err := cookie.Forget("tenant_session",
    cookie.Path("/"),
    cookie.Domain("example.com"),
).Attach(w); err != nil {
    return err
}
```

> 如果创建时没有设置 domain，删除时也不要设置 domain。

## SameSite 策略

| 常量 | 说明 |
| --- | --- |
| `SameSiteDefault` | 使用 Go 标准库默认行为，不额外写出 SameSite 属性 |
| `SameSiteLax` | 常规站点会话推荐值，允许顶级导航携带 cookie |
| `SameSiteStrict` | 更严格的同站限制，任何跨站请求都不携带 cookie |
| `SameSiteNone` | 允许跨站发送，通常必须同时启用 `Secure(true)` |
| `SameSiteDisabled` | 表达显式关闭 SameSite 的意图，当前写出时等价于默认模式 |

选择建议：

- **常规 Web 应用**：使用 `SameSiteLax`，平衡安全与可用性。
- **敏感操作场景**：使用 `SameSiteStrict`，完全阻止跨站携带。
- **需要跨站携带的场景**（如 OAuth 回调、第三方嵌入）：使用 `SameSiteNone` + `Secure(true)`。

## 签名与加密

### 安全契约接口

Cookie 的签名和加密能力通过 `prismgo/contracts/cookie` 包定义的接口扩展：

```go
// Signer 负责 cookie 值的签名和验签
type Signer interface {
    Sign(ctx context.Context, name string, value string) (string, error)
    Unsign(ctx context.Context, name string, value string) (string, error)
}

// Encryptor 负责 cookie 值传输前后的加密和解密
type Encryptor interface {
    Encrypt(ctx context.Context, name string, plaintext string) (string, error)
    Decrypt(ctx context.Context, name string, ciphertext string) (string, error)
}
```

### 写出与读取顺序

写出时按"先加密、后签名"的顺序处理，保证签名覆盖最终传输值：

```
写出：plaintext → Encrypt → Sign → 传输值
```

读取时按"先验签、后解密"的相反顺序处理：

```
读取：传输值 → Unsign → Decrypt → plaintext
```

### 默认透传实现

`PassthroughSecurity` 是默认的安全实现，所有操作直接返回原值，不做任何加密或签名。适用于开发环境或不需要安全保护的 cookie。

业务可通过以下方式接入真实实现：

- **写出时**：通过 `WithSigner` / `WithEncryptor` 选项注入。
- **读取时**：通过 `RequestWithSigner` / `RequestWithEncryptor` 选项注入。
- **队列级**：通过 `NewQueue(options...)` 在创建队列时统一注入，所有 Flush 操作自动应用。

### 错误脱敏

签名验证失败、加密失败、解密失败等安全错误会统一包装为 `SensitiveError`，`Error()` 方法只返回脱敏的操作描述（如 `"cookie: verify value failed"`），不包含客户端提交的原始 cookie 值，防止敏感信息泄露到日志或错误响应中。

```go
value, err := cookie.RequestCookie(r, "secure_token", cookie.RequestWithSigner(signer))
if err != nil {
    // err.Error() 不会包含原始 cookie 值
    // 可通过 errors.Is 判断具体错误类型
    if errors.Is(err, cookie.ErrCookieSignature) {
        // 签名验证失败，cookie 可能被篡改
    }
}
```

## 错误常量

| 错误常量 | 说明 |
| --- | --- |
| `ErrInvalidCookieName` | cookie 名称为空或不符合 HTTP token 规则 |
| `ErrCookieNotFound` | 请求中不存在指定 cookie |
| `ErrQueueNotFound` | 当前 Gin 请求没有安装请求级 cookie 队列 |
| `ErrCookieSignature` | 签名校验失败，通常说明客户端值被篡改或密钥不匹配 |
| `ErrCookieEncryption` | 写出 cookie 前加密失败 |
| `ErrCookieDecryption` | 读取 cookie 时解密失败 |

## 与 Laravel Cookie 的对应关系

| Laravel 方法 | PrismGo 等价 | 说明 |
| --- | --- | --- |
| `Cookie::make($name, $value, $minutes)` | `cookie.Make(name, value, minutes, opts...)` | 创建 cookie 值对象 |
| `Cookie::forever($name, $value)` | `cookie.Forever(name, value, opts...)` | 创建长期 cookie |
| `response()->cookie($name, $value, $min)` | `cookie.Make(...).Attach(w)` | 附加到响应 |
| `Cookie::queue($name, $value, $minutes)` | `cookie.QueueMakeFrom(c, name, value, minutes, opts...)` | 请求级排队 |
| `Cookie::queue(Cookie::make(...))` | `cookie.QueueCookieFrom(c, cookie)` | 排队已构造的 cookie |
| `$request->cookie('name')` | `cookie.RequestCookie(r, name, opts...)` | 读取请求 cookie |
| `Cookie::expire('name')` | `cookie.QueueExpireFrom(c, name, opts...)` | 通过队列过期 cookie |
| `Cookie::forget('name')` | `cookie.QueueForgetFrom(c, name, opts...)` | `QueueExpireFrom` 的别名 |
| `response()->withoutCookie('name')` | `cookie.Forget(name).Attach(w)` | 直接附加过期 cookie |
| `Cookie::queued('name')` | `cookie.QueuedFrom(c, name)` | 查询已排队 cookie |
| `Cookie::hasQueued('name')` | `cookie.HasQueuedFrom(c, name)` | 判断是否已排队 |
| `Cookie::unqueue('name')` | `cookie.UnqueueFrom(c, name)` | 移除排队项 |
| `EncryptCookies` 中间件 | `WithSigner` / `WithEncryptor` 选项 | 安全扩展点 |
| `$except` 排除加密列表 | 不传入 `WithEncryptor` | 不加密的 cookie 不注入加密器 |
