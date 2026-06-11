# Support

`prismgo/support` provides framework-level helper functions. These helpers are decoupled from business logic and cover five areas: **value checks**, **type conversion**, **URL generation**, **path resolution**, and **environment checks**. Path helpers are the single place where application directory structure is defined. Code that needs to locate project directories should use the `support` package instead of manually joining strings or depending on `os.Getwd`.

- [Feature Overview](#feature-overview)
- [Environment Dependencies](#environment-dependencies)
  - [Path Resolution Dependencies](#path-resolution-dependencies)
  - [URL Configuration Source](#url-configuration-source)
  - [IsProduction Environment Variable](#isproduction-environment-variable)
- [Value Checks](#value-checks)
  - [Empty](#empty)
- [Type Conversion](#type-conversion)
  - [ParseInt](#parseint)
- [URL Generation](#url-generation)
  - [URL](#url)
- [Path Resolution](#path-resolution)
  - [Path Resolution Rules](#path-resolution-rules)
  - [BasePath](#basepath)
  - [AppPath](#apppath)
  - [ConfigPath](#configpath)
  - [DatabasePath](#databasepath)
  - [PublicPath](#publicpath)
  - [ResourcePath](#resourcepath)
  - [StoragePath](#storagepath)
  - [LangPath](#langpath)
- [Environment Checks](#environment-checks)
  - [IsProduction](#isproduction)
- [Usage Guidelines](#usage-guidelines)
- [Testing](#testing)

## Feature Overview

| Function | Category | Purpose |
| --- | --- | --- |
| `Empty` | Value checks | Checks whether a value is "empty" (`nil`, empty string, zero value, empty slice/map, and so on) |
| `ParseInt` | Type conversion | Parses a string as an integer, returning a fallback on failure |
| `URL` | URL generation | Generates a full URL from application `app.url` and optional path parameters |
| `BasePath` | Path resolution | Returns a path under the application root |
| `AppPath` | Path resolution | Returns a path under `app/` |
| `ConfigPath` | Path resolution | Returns a path under `config/` |
| `DatabasePath` | Path resolution | Returns a path under `database/` |
| `PublicPath` | Path resolution | Returns a path under `public/` |
| `ResourcePath` | Path resolution | Returns a path under `resources/` |
| `StoragePath` | Path resolution | Returns a path under `storage/` |
| `LangPath` | Path resolution | Returns a path under `lang/` |
| `IsProduction` | Environment checks | Checks whether the current runtime environment is production |

## Environment Dependencies

### Path Resolution Dependencies

Path helpers depend on path bindings registered in the `container`. During application startup, `foundation` injects the application root paths into the container:

| Container key | Directory | Helper |
| --- | --- | --- |
| `path.base` | Application root | `BasePath` |
| `path.app` | `app/` | `AppPath` |
| `path.config` | `config/` | `ConfigPath` |
| `path.database` | `database/` | `DatabasePath` |
| `path.public` | `public/` | `PublicPath` |
| `path.resources` | `resources/` | `ResourcePath` |
| `path.storage` | `storage/` | `StoragePath` |
| `path.lang` | `lang/` | `LangPath` |

If the container does not have a matching binding, such as in tests where the Application has not been initialized, path helpers fall back to automatic project-root detection through `internal/path`. Detection walks upward from the current working directory looking for `go.work`, `.git`, or `go.mod`, or checks for standard directories such as `storage`, `config`, and `app`.

### URL Configuration Source

`URL` uses the current application's `app.url` configuration value as its base URL. Resolution order:

1. Read `app.url` from `config.default` in the container
2. If the application has not started or configuration is unavailable, read the `APP_URL` environment variable
3. If both are empty, fall back to `http://localhost:8080`

Trailing `/` characters are trimmed from `app.url`, leading `/` characters are trimmed from the relative path, and the final URL keeps a single separator between them.

### IsProduction Environment Variable

`IsProduction` reads the `APP_ENV` environment variable. The rules are:

1. Read `APP_ENV`
2. If `APP_ENV` is empty, return `true` as a conservative production fallback
3. If `APP_ENV` equals `"production"` case-insensitively, return `true`
4. Otherwise, return `false`

Default behavior: an unset `APP_ENV` is treated as production. This means path helpers and value helpers still work in development when `APP_ENV` is missing, but `IsProduction` will return `true`.

## Value Checks

### Empty

Checks whether a value is "empty". The definition follows Laravel's `blank()` helper: `nil`, empty strings, empty arrays, empty slices, empty maps, `false`, zero numbers, zero-value structs, nil pointers, and nil interfaces are treated as empty.

```go
import "github.com/prismgo/framework/support"

support.Empty(nil)              // true
support.Empty("")               // true
support.Empty("hello")          // false
support.Empty(false)            // true
support.Empty(true)             // false
support.Empty(0)                // true
support.Empty(1)                // false
support.Empty(0.0)              // true
support.Empty([]string{})       // true
support.Empty([]string{"a"})    // false
support.Empty(map[string]int{}) // true
support.Empty(MyStruct{})       // true (zero-value struct)
```

Typical use cases include validating request parameters, checking whether optional fields were provided, and testing whether configuration values are empty.

```go
func UpdateProfile(ctx context.Context, req UpdateProfileRequest) error {
    if support.Empty(req.Nickname) {
        return errors.New("nickname is required")
    }
    // ...
}
```

## Type Conversion

### ParseInt

Parses a string as an integer and returns the fallback value on failure. This is useful for request parameters, environment variables, and configuration values where tolerant conversion is expected.

```go
import "github.com/prismgo/framework/support"

support.ParseInt("10", 1)   // 10
support.ParseInt("bad", 7)  // 7 (parse failure, fallback returned)
support.ParseInt("", 8)     // 8 (empty string, fallback returned)
support.ParseInt(" 12 ", 9) // 12 (leading and trailing whitespace trimmed)
```

Typical use cases include pagination parameters and numeric query-string values.

```go
page := support.ParseInt(r.URL.Query().Get("page"), 1)
limit := support.ParseInt(r.URL.Query().Get("limit"), 20)
```

## URL Generation

### URL

Generates a full URL based on application `app.url`. This helper follows Laravel's `url()` helper and is suitable for internal links, callback URLs, and absolute links in emails.

```go
import "github.com/prismgo/framework/support"

// Assume app.url or APP_URL is https://example.test/base/

support.URL("user/profile")  // https://example.test/base/user/profile
support.URL("/user/profile") // https://example.test/base/user/profile
support.URL("")              // https://example.test/base
```

If `path` is already a full URL, it is returned unchanged instead of being joined with `app.url`. This avoids breaking CDN URLs, external redirects, or absolute links explicitly passed by the caller.

```go
support.URL("https://cdn.example.test/assets/app.js")
// https://cdn.example.test/assets/app.js
```

The second and later arguments are appended as additional URL path segments and encoded with `url.PathEscape`. Parameters may be regular values, slices, arrays, or map values. `nil` and empty strings are ignored. Map parameters are appended by value after sorting keys, which keeps output stable.

```go
support.URL("orders", 10, "items")
// https://example.test/base/orders/10/items

support.URL("user/profile", []any{1, "Jane Doe"})
// https://example.test/base/user/profile/1/Jane%20Doe

support.URL("files", map[string]any{"name": "contract.pdf", "team": "sales"})
// https://example.test/base/files/contract.pdf/sales
```

`support.URL` only joins the application base URL and path segments into an absolute URL. It does not resolve named routes. Use `route.URL` when you need to generate a path from a route name.

## Path Resolution

Path helpers accept variadic path segments and return an absolute path. They are the single place where application directory structure is defined. Manually joining strings or depending on `os.Getwd` can lead to incorrect paths after deployment.

### Path Resolution Rules

All path helpers follow the same rules:

1. **Absolute paths are returned unchanged**: if the given path is already absolute, it is returned without joining.
2. **Duplicate prefix removal**: if the first segment starts with the directory name, such as `StoragePath("storage/framework")`, the duplicate prefix is removed, making it equivalent to `StoragePath("framework")`.
3. **Stable after application startup**: once the Application has started, path bindings are stored in the container. Later `os.Chdir` calls do not affect helper return values.

```go
import "github.com/prismgo/framework/support"

// Assume the application root is /www/code/workorder

// Basic usage: join child paths
support.StoragePath("logs", "app.log")   // /www/code/workorder/storage/logs/app.log
support.ConfigPath("app.go")             // /www/code/workorder/config/app.go
support.LangPath("en", "messages.json")  // /www/code/workorder/lang/en/messages.json

// Duplicate prefix removal: these two calls are equivalent
support.StoragePath("storage/framework/cache/data")
support.StoragePath("framework/cache/data")
// Both return /www/code/workorder/storage/framework/cache/data

// Absolute paths are returned unchanged
support.StoragePath("/tmp/logs/app.log") // /tmp/logs/app.log
```

### BasePath

Returns a path under the application root. Use it to locate root-level files such as `.env`, `go.mod`, or `composer.json`.

```go
support.BasePath(".env")                 // /www/code/workorder/.env
support.BasePath("go.mod")               // /www/code/workorder/go.mod
support.BasePath("storage", "app.log")   // /www/code/workorder/storage/app.log
```

### AppPath

Returns a path under `app/`. This is useful for code generation, template compilation, and other cases that need to locate business code.

```go
support.AppPath("models", "user.go") // /www/code/workorder/app/models/user.go
```

### ConfigPath

Returns a path under `config/`. This is useful when registering publishable configuration files in a Provider.

```go
support.ConfigPath("app.go")   // /www/code/workorder/config/app.go
support.ConfigPath("cache.go") // /www/code/workorder/config/cache.go
```

### DatabasePath

Returns a path under `database/`. This is useful for locating migration files and seed data.

```go
support.DatabasePath("migrations") // /www/code/workorder/database/migrations
```

### PublicPath

Returns a path under `public/`. This is useful for static assets and build output.

```go
support.PublicPath("index.html")   // /www/code/workorder/public/index.html
support.PublicPath("assets", "js") // /www/code/workorder/public/assets/js
```

### ResourcePath

Returns a path under `resources/`. This is useful for view templates and source assets.

```go
support.ResourcePath("views") // /www/code/workorder/resources/views
```

### StoragePath

Returns a path under `storage/`. Framework logs, cache data, uploads, and other persistent runtime data live under this directory.

```go
support.StoragePath("logs", "app.log")           // /www/code/workorder/storage/logs/app.log
support.StoragePath("framework", "cache", "data") // /www/code/workorder/storage/framework/cache/data
support.StoragePath("app", "public", "avatars")  // /www/code/workorder/storage/app/public/avatars
```

### LangPath

Returns a path under `lang/`. This is useful for locating translation files.

```go
support.LangPath("en", "messages.json")      // /www/code/workorder/lang/en/messages.json
support.LangPath("zh_CN", "validation.json") // /www/code/workorder/lang/zh_CN/validation.json
```

## Environment Checks

### IsProduction

Checks whether the current runtime environment is production. It reads the `APP_ENV` environment variable case-insensitively. If `APP_ENV` is empty, it uses a conservative fallback and treats the environment as production.

```go
import "github.com/prismgo/framework/support"

if support.IsProduction() {
    // Production: skip development-only registrations or disable debug output.
}
```

The framework uses `IsProduction` to control the following behavior:

| Module | Behavior |
| --- | --- |
| `vendor:publish` command | Hidden and rejected in production |
| `publish` registry | Skips resource registration in production |

Typical business-code usage:

```go
// Register debug routes only outside production.
if !support.IsProduction() {
    route.Get("/debug/pprof", pprof.Index)
}

// Use more conservative settings in production.
ttl := 10 * time.Minute
if support.IsProduction() {
    ttl = 5 * time.Minute
}
```

## Usage Guidelines

- Use `support` path helpers for path joining. Do not use `os.Getwd` or manual string concatenation for application directories.
- Use `support.URL` for absolute internal links. Do not hand-write `APP_URL + path` in business code. Use `route.URL` when generating a path from a named route, then compose a full URL only if needed.
- Use `Empty` for form fields and optional parameters. If your case must distinguish "not provided" from "provided but empty", prefer pointer types such as `*string`.
- Use `ParseInt` for tolerant conversion. If strict validation and error reporting are required, use `strconv.Atoi`.
- Use `IsProduction` only when behavior must differ by environment. Most business logic should be controlled by configuration instead.
- Path helpers still work in tests without an initialized Application because they fall back to project-root detection through `internal/path`.
