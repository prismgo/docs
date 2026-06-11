# Cookie

- [Introduction](#introduction)
- [Configuration](#configuration)
  - [Default Values](#default-values)
  - [Service Provider](#service-provider)
  - [Middleware](#middleware)
- [Creating Cookies](#creating-cookies)
  - [Basic Creation](#basic-creation)
  - [Forever Cookies](#forever-cookies)
  - [Constructor Parameters and Options](#constructor-parameters-and-options)
  - [Explicit Expiry Time and Max-Age](#explicit-expiry-time-and-max-age)
- [Attaching Cookies to Responses](#attaching-cookies-to-responses)
  - [Direct Attachment](#direct-attachment)
  - [Attach Options](#attach-options)
- [Request-Level Cookie Queue](#request-level-cookie-queue)
  - [Queuing Cookies](#queuing-cookies)
  - [Querying Queued Cookies](#querying-queued-cookies)
  - [Removing Queued Items](#removing-queued-items)
  - [Request-Level vs Process-Level API](#request-level-vs-process-level-api)
- [Reading Request Cookies](#reading-request-cookies)
  - [Basic Retrieval](#basic-retrieval)
  - [Retrieval with Security Extensions](#retrieval-with-security-extensions)
- [Deleting Cookies](#deleting-cookies)
- [SameSite Policy](#samesite-policy)
- [Signing and Encryption](#signing-and-encryption)
  - [Security Contract Interfaces](#security-contract-interfaces)
  - [Outgoing and Incoming Order](#outgoing-and-incoming-order)
  - [Default Passthrough Implementation](#default-passthrough-implementation)
  - [Error Sanitization](#error-sanitization)
- [Error Constants](#error-constants)
- [Laravel Cookie Mapping](#laravel-cookie-mapping)

---

## Introduction

`github.com/prismgo/framework/cookie` provides Laravel-style HTTP cookie creation, reading, queuing, expiration, and deletion. It is designed for framework-level use, maintaining Go's explicit error returns while preserving Laravel's core concepts such as `Make`, `Forever`, `Queue`, `Expire`, and `Forget`.

Core design principles:

- **Value object separation**: `Cookie` is a pure value object. Creating it does not write to the response, allowing unified queuing and deduplication before the middleware finishes.
- **Request-level queue**: Within Gin requests, cookie changes are declared via request-level APIs like `QueueMakeFrom`, and the `QueuedCookies` middleware writes them all at once when the response ends, preventing controllers/services from directly manipulating response headers.
- **Scope-based deduplication**: The queue deduplicates by the `name/path/domain` triplet. Later entries override earlier ones within the same scope, consistent with how browsers match cookies.
- **Security extension points**: `Signer` and `Encryptor` are optional dependencies that can be injected. The default is passthrough, and business code can plug in real implementations as needed.

## Configuration

### Default Values

| Property | Default | Description |
| --- | --- | --- |
| `Path` | `/` | Visible across all paths on the site |
| `HTTPOnly` | `true` | Client-side scripts cannot read the cookie by default |
| `Secure` | `false` | Must be explicitly enabled for HTTPS |
| `SameSite` | Default mode | No additional SameSite attribute is written |
| `ForeverMinutes` | `2628000` | Expiration in minutes for forever cookies, approximately 5 years |

### Service Provider

`cookie.ServiceProvider` is registered as a framework default provider. During the `Register` phase, it binds a lazy singleton factory for `cookie.queue` in the container. Request-level queues are created by middleware during the request lifecycle and do not depend on this singleton.

```go
// Enable it in the application's provider list
cookiepkg.ServiceProvider{}
```

### Middleware

#### QueuedCookies

`github.com/prismgo/framework/http/middleware.QueuedCookies()` installs a per-request cookie queue for each Gin request and flushes all queued cookies to the response after the handler has run.

```go
engine.Use(middleware.QueuedCookies())
```

Workflow:

1. At the start of the request, a `cookie.Queue` instance is created and stored in `gin.Context` (under the key `cookie.QueueKey`).
2. Business code declares cookie changes via `QueueMakeFrom`, `QueueForgetFrom`, and other APIs.
3. After the handler finishes, the middleware calls `queue.Flush(w)` to write all queued cookies to the response.
4. If Flush fails, the response status code is set to 500 and the request is aborted.

> **Note**: The `StartSession` middleware also installs the same cookie queue internally, so you do not need to mount `QueuedCookies` separately when using `StartSession`.

## Creating Cookies

`New` and `Make` only create value objects; they do not write to the response.

### Basic Creation

```go
c := cookie.New("theme", "dark", 60*24,
    cookie.Path("/"),
    cookie.Domain("example.com"),
    cookie.HTTPOnly(true),
    cookie.Secure(true),
    cookie.SameSite(cookie.SameSiteStrict),
)
```

`Make` is a Laravel-style alias for `New`:

```go
c := cookie.Make("locale", "zh-CN", 60*24*30,
    cookie.SameSite(cookie.SameSiteLax),
)
```

### Forever Cookies

`Forever` creates a cookie with an expiration of approximately 5 years, suitable for "remember me" tokens, device identifiers, and other long-lived state:

```go
c := cookie.Forever("device_id", "device-token")
```

### Constructor Parameters and Options

| Parameter/Option | Purpose | Typical Values |
| --- | --- | --- |
| `name` | The cookie name stored by the browser; must be a valid HTTP token | `tenant_session` |
| `value` | The raw value written to the browser; will be encrypted/signed if security extensions are enabled | session ID, preference value, one-time token |
| `minutes` | Relative expiration in minutes; `0` means no relative expiration | `120`, `60*24*30` |
| `Path("/")` | Browser path scope; must match the original when deleting | `/`, `/admin` |
| `Domain("example.com")` | Browser domain scope; empty means current host | `example.com`, `.example.com` |
| `HTTPOnly(true)` | Prevents JavaScript from reading the cookie; should remain enabled for auth cookies | Default `true` |
| `Secure(true)` | Only sent over HTTPS; should be enabled for production auth cookies | `true` |
| `SameSite(...)` | Controls whether the cookie is sent with cross-site requests | `SameSiteLax`, `SameSiteNone` |
| `Raw(true)` | Lets `net/http` write the value as-is without URL encoding | Only for legacy value format compatibility |
| `ExpiresAt(t)` | Explicit expiry time; takes precedence over the time generated by `minutes` | Fixed expiry time for download tokens |
| `MaxAge(seconds)` | Explicit `Max-Age` in seconds; negative values are used for deletion | `900`, `-1` |
| `ScopeOption(scope)` | Applies a reusable `Scope` (Path + Domain) to the cookie | Batch-creating cookies with the same scope |

### Explicit Expiry Time and Max-Age

When you need precise control over expiration behavior, use `ExpiresAt` or `MaxAge` instead of `minutes`:

```go
c := cookie.Make("download_token", "token", 0,
    cookie.ExpiresAt(time.Now().Add(15*time.Minute)),
    cookie.MaxAge(15*60),
)
```

> When both `ExpiresAt` and `MaxAge` are set, both are written to the `Set-Cookie` header. Browsers prioritize `Max-Age`.

## Attaching Cookies to Responses

### Direct Attachment

`Attach` converts the `Cookie` to a `net/http.Cookie` and calls `http.SetCookie` to write it to the response:

```go
if err := cookie.Make("notice", "read", 30).Attach(w); err != nil {
    return err
}
```

You can also use the package-level `Attach` function:

```go
if err := cookie.Attach(w, c); err != nil {
    return err
}
```

An invalid cookie name returns `cookie.ErrInvalidCookieName` and does not write an invalid `Set-Cookie` header.

### Attach Options

| Option | Purpose |
| --- | --- |
| `WithContext(ctx)` | Passes the request context to the signer or encryptor, for tracing, tenant key, or timeout control |
| `WithSigner(signer)` | Signs the cookie value before writing; must use a matching `RequestWithSigner` when reading |
| `WithEncryptor(encryptor)` | Encrypts the cookie value before writing; must use a matching `RequestWithEncryptor` when reading |
| `WithNow(now)` | Fixes the current time used for relative expiration calculation; commonly used in tests or when the same business timestamp is needed |

## Request-Level Cookie Queue

The request-level queue is the recommended approach in Gin HTTP requests. Business code declares cookie changes first, and the framework middleware writes them all at once.

### Queuing Cookies

```go
// Create a regular cookie and queue it
_, err := cookie.QueueMakeFrom(c, "tenant_session", "session-token", 120,
    cookie.Secure(true),
    cookie.SameSite(cookie.SameSiteLax),
)
if err != nil {
    c.JSON(http.StatusInternalServerError, gin.H{"message": "cookie queue not available"})
    return
}

// Create a forever cookie and queue it
_, err = cookie.QueueForeverFrom(c, "remember_web", token,
    cookie.Secure(true),
    cookie.SameSite(cookie.SameSiteLax),
)

// Queue an already-constructed Cookie value object
cookie.QueueCookieFrom(c, myCookie)
```

### Querying Queued Cookies

```go
queued, ok, err := cookie.QueuedFrom(c, "remember_web")
if err != nil {
    return err
}
if ok {
    // queued is a cookie.Cookie value object
    _ = queued.Name
}

// Check existence only
exists, err := cookie.HasQueuedFrom(c, "remember_web")
```

You can specify a scope when querying, to distinguish cookies with the same name but different path/domain:

```go
queued, ok, err := cookie.QueuedFrom(c, "session",
    cookie.Scope{Path: "/admin", Domain: "example.com"},
)
```

### Removing Queued Items

Remove a queued item that has not yet been written, commonly used for conditionally canceling a cookie:

```go
if err := cookie.UnqueueFrom(c, "notice"); err != nil {
    return err
}
```

### Request-Level vs Process-Level API

| Scenario | Recommended API | Description |
| --- | --- | --- |
| Declaring cookie changes in Gin HTTP requests | `QueueMakeFrom` / `QueueForgetFrom` and other `*From` APIs | Uses the request-level queue; middleware writes at the end |
| Immediately writing a cookie in a plain `net/http` handler | `cookie.Make(...).Attach(w)` | Directly appends a `Set-Cookie` response header |
| Testing or non-Web programs simulating a queue | `QueueMake` / `Queued` / `Unqueue` | Uses the process-level default queue; do not use as a web request state container |

Request-level API reference:

| Function | Purpose |
| --- | --- |
| `QueueCookieFrom(c, cookie)` | Places an already-constructed `Cookie` value object into the current request queue |
| `QueueMakeFrom(c, name, value, minutes, opts...)` | Creates a regular cookie and places it into the current request queue |
| `QueueForeverFrom(c, name, value, opts...)` | Creates a forever cookie and places it into the current request queue |
| `QueueExpireFrom(c, name, opts...)` | Creates an expired cookie and places it into the current request queue |
| `QueueForgetFrom(c, name, opts...)` | Laravel semantic alias for `QueueExpireFrom` |
| `QueuedFrom(c, name, scope...)` | Checks whether a cookie has been queued in the current request |
| `HasQueuedFrom(c, name, scope...)` | Checks only whether a queued item exists |
| `UnqueueFrom(c, name, scope...)` | Removes a queued item that has not yet been written |
| `QueueFrom(c)` | Retrieves the request-level queue injected by middleware; typically used only in low-level extensions |

If a `*From` function returns `cookie.ErrQueueNotFound`, it means the current Gin route does not have the cookie queue middleware installed, or the business code is running outside a Gin request context.

## Reading Request Cookies

### Basic Retrieval

`RequestCookie` reads the cookie value with the specified name from an `*http.Request`:

```go
value, err := cookie.RequestCookie(r, "tenant_session")
if errors.Is(err, cookie.ErrCookieNotFound) {
    // Cookie does not exist
    return ""
}
if err != nil {
    return err.Error()
}
return value
```

> Aligned with Laravel's `$request->cookie('name')`: returns the decrypted original value when present, or an error when not found.

### Retrieval with Security Extensions

When reading signed/encrypted cookies, you must pass the security components that match those used when writing:

```go
value, err := cookie.RequestCookie(r, "secure_token",
    cookie.RequestWithContext(ctx),
    cookie.RequestWithSigner(signer),
    cookie.RequestWithEncryptor(encryptor),
)
```

## Deleting Cookies

To delete a browser cookie, you must use the same `Path` and `Domain` that were used when creating it, so the browser can match and clear the corresponding record.

Delete via the queue in a Gin request:

```go
_, err := cookie.QueueForgetFrom(c, "tenant_session",
    cookie.Path("/"),
    cookie.Domain("example.com"),
)
if err != nil {
    return err
}
```

Directly attach an expired cookie in a plain `net/http` handler:

```go
if err := cookie.Forget("tenant_session",
    cookie.Path("/"),
    cookie.Domain("example.com"),
).Attach(w); err != nil {
    return err
}
```

> If no domain was set when creating the cookie, do not set a domain when deleting it either.

## SameSite Policy

| Constant | Description |
| --- | --- |
| `SameSiteDefault` | Uses Go standard library default behavior; no additional SameSite attribute is written |
| `SameSiteLax` | Recommended for regular web sessions; allows top-level navigations to carry the cookie |
| `SameSiteStrict` | Stricter same-site restriction; no cross-site requests carry the cookie |
| `SameSiteNone` | Allows cross-site sending; typically must be used with `Secure(true)` |
| `SameSiteDisabled` | Expresses the intent to explicitly disable SameSite; currently equivalent to default mode when writing |

Selection guidelines:

- **Regular web applications**: Use `SameSiteLax` to balance security and usability.
- **Sensitive operation scenarios**: Use `SameSiteStrict` to completely block cross-site carrying.
- **Scenarios requiring cross-site carrying** (e.g., OAuth callbacks, third-party embeds): Use `SameSiteNone` + `Secure(true)`.

## Signing and Encryption

### Security Contract Interfaces

Cookie signing and encryption capabilities are defined by interfaces in the `github.com/prismgo/framework/contracts/cookie` package:

```go
// Signer handles cookie value signing and verification
type Signer interface {
    Sign(ctx context.Context, name string, value string) (string, error)
    Unsign(ctx context.Context, name string, value string) (string, error)
}

// Encryptor handles cookie value encryption and decryption for transport
type Encryptor interface {
    Encrypt(ctx context.Context, name string, plaintext string) (string, error)
    Decrypt(ctx context.Context, name string, ciphertext string) (string, error)
}
```

### Outgoing and Incoming Order

When writing, the value is processed in "encrypt first, then sign" order, ensuring the signature covers the final transport value:

```
Outgoing: plaintext → Encrypt → Sign → transport value
```

When reading, the reverse "verify first, then decrypt" order is applied:

```
Incoming: transport value → Unsign → Decrypt → plaintext
```

### Default Passthrough Implementation

`PassthroughSecurity` is the default security implementation. All operations return the original value directly without any encryption or signing. It is suitable for development environments or cookies that do not require security protection.

Business code can plug in real implementations via:

- **When writing**: Inject via `WithSigner` / `WithEncryptor` options.
- **When reading**: Inject via `RequestWithSigner` / `RequestWithEncryptor` options.
- **Queue-level**: Inject uniformly when creating a queue via `NewQueue(options...)`; all Flush operations automatically apply them.

### Error Sanitization

Security errors such as signature verification failure, encryption failure, and decryption failure are uniformly wrapped in `SensitiveError`. The `Error()` method only returns a sanitized operation description (e.g., `"cookie: verify value failed"`), without including the original cookie value submitted by the client, preventing sensitive information from leaking into logs or error responses.

```go
value, err := cookie.RequestCookie(r, "secure_token", cookie.RequestWithSigner(signer))
if err != nil {
    // err.Error() will not contain the original cookie value
    // Use errors.Is to determine the specific error type
    if errors.Is(err, cookie.ErrCookieSignature) {
        // Signature verification failed; the cookie may have been tampered with
    }
}
```

## Error Constants

| Error Constant | Description |
| --- | --- |
| `ErrInvalidCookieName` | Cookie name is empty or does not conform to HTTP token rules |
| `ErrCookieNotFound` | The specified cookie does not exist in the request |
| `ErrQueueNotFound` | The current Gin request does not have a request-level cookie queue installed |
| `ErrCookieSignature` | Signature verification failed; usually indicates the client value was tampered with or the key does not match |
| `ErrCookieEncryption` | Encryption failed before writing the cookie |
| `ErrCookieDecryption` | Decryption failed while reading the cookie |

## Laravel Cookie Mapping

| Laravel Method | PrismGo Equivalent | Description |
| --- | --- | --- |
| `Cookie::make($name, $value, $minutes)` | `cookie.Make(name, value, minutes, opts...)` | Create a cookie value object |
| `Cookie::forever($name, $value)` | `cookie.Forever(name, value, opts...)` | Create a forever cookie |
| `response()->cookie($name, $value, $min)` | `cookie.Make(...).Attach(w)` | Attach to response |
| `Cookie::queue($name, $value, $minutes)` | `cookie.QueueMakeFrom(c, name, value, minutes, opts...)` | Request-level queue |
| `Cookie::queue(Cookie::make(...))` | `cookie.QueueCookieFrom(c, cookie)` | Queue a constructed cookie |
| `$request->cookie('name')` | `cookie.RequestCookie(r, name, opts...)` | Read request cookie |
| `Cookie::expire('name')` | `cookie.QueueExpireFrom(c, name, opts...)` | Expire a cookie via queue |
| `Cookie::forget('name')` | `cookie.QueueForgetFrom(c, name, opts...)` | Alias for `QueueExpireFrom` |
| `response()->withoutCookie('name')` | `cookie.Forget(name).Attach(w)` | Directly attach an expired cookie |
| `Cookie::queued('name')` | `cookie.QueuedFrom(c, name)` | Query a queued cookie |
| `Cookie::hasQueued('name')` | `cookie.HasQueuedFrom(c, name)` | Check if a cookie is queued |
| `Cookie::unqueue('name')` | `cookie.UnqueueFrom(c, name)` | Remove a queued item |
| `EncryptCookies` middleware | `WithSigner` / `WithEncryptor` options | Security extension points |
| `$except` exclusion list | Do not pass `WithEncryptor` | Cookies without encryption simply don't inject an encryptor |
