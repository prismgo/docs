# Container

- [Introduction](#introduction)
    - [What is the Service Container](#what-is-the-service-container)
    - [Zero Configuration Resolution](#zero-configuration-resolution)
    - [When to Use the Container](#when-to-use-the-container)
- [Binding](#binding)
    - [Binding Basics](#binding-basics)
    - [Binding a Singleton](#binding-a-singleton)
    - [Binding Instances](#binding-instances)
    - [Aliases](#aliases)
    - [Binding Options](#binding-options)
- [Resolving Services](#resolving-services)
    - [The Make Method](#the-make-method)
    - [The Factory Method](#the-factory-method)
    - [Generic Typed Helpers](#generic-typed-helpers)
    - [The Value Helper](#the-value-helper)
- [Method Invocation and Injection](#method-invocation-and-injection)
- [Container State](#container-state)
    - [Checking Existence](#checking-existence)
    - [Checking Resolution State](#checking-resolution-state)
    - [Listing Entries](#listing-entries)
- [Resource Lifecycle](#resource-lifecycle)
    - [Close Groups](#close-groups)
    - [Customising Close Behaviour](#customising-close-behaviour)
    - [Graceful Close Semantics](#graceful-close-semantics)
- [Missing Factory Loader](#missing-factory-loader)
- [Package-Level Facade](#package-level-facade)
- [Error Constants](#error-constants)
- [Laravel Container Mapping](#laravel-container-mapping)

---

PrismGo's service container is a central registry for managing service dependencies and their lifecycles. It implements the `contracts/container` interfaces, providing a programmatic, key-based approach to service binding, resolution, and graceful resource shutdown.

---

## Introduction

### What is the Service Container

The PrismGo service container is a powerful tool for managing service dependencies and performing dependency injection. Dependency injection means that a service's dependencies are "injected" into it rather than constructed internally.

Unlike Laravel's container — which uses class/interface names and PHP reflection for auto-resolution — PrismGo's container uses **explicit string keys** and **factory functions** for binding and resolving services. This design is idiomatic for Go and keeps the resolution path explicit and type-safe.

Here is a simple example of how the container works in a PrismGo application:

```go
import (
    "github.com/prismgo/framework/container"
    "github.com/prismgo/framework/contracts/container"
)

// Define a service.
type PodcastService struct {
    client HttpClient
}

// Register the service in a service provider.
app.Container().Singleton("podcast.service", func(resolver containercontract.Resolver) (any, error) {
    return &PodcastService{
        client: NewHttpClient(),
    }, nil
})

// Resolve the service somewhere in your application.
svc, err := container.Make[*PodcastService]("podcast.service")
```

### Zero Configuration Resolution

If a service has no dependencies or only depends on other concrete types that have already been bound, you can register it without manually wiring its dependencies inside the factory closure — the factory receives the `Resolver`, allowing you to resolve sub-dependencies on demand:

```go
app.Container().Singleton("podcast.parser", func(resolver containercontract.Resolver) (any, error) {
    // Resolve sub-dependencies from the container
    httpClient, _ := resolver.Make("http.client")
    return NewPodcastParser(httpClient), nil
})
```

Because the container handles wiring, you can focus on business logic rather than object construction.

### When to Use the Container

You do not need to manually interact with the container in every code path. Many components obtain their dependencies through the package-level facade helpers (e.g., `container.Make[T]`, `cache.Get[T]`, `queue.Dispatch`), which use the current application container under the hood.

You should manually bind services into the container when:

- You are writing a service that implements an interface and want to resolve it via a key throughout the application.
- You are writing a PrismGo package or module and need to register your services so they can be consumed by other modules.
- You need to manage the lifecycle of external resources (database connections, HTTP clients, file handles) that must be closed gracefully during application shutdown.

---

## Binding

### Binding Basics

Almost all of your container bindings will be registered within [service providers](/docs/providers). Within a service provider, you have access to the container via `app.Container()`.

#### Simple Bindings

The `Bind` method registers a **transient** service. Each time the service is resolved, the factory function is executed, and a fresh instance is returned. The container does not retain the instance and does not close it during application shutdown:

```go
app.Container().Bind("uuid.generator", func(resolver containercontract.Resolver) (any, error) {
    return uuid.NewString, nil
})
```

The factory receives the container's `Resolver`, which you can use to resolve sub-dependencies:

```go
app.Container().Bind("podcast.parser", func(resolver containercontract.Resolver) (any, error) {
    httpClient, err := resolver.Make("http.client")
    if err != nil {
        return nil, err
    }
    return NewPodcastParser(httpClient.(*HttpClient)), nil
})
```

### Binding a Singleton

The `Singleton` method binds a service that should be resolved **only once**. The factory executes on the first `Make` call, and the same instance is returned on all subsequent calls:

```go
app.Container().Singleton("cache.manager", func(resolver containercontract.Resolver) (any, error) {
    return cache.NewManager(cache.Config{
        Default: "memory",
    }), nil
})
```

Singleton factory returns an error, the error is **not** cached — callers can retry after fixing the dependency. Once the factory succeeds, the instance is shared for the lifetime of the container.

Use singletons for services that manage shared state: connection pools, configuration repositories, event dispatchers, loggers, etc.

### Binding Instances

The `Instance` method binds an **already constructed** object into the container. The service is immediately marked as resolved and will be returned on all subsequent `Make` calls:

```go
configRepo := config.NewRepository(map[string]any{
    "app.name": "PrismGo",
})

app.Container().Instance("config.repository", configRepo)
```

`Instance` is useful for injecting objects created during the application bootstrap phase, or for test doubles in unit tests. Passing `nil` as the value keeps the entry but marks it as unregistered; to fully clear a service, use `Forget`.

### Aliases

The `Alias` method registers an alternative name for an existing service key. All container operations (`Make`, `Has`, `Bound`, `Resolved`, `Value`) resolve aliases to the canonical key:

```go
app.Container().Alias("cache.manager", "cache")
app.Container().Alias("cache.manager", "cm")

// These all resolve the same service:
manager1, _ := app.Container().Make("cache.manager")
manager2, _ := app.Container().Make("cache")
manager3, _ := app.Container().Make("cm")
```

Aliases do not copy bindings or affect close order; shutdown always follows the original registration order.

### Binding Options

When registering a singleton or instance, you can provide binding options to manage resource lifecycle.

#### WithCloser

`WithCloser` registers a typed close function that the container calls during `Close`:

```go
import "github.com/prismgo/framework/container"

app.Container().Singleton("cache.manager", func(resolver containercontract.Resolver) (any, error) {
    return cache.NewManager(cache.Config{Default: "memory"})
}, container.WithCloser(func(m *cache.Manager) error {
    return m.Close()
}))
```

#### WithContextCloser

`WithContextCloser` registers a close function that receives the application's shutdown context, allowing the closer to respect timeout or cancellation signals:

```go
app.Container().Singleton("queue.connection", newQueueConnection,
    container.WithContextCloser(func(ctx context.Context, conn *QueueConnection) error {
        return conn.Shutdown(ctx)
    }),
)
```

#### WithCloseGroup

`WithCloseGroup` assigns the service to a close group. This controls the phase in which the service is released during application shutdown:

```go
app.Container().Singleton("logger", newLogger,
    container.WithCloseGroup(container.CloseGroupReporting),
)
```

See the [Close Groups](#close-groups) section for more details.

---

## Resolving Services

### The Make Method

The `Make` method resolves a service by key. It returns `any` (an empty interface), so the caller must perform a type assertion:

```go
raw, err := app.Container().Make("cache.manager")
if err != nil {
    return err
}
manager := raw.(*cache.Manager)
```

`Make` follows this resolution order:

1. Return a previously resolved singleton instance if one exists.
2. Try the [missing factory loader](#missing-factory-loader) if no binding is found.
3. Execute the registered factory function.
4. For singletons, cache and return the result.

### The Factory Method

The `Factory` method returns a lazy closure that resolves the service on demand. The returned closure calls `Make` internally, preserving the original binding's lifecycle semantics (transient vs singleton):

```go
makeQueue, err := app.Container().Factory("queue.manager")
if err != nil {
    return err
}

// Later, when you actually need the service:
raw, err := makeQueue()
```

### Generic Typed Helpers

The package-level `Make[T]` function provides a type-safe resolution path. It resolves from the **current application container** and performs automatic type assertion:

```go
import "github.com/prismgo/framework/container"

manager, err := container.Make[*cache.Manager]("cache.manager")
if err != nil {
    return err
}
// manager is already *cache.Manager — no type assertion needed.
```

If the resolved value's type does not match `T`, `Make[T]` returns a descriptive error.

### The Value Helper

The package-level `Value[T]` function reads an **already resolved** singleton from the current container. It does **not** create the service — it only returns instances that have already been resolved via a previous `Make` call:

```go
manager := container.Value[*cache.Manager]("cache.manager")
if manager == nil {
    // Service has not been resolved yet, or does not exist.
}
```

`Value[T]` returns the zero value of `T` if the service is not found or the type does not match. Use this for optional dependencies where a missing service is not an error.

---

## Method Invocation and Injection

The `Call` method invokes a function, resolving its arguments from the container. Arguments you explicitly provide are used positionally; remaining parameters are resolved via `Make` using the parameter's type string as the service key:

```go
_, err := app.Container().Call(func(dispatcher event.Dispatcher) error {
    return dispatcher.Dispatch(ctx, evt)
})
```

You can also pass some arguments explicitly and let the container resolve the rest:

```go
result, err := app.Container().Call(func(prefix string, count int) (string, error) {
    return fmt.Sprintf("%s-%d", prefix, count), nil
}, "order")
// The container resolves "int" as a service (if bound), or passes the positional arg.
```

`Call` returns a `[]any` slice of the function's return values. If the function returns an error as its last value, it is included in the slice and should be checked by the caller.

> **Note**: PrismGo's `Call` is intentionally simpler than Laravel's full method injection. It does not implement contextual binding, tagged resolution, or variadic parameter injection. It is intended for use cases where you have a factory or callback that needs container-resolved arguments.

---

## Container State

### Checking Existence

`Has` checks whether a service is resolvable. It triggers the missing factory loader if no binding is currently registered:

```go
if app.Container().Has("cache.manager") {
    // The service can be resolved.
}
```

`Bound` checks only the current binding table, without triggering the missing factory loader:

```go
if app.Container().Bound("cache.manager") {
    // A binding is registered (but may not yet be resolved).
}
```

Use `Has` when you want to know "can I call `Make` right now?". Use `Bound` when you only want to check if a manual registration has occurred (e.g., to avoid double-registering in a test).

### Checking Resolution State

`Resolved` returns `true` if the service has already produced an instance. For `Instance`, this is true immediately after registration. For `Singleton`, it becomes true after the first successful `Make`:

```go
if app.Container().Resolved("cache.manager") {
    // The singleton has been instantiated.
}
```

### Listing Entries

`List` returns metadata about all known services in registration order. It does not trigger the missing factory loader or execute factories:

```go
entries := app.Container().List()
for _, entry := range entries {
    fmt.Printf("key=%s type=%s registered=%v closable=%v group=%s\n",
        entry.Key, entry.Type, entry.Registered, entry.Closable, entry.CloseGroup)
}
```

Each `EntryInfo` contains:

| Field | Description |
| --- | --- |
| `Key` | The service key |
| `Type` | The resolved type string (e.g., `*cache.Manager`) |
| `Registered` | Whether the service currently holds a value |
| `Closable` | Whether the service has a closer registered |
| `CloseGroup` | The close group for shutdown ordering |

`List` is useful for diagnostics, testing shutdown behaviour, and auditing resource leaks.

### Resetting Services

`Forget` clears a service's resolved instance and factory, allowing it to be re-registered or re-resolved:

```go
app.Container().Forget("cache.manager")
_ = app.Container().Singleton("cache.manager", newTestCache)
```

`Forget` does **not** call the service's closer. If the service holds external resources, close them manually before calling `Forget`.

---

## Resource Lifecycle

### Close Groups

PrismGo's container provides a structured shutdown mechanism. When the application exits, it calls `Close` or `CloseGroup` to release resources in the **reverse order** of registration.

Two built-in close groups are available:

| Group | Constant | Description |
| --- | --- | --- |
| Normal | `CloseGroupNormal` | Default group. Resources are released before error reporters. |
| Reporting | `CloseGroupReporting` | Logger, exception handler, and error reporter resources. Released after normal resources, ensuring reporting is available during normal shutdown. |

```go
// Release all registered resources in reverse order.
err := app.Container().Close(ctx)

// Release only the "reporting" group.
err := app.Container().CloseGroup(ctx, container.CloseGroupReporting)
```

### Customising Close Behaviour

#### Close Order

Services are closed in the **reverse** of their registration order. If service `A` depends on service `B`, register `B` first, then `A`. During shutdown, `A` is closed before `B`.

#### Closers

A closer is a function that releases a service's external resources. It is registered via `WithCloser` or `WithContextCloser` at binding time:

```go
app.Container().Singleton("db.connection", newDBConnection,
    container.WithContextCloser(func(ctx context.Context, conn *DBConnection) error {
        return conn.Close(ctx)
    }),
)
```

- `WithCloser[T]`: The closer receives the typed value and a background context.
- `WithContextCloser[T]`: The closer receives the typed value and the application's close context, which may carry a timeout or cancellation signal.

Only `Singleton` and `Instance` bindings can have closers. `Bind` (transient) services are not retained by the container and are never closed.

### Graceful Close Semantics

The `Close` method follows these semantics:

- If the context is cancelled before `Close` starts, no state is changed.
- Services whose closer succeeds (or that have no closer) are cleared.
- If a closer returns an error, the service retains its registered state (so the caller can inspect or retry).
- If the context is cancelled mid-close, remaining services retain their registered state.

This design allows the caller to retry closing remaining resources after resolving failures:

```go
err := app.Container().Close(ctx)
if err != nil {
    // Inspect which services remain via List()
    remaining := app.Container().List()
    // Log or retry closing the remaining ones.
}
```

---

## Missing Factory Loader

The missing factory loader is a callback invoked when `Make`, `Has`, or `Factory` cannot find a registered binding. This enables **deferred provider** support: services like `cache.manager` or `queue.manager` are registered only on first access, rather than eagerly at startup.

The loader is installed via `SetMissingFactoryLoader`:

```go
app.Container().SetMissingFactoryLoader(func(key string) error {
    // Load the provider that registers "cache.manager"
    return loadDeferredProvider(key)
})
```

The loader should only register bindings for the given key — it should not create heavy resources. If the loader returns an error, `Has` treats the service as unresolvable and `Make` / `Factory` propagate the error to the caller.

This mechanism is used internally by the PrismGo foundation to support lazy-loaded service providers.

---

## Package-Level Facade

The `container` package provides convenience functions that operate on the **current application container**. These are the primary way to resolve services in business code, as they avoid the need to pass the container instance explicitly:

```go
import "github.com/prismgo/framework/container"
```

| Function | Description |
| --- | --- |
| `Make[T](key)` | Type-safe resolve from the current application container |
| `Value[T](key)` | Read an already-resolved singleton (no creation) |
| `Close(ctx)` | Close all registered resources in the current container |
| `List()` | List all known entries in the current container |
| `SetProvider(provider)` | Inject the current container provider (called by `foundation`) |

The current container provider is injected by `foundation.NewApplication` and cleared on `Application.Close`. If no current container is set, `Make[T]` returns `ErrNoCurrentContainer`.

---

## Error Constants

| Error Constant | Description |
| --- | --- |
| `container.ErrFactoryNotRegistered` | No factory is registered for the requested service key |
| `container.ErrFactoryReturnedNil` | The factory executed successfully but returned `nil` |
| `container.ErrNoCurrentContainer` | Package-level operation attempted without a current application container |

All errors are comparable with `errors.Is`:

```go
_, err := container.Make[*CacheManager]("cache.manager")
if errors.Is(err, container.ErrNoCurrentContainer) {
    // Application is not initialised.
}
```

---

## Laravel Container Mapping

| Laravel | PrismGo Equivalent |
| --- | --- |
| `$app->bind($key, $factory)` | `app.Container().Bind(key, factory)` |
| `$app->singleton($key, $factory)` | `app.Container().Singleton(key, factory)` |
| `$app->instance($key, $instance)` | `app.Container().Instance(key, instance)` |
| `$app->alias($key, $alias)` | `app.Container().Alias(key, alias)` |
| `$app->make($key)` | `app.Container().Make(key)` |
| `$app->resolved($key)` | `app.Container().Resolved(key)` |
| `$app->bound($key)` | `app.Container().Bound(key)` |
| `App::make($key)` | `container.Make[T](key)` |
| `$app->call($callback)` | `app.Container().Call(callback)` |
| — | `container.Value[T](key)` (read existing instance) |
| — | `container.Close(ctx)` (resource lifecycle) |
| `$app->tag($keys, $tag)` | Not directly supported; use service keys |
| `$app->when($class)->needs($iface)->give($impl)` | Not directly supported (no contextual binding) |
