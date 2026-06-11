# Service Providers

- [Introduction](#introduction)
- [Writing Service Providers](#writing-service-providers)
    - [The Register Method](#the-register-method)
    - [The Boot Method](#the-boot-method)
- [Registering Providers](#registering-providers)
- [Deferred Providers](#deferred-providers)
- [Terminable Providers](#terminable-providers)

## Introduction

Service providers are the central place of all Prismgo application bootstrapping. Your own application, as well as all of Prismgo's core services, are bootstrapped via service providers.

But, what do we mean by "bootstrapped"? In general, we mean **registering** things, including registering service container bindings, event listeners, middleware, and even routes. Service providers are the central place to configure your application.

Prismgo uses a set of default service providers internally to bootstrap its core services, such as the cache, queue, database, and others. Many of these providers are "deferred" providers, meaning they will not be loaded on every request, but only when the services they provide are actually needed.

All user-defined service providers are registered in the `bootstrap/provider.go` file. In the following documentation, you will learn how to write your own service providers and register them with your Prismgo application.

If you would like to learn more about how Prismgo handles requests and works internally, check out our documentation on the Prismgo [application lifecycle](/docs/{{version}}/lifecycle).

## Writing Service Providers

All service providers implement the `ServiceProvider` interface from `github.com/prismgo/framework/contracts/provider`. Most service providers contain a `Register` and a `Boot` method. Within the `Register` method, you should **only bind things into the [service container](/docs/{{version}}/container)**. You should never attempt to register any event listeners, routes, or any other piece of functionality within the `Register` method.

Let's create a basic service provider. The `Register` method is where you bind your services into the container, and the `Boot` method is where you perform post-registration tasks:

```go
package providers

import (
    providercontract "github.com/prismgo/framework/contracts/provider"
)

type AppServiceProvider struct{}

func (p AppServiceProvider) Register(app providercontract.Application) error {
    return nil
}

func (p AppServiceProvider) Boot(app providercontract.Application) error {
    return nil
}
```

### The Register Method

As mentioned previously, within the `Register` method, you should only bind things into the [service container](/docs/{{version}}/container). You should never attempt to register any event listeners, routes, or any other piece of functionality within the `Register` method. Otherwise, you may accidentally use a service that is provided by a service provider which has not loaded yet.

Let's take a look at a basic service provider. Within any of your service provider methods, you have access to the `app` parameter, which provides access to the service container through `app.Container()`:

```go
type CacheServiceProvider struct{}

func (CacheServiceProvider) Register(app providercontract.Application) error {
    c := app.Container()

    if c.Bound("cache.manager") {
        return nil
    }

    return c.Singleton("cache.manager", func(resolver containercontract.Resolver) (any, error) {
        cfg, err := buildConfig()
        if err != nil {
            return nil, err
        }
        return NewManager(cfg)
    }, container.WithCloser(func(m *Manager) error {
        return m.Close()
    }))
}
```

This service provider only defines a `Register` method, and uses that method to define an implementation of the cache manager in the service container. The `Bound` check ensures that if the container already has a binding — for example, when a test has explicitly injected a fake — the provider won't overwrite it.

#### Container Binding Methods

The service container supports several binding methods within your provider's `Register` method:

```go
// Bind registers a transient service — a new instance is created on every resolution.
c.Bind("transient.service", func(resolver containercontract.Resolver) (any, error) {
    return NewTransientService()
})

// Singleton registers a shared service — the instance is cached after the first resolution.
c.Singleton("shared.service", func(resolver containercontract.Resolver) (any, error) {
    return NewSharedService()
})

// Instance registers an already-constructed value directly.
c.Instance("existing.service", myService)

// Alias creates an alternative name for an existing binding.
c.Alias("shared.service", "my.service.alias")
```

#### Binding Options

When registering a binding, you can attach options that control lifecycle behavior:

```go
c.Singleton("cache.manager", factory,
    // WithCloser registers a cleanup function called during application shutdown.
    container.WithCloser(func(m *Manager) error {
        return m.Close()
    }),
    // WithCloseGroup assigns the resource to a specific shutdown phase.
    // CloseGroupNormal runs first; CloseGroupReporting runs last (for error loggers, etc.).
    container.WithCloseGroup(container.CloseGroupReporting),
)
```

### The Boot Method

So, what if we need to register event listeners within our service provider? This should be done within the `Boot` method. **This method is called after all other service providers have been registered**, meaning you have access to all other services that have been registered by the framework:

```go
type ListenerProvider struct{}

func (p ListenerProvider) Register(app providercontract.Application) error {
    return nil
}

func (p ListenerProvider) Boot(app providercontract.Application) error {
    // Resolve the event dispatcher — it's guaranteed to be available at this point
    raw, err := app.Container().Make("event.dispatcher")
    if err != nil {
        return err
    }
    bus, ok := raw.(eventcontract.Dispatcher)
    if !ok || bus == nil {
        return fmt.Errorf("listener provider: unexpected type %T", raw)
    }

    // Resolve database connection and construct business services
    rawDB, err := app.Container().Make("database.default")
    if err != nil {
        return err
    }
    db := rawDB.(*gorm.DB)

    notificationService := services.NewNotificationService(db)
    listeners.Register(bus, notificationService)
    return nil
}
```

This provider's `Register` method is empty — it has no container bindings of its own. Its `Boot` method resolves the already-registered event dispatcher and database connection, constructs a notification service, and registers all business event listeners.

#### Declaring Commands

If your provider needs to register Artisan-style console commands, you can use the `provider.Commands` helper within the `Boot` method. The commands are not mounted immediately — they are deferred to the console kernel's starting phase, so HTTP-only boots won't be affected:

```go
func (ServiceProvider) Boot(providerApplication) error {
    return provider.Commands(
        cmd.NewInstallCommand(),
        cmd.NewWorkCommand(),
    )
}
```

The `provider.Commands` function accepts either pre-constructed `console.Command` instances or `console.CommandFactory` functions. Command definition validation, duplicate checking, and alias conflict resolution are all handled by the console kernel when it starts.

#### Vendor Publish

In development environments, providers can declare resources that should be published into the application directory — configuration files, migrations, language files, and more. This is done via `provider.Publishes` in the `Boot` method:

```go
func (ServiceProvider) Boot(providerApplication) error {
    if err := provider.Publishes("my-provider", map[string]string{
        "config/my-service.php": app.ConfigPath("my-service.php"),
        "migrations":            app.DatabasePath("migrations"),
    }, "config", "migrations"); err != nil {
        return err
    }
    return nil
}
```

The first argument is the provider's stable identity (the value returned by `Name()`). The second argument is a map of relative source paths to absolute target paths. The remaining arguments are tags that allow filtering when running `vendor:publish`. In production, `Publishes` silently does nothing — it's a development-only feature.

## Registering Providers

All service providers are registered in the `bootstrap/provider.go` file. This file returns a slice that contains the providers for your application:

```go
package bootstrap

import (
    appproviders "yourapp/app/providers"
    "github.com/prismgo/framework/provider"
)

func Providers() []provider.ServiceProvider {
    return []provider.ServiceProvider{
        appproviders.AppServiceProvider{},
        appproviders.ListenerProvider{},
    }
}
```

Framework default providers — for `redis`, `cache`, `queue`, `cookie`, `session`, `filesystem`, `database`, `schema`, and `route` — are automatically prepended by the `foundation.Builder`, so you do not need to list them in `bootstrap/provider.go`. Your application's providers are loaded after the framework defaults, which means your providers can safely depend on and override any framework binding.

The complete provider loading order is:

1. **Base providers** (registered immediately): `event` → `config` → `logger` → `translation`
2. **Default providers** (registered during `Boot()`): `redis` → `cache` → `queue` → `cookie` → `session` → `filesystem` → `database` → `schema` → `route`
3. **Your application providers** (registered during `Boot()`): in the order returned by `bootstrap/provider.go`

#### Provider Identity

Each provider is identified within the repository by a unique identity string. If the provider implements the `NamedProvider` interface and `Name()` returns a non-empty string, that string is used as the identity. Otherwise, the full Go type path (with pointer indirection removed) is used:

```go
// Explicit identity — recommended for providers that need a stable name
func (HorizonServiceProvider) Name() string { return "app.horizon" }

// Implicit identity — uses the Go type path
// "yourapp/app/providers.AppServiceProvider"
```

If the same identity is registered twice, the second registration is silently ignored and the first provider instance is reused.

## Deferred Providers

If your provider is **only** registering bindings in the [service container](/docs/{{version}}/container), you may choose to defer its registration until one of the registered bindings is actually needed. Deferring the loading of such a provider will improve the performance of your application, since it is not loaded from the filesystem on every request.

Prismgo stores a map of all of the services supplied by deferred service providers, along with the identity of the provider. Then, only when you attempt to resolve one of these services does Prismgo load the service provider.

To defer the loading of a provider, implement the `DeferrableProvider` interface and define a `Provides` method. The `Provides` method should return the service container bindings registered by the provider:

```go
type MyServiceProvider struct{}

func (MyServiceProvider) Register(app providercontract.Application) error {
    c := app.Container()
    if c.Bound("my.service") {
        return nil
    }
    return c.Singleton("my.service", func(resolver containercontract.Resolver) (any, error) {
        return NewMyService()
    })
}

func (MyServiceProvider) Boot(app providercontract.Application) error {
    return nil
}

func (MyServiceProvider) Provides() []string {
    return []string{"my.service"}
}
```

When a deferred provider is loaded, both its `Register` and `Boot` methods are executed in sequence, and then the deferred mappings are removed from the repository. If the application is already booted when the deferred provider is first resolved, the `Boot` phase is executed immediately after `Register`.

A few things to keep in mind with deferred providers:

- The `Provides` method must return at least one service key. An empty slice will cause a registration error.
- The same service key cannot be provided by more than one deferred provider.
- Deferred providers do not participate in the `Terminate` phase unless they have been loaded (i.e., their service was resolved at some point).

## Terminable Providers

If your provider manages external resources — such as database connection pools, background workers, or file watchers — you may wish to perform cleanup when the application shuts down. This is done by implementing the `TerminableProvider` interface and defining a `Terminate` method.

The `Terminate` method receives the shutdown context, which is cancelled by `SIGINT`/`SIGTERM` or when `RunContext`'s runner function returns:

```go
type TerminableProvider interface {
    Terminate(ctx context.Context) error
}
```

Let's look at an example. Suppose your provider manages a long-running worker pool that needs to be gracefully drained on shutdown:

```go
type WorkerServiceProvider struct{}

func (WorkerServiceProvider) Register(app providercontract.Application) error {
    c := app.Container()
    if c.Bound("worker.pool") {
        return nil
    }
    return c.Singleton("worker.pool", func(resolver containercontract.Resolver) (any, error) {
        return NewWorkerPool(), nil
    })
}

func (WorkerServiceProvider) Boot(app providercontract.Application) error {
    raw, err := app.Container().Make("worker.pool")
    if err != nil {
        return err
    }
    pool := raw.(*WorkerPool)
    pool.Start()
    return nil
}

func (WorkerServiceProvider) Terminate(ctx context.Context) error {
    raw, err := container.MakeFrom[*WorkerPool](ctx, "worker.pool")
    if err != nil {
        return err
    }
    return pool.Drain(ctx)
}
```

During shutdown, `Application.Close()` calls `Terminate` on all eligible providers in **reverse repository order** — so providers that depend on services registered by other providers release their resources first.

A few things to keep in mind with terminable providers:

- Only providers whose `Register` method has completed successfully participate in the `Terminate` phase. If a provider failed during `Register`, it is skipped.
- Deferred providers that have never been loaded (their service was never resolved) do not participate in `Terminate`.
- The `Terminate` method receives the application's shutdown context, so you can honour timeouts during cleanup.
- If you also register closer callbacks via `container.WithCloser` in `Register`, those run after the `Terminate` phase — in a separate step managed by the container.

You can combine all three optional interfaces on a single provider:

```go
type FullLifecycleProvider struct{}

func (FullLifecycleProvider) Register(app providercontract.Application) error { /* ... */ return nil }
func (FullLifecycleProvider) Boot(app providercontract.Application) error     { /* ... */ return nil }
func (FullLifecycleProvider) Provides() []string                              { return []string{"my.service"} }
func (FullLifecycleProvider) Terminate(ctx context.Context) error             { /* ... */ return nil }
```

### On this page

- [Introduction](#introduction)
- [Writing Service Providers](#writing-service-providers)
    - [The Register Method](#the-register-method)
    - [The Boot Method](#the-boot-method)
- [Registering Providers](#registering-providers)
- [Deferred Providers](#deferred-providers)
- [Terminable Providers](#terminable-providers)