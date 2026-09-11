# Application Lifecycle

- [Introduction](#introduction)
- [Lifecycle Overview](#lifecycle-overview)
    - [First Steps](#first-steps)
    - [Application Bootstrap](#application-bootstrap)
    - [Service Providers](#service-providers)
    - [HTTP Request Handling](#http-request-handling)
    - [Console Commands](#console-commands)
    - [Shutdown](#shutdown)
- [Lifecycle Events](#lifecycle-events)

## Introduction

When using any tool in the "real world", you feel more confident if you understand how that tool works. Application development is no different. When you understand how your development tools function, you feel more comfortable and confident using them.

The goal of this document is to give you a good, high-level overview of how the Prismgo framework works under the hood. By getting to know the overall framework better, everything feels less "magical" and you will be more confident building your applications. If you don't understand all of the terms right away, don't lose heart! Just try to get a basic grasp of what is going on, and your knowledge will grow as you explore other sections of the documentation.

## Lifecycle Overview

### First Steps

The entry point for a Prismgo application is `main.go`. This file is where the application instance is created, configured, and handed off to either the HTTP server or the console kernel. The `main.go` file doesn't contain much code. Rather, it is a starting point for loading the rest of the framework.

The first action taken by Prismgo is to create an instance of the application via `bootstrap.NewApplication()`. This calls `foundation.Configure()`, which builds up an `Application` instance and registers all the framework's [service providers](/docs/{{version}}/service-provider).

For the full flow from installation to your first endpoint, see [Getting Started](starter.md). For HTTP server configuration and `serve` process control, see [HTTP Server](http-server.md).

```go
package main

import (
    "fmt"
    "os"

    "yourapp/bootstrap"

    _ "github.com/joho/godotenv/autoload"
)

func main() {
    app := bootstrap.NewApplication()

    if err := app.RunContext(func(ctx context.Context) error {
        return app.NewHTTPServer(ctx, "8051").ListenAndServe()
    }); err != nil {
        fmt.Fprintf(os.Stderr, "application: %v\n", err)
        os.Exit(1)
    }
}
```

### Application Bootstrap

After creating the `Application` instance via `foundation.Configure().Create()`, the framework begins the bootstrap sequence. This is handled by `Application.Boot()`, which is automatically invoked by `RunContext` before your runner function executes.

The bootstrap phase performs these tasks in order:

1. **Base providers are registered immediately.** The `event`, `config`, `logger`, and `translation` providers execute their `Register` methods as soon as the `Application` is constructed — before any other provider is added — so that the event bus and configuration are available from the very beginning.

2. **Default framework providers are added to the repository.** The providers for `redis`, `cache`, `queue`, `cookie`, `session`, `filesystem`, `database`, `schema`, and `route` are added in dependency order. At this point they are only queued; their `Register` and `Boot` methods have not yet run.

3. **Extension providers are added.** Third-party or optional module providers declared through `WithExtensionProviders(...)` are appended after the framework defaults. Extensions can therefore register database, queue, or filesystem drivers while depending on core framework bindings; for example, `oss.ServiceProvider{}` installs a lazy driver factory on the current Application's filesystem Manager during Boot.

4. **Your application's providers are added.** Providers returned by `bootstrap/providers.go` and declared through `WithProviders(...)` are appended after extension providers, so business providers can safely depend on or override framework and extension bindings.

5. **The exception handler is built.** Prismgo constructs the default [exception handler](/docs/{{version}}/exception) with recovery, logging, and panic stack recording, then registers it into the container.

At this point the `Application` object is fully assembled, but none of the providers (except the base ones) have executed their lifecycle methods. The real work begins when `Boot()` is called.

### Service Providers

The `Application.Boot()` method is where the real bootstrap happens. It iterates through all of the registered providers and executes their lifecycle methods in two distinct phases:

**Phase 1 — Register:** The `Register` method is called on every provider in repository order. During this phase, providers should **only** bind things into the [service container](/docs/{{version}}/service-provider). They should not attempt to read configuration files, establish connections, register event listeners, or do anything else that might depend on services that haven't been registered yet.

```go
func (ServiceProvider) Register(app providercontract.Application) error {
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

**Phase 2 — Boot:** Once every provider has been registered, the `Boot` method is called on each provider, again in repository order. Because all `Register` methods have already completed, you now have access to every container binding that has been registered — and you can safely register event listeners, mount middleware, declare publishable resources, or wire up cross-service bridges.

```go
func (ServiceProvider) Boot(providerApplication) error {
    UseEventSink(func(ctx context.Context, ev CacheEvent) {
        dispatchCurrentEvent(ctx, ev)
    })
    return nil
}
```

After both phases complete for all eager providers, Prismgo dispatches the `app.booted` event, and your `RunContext` runner function begins executing.

Essentially every major feature offered by Prismgo is bootstrapped and configured by a service provider. Since they bootstrap and configure so many features offered by the framework, service providers are the most important aspect of the entire Prismgo bootstrap process.

The stable provider layering is: framework defaults → extension providers → application providers. Register and Boot both use this order; terminable providers run in reverse order during shutdown. Use `WithExtensionProviders(...)` for extensions such as third-party drivers, and `WithProviders(...)` for application business capabilities.

#### Deferred Providers

If a provider is **only** registering bindings in the service container, you may choose to defer its registration until one of the registered bindings is actually needed. Deferred providers do not participate in the `Boot()` lifecycle — their `Register` and `Boot` methods are only executed when something attempts to resolve one of the service keys they provide.

Prismgo stores a map of all service keys to their deferred provider identities. Then, only when you attempt to resolve one of these services does Prismgo load and boot the provider. This improves application startup performance, since deferred providers are not loaded from disk on every boot.

To defer the loading of a provider, implement the `DeferrableProvider` interface and define a `Provides` method that returns the service container bindings registered by the provider:

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

#### Dynamic Provider Registration

The application can accept new providers even after it has already booted. When you call `app.RegisterProvider()` on a booted application, Prismgo will immediately execute the provider's `Register` and `Boot` methods — so it integrates into the running application seamlessly:

```go
app.Boot()

// Dynamically add a provider after boot — Register and Boot execute immediately
if err := app.RegisterProvider(customProvider{}); err != nil {
    return err
}
```

### HTTP Request Handling

Once the application has been bootstrapped and all service providers have been registered, the HTTP server begins listening. When a request arrives, it flows through the following pipeline:

1. The Gin engine receives the request.
2. If the `RequestID` middleware is mounted, a unique request ID is generated and attached to the context.
3. The access log middleware records the incoming request.
4. The unified `ExceptionHandler` middleware wraps the remainder of the pipeline, providing [panic recovery, error rendering, and error logging](/docs/{{version}}/exception).
5. Business middleware executes — authentication, tenant validation, permission injection, and any custom middleware you've registered.
6. The router matches the request to a route and dispatches it to the appropriate controller method.
7. The controller method executes your business logic and returns a response.
8. The response travels back outward through the middleware chain.
9. The `ExceptionHandler` captures any errors that were recorded but not yet written to the response.
10. Error logs are written to `logger.Channel("error")`.
11. The response is sent to the client.

If the request passes through all of the matched route's assigned middleware, the route or controller method will be executed and the response returned by the route or controller method will be sent back through the route's chain of middleware.

### Console Commands

Prismgo also supports Artisan-style console commands. The lifecycle of a console command is separate from the HTTP request lifecycle, and flows through the console kernel:

1. `main.go` calls `app.HandleCommand(ctx, argv)`, creating a console kernel from the current application runtime.
2. The kernel enters its starting phase, dispatching `console.application.starting` and executing any registered starting callbacks — this is where provider-declared commands are mounted.
3. The command signature is parsed and the matching command is resolved.
4. The `console.command.starting` event is dispatched.
5. The command's `Handle` method is executed.
6. When the command finishes, `console.command.finished` is dispatched with timing and error information.

The console kernel and HTTP server share the same `Application` instance, so all container bindings, configuration, and bootstrapped services are available to both.

### Shutdown

When the runner function returns — either because it completed normally, or because a system signal (SIGINT/SIGTERM) was received — `RunContext` calls `Application.Close()` to gracefully shut everything down.

The shutdown sequence proceeds in this order:

1. The application's root context is cancelled, signaling all long-running goroutines to stop.
2. The `app.terminating` event is dispatched, giving listeners a chance to perform pre-shutdown tasks.
3. All providers that implement the `TerminableProvider` interface have their `Terminate` method called — in **reverse repository order**, so providers that depend on others release their resources first.
4. Cleanup functions registered via `app.RegisterCleanup()` are executed, also in reverse order.
5. The container's normal resources (database connections, Redis connections, file handles) are closed.
6. Any shutdown errors are reported through the remaining reporting resources (error logger, exception reporter).
7. The container's reporting resources are closed.
8. The `app.terminated` event is dispatched with the total shutdown duration and any errors that occurred.

If any container resources fail to close, `CloseContext` can be called again — it will only retry the resources that haven't been released yet, without re-executing the provider terminate or cleanup phases.

## Lifecycle Events

Prismgo dispatches [events](/docs/{{version}}/event) at key points throughout the lifecycle. These events are dispatched on a best-effort basis — if the event dispatcher is not yet available (because the event provider itself hasn't booted), the event is simply skipped without affecting the bootstrap result.

Here are the lifecycle events that you can listen for in your application:

| Event | Payload | When It Fires |
| --- | --- | --- |
| `app.booting` | `AppBooting{Args}` | After all Register phases complete, before Boot begins |
| `app.booted` | `AppBooted{Duration}` | After Boot completes for all providers |
| `app.terminating` | `AppTerminating{Reason}` | Shutdown begins, after context cancellation |
| `app.terminated` | `AppTerminated{Duration, Error}` | Shutdown completes, all resources released |
| `app.provider.registering` | `ProviderRegistering{Provider}` | Before a single provider's Register method |
| `app.provider.registered` | `ProviderRegistered{Provider}` | After a single provider's Register method |
| `app.provider.booting` | `ProviderBooting{Provider}` | Before a single provider's Boot method |
| `app.provider.booted` | `ProviderBooted{Provider}` | After a single provider's Boot method |
| `server.starting` | `ServerStarting{Addr, PID}` | Before the HTTP server begins listening |
| `server.started` | `ServerStarted{Addr, PID}` | After the HTTP server begins listening |
| `server.stopping` | `ServerStopping{Addr, Reason}` | Graceful shutdown of the HTTP server begins |
| `server.stopped` | `ServerStopped{Addr, Duration, Error}` | The HTTP server has stopped |
| `request.received` | `RequestReceived{Method, Path, ClientIP, RequestID, ReceivedAt}` | An HTTP request enters the routing layer |
| `request.handled` | `RequestHandled{Method, Path, RequestID, Status, Duration}` | An HTTP request completes successfully |
| `request.failed` | `RequestFailed{Method, Path, RequestID, Status, Duration, Error, Stack}` | An HTTP request ends with a 5xx error or panic |
| `request.finished` | `RequestFinished{Method, Path, RequestID, Status, Duration, Error}` | An HTTP request is fully finished (always dispatched, regardless of outcome) |
| `console.application.starting` | `ConsoleApplicationStarting{KernelName}` | The console kernel enters its starting phase |
| `console.command.starting` | `CommandStarting{Command, Input}` | A console command is about to execute |
| `console.command.finished` | `CommandFinished{Command, Succeeded, Error, Duration}` | A console command has finished executing |

### Listening to Lifecycle Events

You can listen for lifecycle events in your service provider's `Boot` method — by that point the event dispatcher is guaranteed to be available:

```go
func (p *AppServiceProvider) Boot(app providercontract.Application) error {
    bus, err := container.Make[eventcontract.Dispatcher]("event.dispatcher")
    if err != nil || bus == nil {
        return err
    }

    bus.Listen(event.EventAppBooted, listener.New(func(ctx context.Context, ev event.AppBooted) error {
        logger.Channel("app").WithField("duration_ms", ev.Duration.Milliseconds()).Info("app booted")
        return nil
    }))

    bus.Listen(event.EventRequestFinished, listener.New(func(ctx context.Context, ev event.RequestFinished) error {
        if ev.Status >= 500 {
            logger.Channel("error").WithError(fmt.Errorf(ev.Error)).
                WithField("method", ev.Method).
                WithField("path", ev.Path).
                WithField("duration_ms", ev.Duration.Milliseconds()).
                Error("request failed")
        }
        return nil
    }))

    return nil
}
```

Note that lifecycle event payloads only contain primitive types — strings, integers, durations, and errors — intentionally avoiding `gin.Context`, `http.Server`, or other runtime objects that would couple the event layer to specific infrastructure.

### On this page

- [Introduction](#introduction)
- [Lifecycle Overview](#lifecycle-overview)
    - [First Steps](#first-steps)
    - [Application Bootstrap](#application-bootstrap)
    - [Service Providers](#service-providers)
    - [HTTP Request Handling](#http-request-handling)
    - [Console Commands](#console-commands)
    - [Shutdown](#shutdown)
- [Lifecycle Events](#lifecycle-events)
