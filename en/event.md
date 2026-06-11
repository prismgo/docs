# Events

- [Introduction](#introduction)
- [Registering Events and Listeners](#registering-events-and-listeners)
  - [Manually Registering Listeners](#manually-registering-listeners)
  - [Closure Listeners](#closure-listeners)
  - [Wildcard Event Listeners](#wildcard-event-listeners)
- [Defining Events](#defining-events)
- [Defining Listeners](#defining-listeners)
- [Queued Event Listeners](#queued-event-listeners)
  - [Customizing the Queue Connection, Queue Name, & Delay](#customizing-the-queue-connection-queue-name--delay)
  - [Registering Event Factories](#registering-event-factories)
- [Dispatching Events](#dispatching-events)
- [Event Subscribers](#event-subscribers)
  - [Writing Event Subscribers](#writing-event-subscribers)
  - [Registering Event Subscribers](#registering-event-subscribers)
- [Global Facade](#global-facade)
- [Async Listeners](#async-listeners)
- [Lifecycle Events](#lifecycle-events)
  - [Application Lifecycle](#application-lifecycle)
  - [Provider Lifecycle](#provider-lifecycle)
  - [HTTP Server Lifecycle](#http-server-lifecycle)
  - [HTTP Request Lifecycle](#http-request-lifecycle)
  - [Console Lifecycle](#console-lifecycle)
  - [Vendor Publish Event](#vendor-publish-event)
- [Error and Panic Handling](#error-and-panic-handling)
- [Testing](#testing)
- [Best Practices](#best-practices)
- [Interface Reference](#interface-reference)
  - [Event](#event)
  - [Listener](#listener)
  - [ListenerFunc](#listenerfunc)
  - [Dispatcher](#dispatcher)
  - [Subscriber](#subscriber)
  - [ShouldQueue](#shouldqueue)
  - [AsyncListener](#asynclistener)
  - [QueueOptionsProvider](#queueoptionsprovider)
- [ServiceProvider](#serviceprovider)
- [Laravel 13 Differences](#laravel-13-differences)

---

## Introduction

PrismGo's event system provides a simple observer pattern implementation, allowing you to subscribe and listen for various events that occur within your application. Event classes are typically stored in the `app/events` directory, while listeners are stored in `app/listeners`.

Events serve as a great way to decouple various aspects of your application, since a single event can have multiple listeners that do not depend on each other. For example, you may wish to send a notification each time a work order has been created. Instead of coupling your work order processing code to your notification code, you can dispatch a `workorder.created` event which a listener can receive and use to send the notification.

The `github.com/prismgo/framework/event` package provides a Laravel-style event bus with the following core features:

- Synchronous dispatch by default; individual listeners can opt into goroutine-async or queue-async execution
- Listeners are isolated from each other: a panic or error in one listener does not affect the others
- Supports exact event name matching, as well as `"*"` (match all) and `"<prefix>.*"` (prefix match) wildcards
- Zero business coupling; reusable across projects

## Registering Events and Listeners

### Manually Registering Listeners

PrismGo does not support automatic event discovery; all listeners must be explicitly registered. In the current project, business listeners are centrally registered in `app/listeners/register.go`:

```go
package listeners

import (
    "context"

    eventcontract "github.com/prismgo/framework/contracts/event"
    "github.com/prismgo/framework/event"
    "github.com/prismgo/framework/logger"
    "yourapp/app/services"
)

func Register(bus eventcontract.Dispatcher, notificationSvc *services.NotificationService) {
    if bus == nil {
        return
    }
    registerLifecycleProbes(bus)
    if notificationSvc != nil {
        bus.Subscribe(&notificationSubscriber{svc: notificationSvc})
    }
}
```

Use the `Listen` method to register struct listeners:

```go
bus.Listen("workorder.created", &WorkorderCreatedListener{
    notifications: notificationSvc,
})
```

### Closure Listeners

Use `ListenFunc` to register function-based listeners, suitable for lightweight logic:

```go
bus.ListenFunc("workorder.created", func(ctx context.Context, ev event.Event) error {
    e := ev.(WorkorderCreated)
    return notificationSvc.SendWorkorderCreated(ctx, e.TenantID, e.WorkorderID, e.OperatorID)
})
```

### Wildcard Event Listeners

Two types of wildcards are supported:

- `"*"`: Matches all events
- `"<prefix>.*"`: Matches all events with the specified prefix, e.g., `workorder.*` matches `workorder.created`, `workorder.assigned`, etc.

```go
// Listen to all workorder-prefixed events
bus.ListenFunc("workorder.*", func(ctx context.Context, ev event.Event) error {
    logger.WithFields(map[string]any{
        "event": ev.Name(),
    }).Info("workorder event fired")
    return nil
})

// Listen to all events
bus.ListenFunc("*", func(ctx context.Context, ev event.Event) error {
    logger.WithFields(map[string]any{
        "event": ev.Name(),
    }).Debug("event fired")
    return nil
})
```

Wildcards are best suited for logging, monitoring, debugging, and metrics collection. Core business logic should prefer listening to explicit event names.

> **Note**: `Forget` and `Has` only operate on exact event names; they do not affect or inspect wildcard listeners.

## Defining Events

An event is a plain Go struct that implements the `Event` interface's `Name() string` method:

```go
package events

const EventWorkorderCreated = "workorder.created"

type WorkorderCreated struct {
    TenantID    uint `json:"tenant_id"`
    WorkorderID uint `json:"workorder_id"`
    OperatorID  uint `json:"operator_id"`
}

func (WorkorderCreated) Name() string {
    return EventWorkorderCreated
}
```

Event names should use the `<domain>.<action>` format, all lowercase with dot separators:

```text
workorder.created
workorder.assigned
followup.submitted
notification.failed
```

Event payloads should only contain necessary fields or safely serializable snapshots. Do not carry `gin.Context`, database connections, transaction objects, services, repositories, or other runtime resources.

## Defining Listeners

### Struct Listeners

Struct listeners are suitable for scenarios with many dependencies, complex logic, or a need for isolated testing:

```go
type WorkorderCreatedListener struct {
    notifications *NotificationService
}

func (l *WorkorderCreatedListener) Handle(ctx context.Context, ev event.Event) error {
    e := ev.(events.WorkorderCreated)
    return l.notifications.SendWorkorderCreated(ctx, e.TenantID, e.WorkorderID, e.OperatorID)
}
```

Registration:

```go
bus.Listen(events.EventWorkorderCreated, &WorkorderCreatedListener{
    notifications: notificationSvc,
})
```

### Function Listeners

For lightweight logic, use `ListenerFunc` directly:

```go
bus.ListenFunc(events.EventWorkorderCreated, func(ctx context.Context, ev event.Event) error {
    e := ev.(events.WorkorderCreated)
    return notificationSvc.SendWorkorderCreated(ctx, e.TenantID, e.WorkorderID, e.OperatorID)
})
```

### Stopping The Propagation Of An Event

PrismGo does not support stopping event propagation by returning `false`. All matching listeners will always be executed. If an action must succeed before the main flow can continue, call it directly in the service rather than using an event.

## Queued Event Listeners

If your listener is going to perform a slow task such as sending an email or making an HTTP request, you can use queued listeners to execute the listener asynchronously in a queue worker. Make sure you have configured `github.com/prismgo/framework/queue` and started a worker before using queued listeners.

### Implementing ShouldQueue

Implement the `ShouldQueue` interface on your listener to have it dispatched to the queue:

```go
type SendWelcomeMailListener struct{}

func (SendWelcomeMailListener) Handle(ctx context.Context, ev event.Event) error {
    e := ev.(*UserRegistered)
    return sendWelcomeMail(ctx, e.UserID)
}

func (SendWelcomeMailListener) ShouldQueue() bool {
    return true
}

bus.Listen("user.registered", SendWelcomeMailListener{})
```

### Using the Queued Wrapper

You can also wrap an existing listener with `event.Queued`:

```go
bus.Listen("user.registered", event.Queued(event.ListenerFunc(func(ctx context.Context, ev event.Event) error {
    e := ev.(*UserRegistered)
    return sendWelcomeMail(ctx, e.UserID)
})))
```

When an event is dispatched, queued listeners are serialized into an internal Job and handed to the `queue.dispatcher` in the current Application container. The `sync` queue connection executes in the current call stack; the `redis` queue connection writes to Redis for a worker to consume.

### Customizing the Queue Connection, Queue Name, & Delay

Queued listeners can implement the `QueueOptionsProvider` interface to customize queue parameters:

```go
type SendWelcomeMailListener struct{}

func (SendWelcomeMailListener) Handle(ctx context.Context, ev event.Event) error {
    e := ev.(*UserRegistered)
    return sendWelcomeMail(ctx, e.UserID)
}

func (SendWelcomeMailListener) ShouldQueue() bool { return true }

func (SendWelcomeMailListener) QueueConnection() string { return "redis" }
func (SendWelcomeMailListener) QueueName() string       { return "mail" }
func (SendWelcomeMailListener) QueueDelay() time.Duration {
    return 10 * time.Second
}
func (SendWelcomeMailListener) QueueTries() int { return 3 }
func (SendWelcomeMailListener) QueueBackoff() []time.Duration {
    return []time.Duration{5 * time.Second, 30 * time.Second}
}
func (SendWelcomeMailListener) QueueTimeout() time.Duration { return 20 * time.Second }
```

`QueueOptionsProvider` method reference:

| Method | Return Type | Description |
| --- | --- | --- |
| `QueueConnection()` | `string` | Queue connection name, e.g., `"redis"`, `"sync"` |
| `QueueName()` | `string` | Queue name, e.g., `"mail"`, `"default"` |
| `QueueDelay()` | `time.Duration` | Delay before dispatching the job |
| `QueueTries()` | `int` | Maximum number of retry attempts |
| `QueueBackoff()` | `[]time.Duration` | Backoff durations between retries |
| `QueueTimeout()` | `time.Duration` | Timeout for a single execution |

### Registering Event Factories

Queued listeners serialize the event to JSON before saving it to the queue payload. When a worker consumes the job, it needs to deserialize the JSON back into the concrete event struct, so you must register an event factory at startup:

```go
type UserRegistered struct {
    UserID uint `json:"user_id"`
}

func (UserRegistered) Name() string { return "user.registered" }

func init() {
    event.RegisterEvent[*UserRegistered]()
}
```

> **Important**: The generic parameter `T` of `RegisterEvent[T]()` must be a pointer to a concrete event struct (e.g., `*UserRegistered`), not an interface or a double pointer. Registration is a startup-time configuration; type errors or empty event names will panic immediately to surface programming errors as early as possible.

If no event factory is registered, the worker cannot restore the payload into a concrete event struct. In this case, it falls back to a `rawQueuedEvent` (preserving only the event name and raw JSON), and the listener cannot access business fields via type assertion.

## Dispatching Events

Call `Dispatch` in your business service to fire an event:

```go
func (s *WorkorderService) Create(ctx context.Context, req CreateWorkorderRequest) error {
    id, err := s.repo.Create(ctx, req)
    if err != nil {
        return err
    }

    s.bus.Dispatch(ctx, events.WorkorderCreated{
        TenantID:    req.TenantID,
        WorkorderID: id,
        OperatorID:  req.OperatorID,
    })
    return nil
}
```

`Dispatch` does not return listener errors. A listener returning an error or panicking will be logged, but will not interrupt subsequent listeners or change the main flow's return value.

When `ctx` is `nil`, it falls back to `context.Background()`; when `ev` is `nil`, the call is ignored.

## Event Subscribers

Event Subscribers allow you to group multiple related event subscriptions in a single object, avoiding scattered `Listen` calls across different locations.

### Writing Event Subscribers

Implement the `Subscriber` interface's `Subscribe(dispatcher Dispatcher)` method:

```go
type WorkorderSubscriber struct {
    notifications *NotificationService
}

func (s *WorkorderSubscriber) Subscribe(bus eventcontract.Dispatcher) {
    bus.ListenFunc(events.EventWorkorderCreated, s.onCreated)
    bus.ListenFunc(events.EventWorkorderAssigned, s.onAssigned)
}

func (s *WorkorderSubscriber) onCreated(ctx context.Context, ev event.Event) error {
    e := ev.(events.WorkorderCreated)
    return s.notifications.SendWorkorderCreated(ctx, e.TenantID, e.WorkorderID, e.OperatorID)
}

func (s *WorkorderSubscriber) onAssigned(ctx context.Context, ev event.Event) error {
    e := ev.(events.WorkorderAssigned)
    return s.notifications.SendWorkorderAssigned(ctx, e.TenantID, e.WorkorderID, e.AssigneeID)
}
```

### Registering Event Subscribers

```go
bus.Subscribe(&WorkorderSubscriber{notifications: notificationSvc})
```

In the current project, business listeners are centralized in `app/listeners/` and registered by a provider at startup.

## Global Facade

Business code should prefer using `eventcontract.Dispatcher` via dependency injection. For commands, scheduled tasks, or infrastructure code without a DI chain, the package-level facade can be used:

```go
event.ListenFunc("workorder.created", onWorkorderCreated)
event.Dispatch(ctx, events.WorkorderCreated{WorkorderID: 1001})
```

| Method | Description |
| --- | --- |
| `event.Resolve()` | Resolve the event bus from the current Application container |
| `event.Dispatch(ctx, ev)` | Dispatch an event using the global bus |
| `event.Listen(name, listener)` | Register a listener using the global bus |
| `event.ListenFunc(name, fn)` | Register a function listener using the global bus |
| `event.Subscribe(subscriber)` | Register a subscriber using the global bus |
| `event.Forget(name)` | Remove exact-match listeners from the global bus |
| `event.Has(name)` | Check if exact-match listeners exist on the global bus |

## Async Listeners

Use `event.Async` to wrap a listener so it executes in a separate goroutine:

```go
bus.Listen("user.registered", event.Async(func(ctx context.Context, ev event.Event) error {
    e := ev.(UserRegistered)
    return mailer.SendWelcomeMail(ctx, e.UserID)
}))
```

`event.Async` is suitable for lightweight side effects that don't require persistence or worker retries. Async listeners still execute within the current process; goroutines that haven't completed when the process exits will not be automatically recovered.

For reliable async execution with retries, delayed dispatch, or cross-process worker consumption, use Queued Event Listeners instead.

## Lifecycle Events

`github.com/prismgo/framework/event` defines a set of general-purpose lifecycle events for infrastructure and business code to subscribe to. Event names follow the `<domain>.<stage>` format.

### Application Lifecycle

| Constant | Event Name | Type | Purpose |
| --- | --- | --- | --- |
| `EventAppBooting` | `app.booting` | `AppBooting` | Application is about to start provider registration and boot |
| `EventAppBooted` | `app.booted` | `AppBooted` | Application has completed provider registration and boot |
| `EventAppTerminating` | `app.terminating` | `AppTerminating` | Application has received a shutdown signal and is about to clean up |
| `EventAppTerminated` | `app.terminated` | `AppTerminated` | Application has finished cleanup and resource release |

`AppBooting` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Args` | `[]string` | Application startup arguments |

`AppBooted` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Duration` | `time.Duration` | Startup duration |

`AppTerminating` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Reason` | `string` | Shutdown reason |

`AppTerminated` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Duration` | `time.Duration` | Shutdown duration |
| `Error` | `string` | Error summary during shutdown |

### Provider Lifecycle

| Constant | Event Name | Type | Purpose |
| --- | --- | --- | --- |
| `EventProviderRegistering` | `app.provider.registering` | `ProviderRegistering` | A ServiceProvider is about to execute its Register phase |
| `EventProviderRegistered` | `app.provider.registered` | `ProviderRegistered` | A ServiceProvider has completed its Register phase |
| `EventProviderBooting` | `app.provider.booting` | `ProviderBooting` | A ServiceProvider is about to execute its Boot phase |
| `EventProviderBooted` | `app.provider.booted` | `ProviderBooted` | A ServiceProvider has completed its Boot phase |

Fields:

| Field | Type | Description |
| --- | --- | --- |
| `Provider` | `string` | Provider name |

### HTTP Server Lifecycle

| Constant | Event Name | Type | Purpose |
| --- | --- | --- | --- |
| `EventServerStarting` | `server.starting` | `ServerStarting` | HTTP server is about to start listening |
| `EventServerStarted` | `server.started` | `ServerStarted` | HTTP server has started listening and is ready to serve |
| `EventServerStopping` | `server.stopping` | `ServerStopping` | HTTP server is beginning graceful shutdown |
| `EventServerStopped` | `server.stopped` | `ServerStopped` | HTTP server has finished shutdown |

`ServerStarting` / `ServerStarted` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Addr` | `string` | Listen address |
| `PID` | `int` | Process ID |

`ServerStopping` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Addr` | `string` | Listen address |
| `Reason` | `string` | Shutdown reason |

`ServerStopped` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Addr` | `string` | Listen address |
| `Duration` | `time.Duration` | Shutdown duration |
| `Error` | `string` | Shutdown error summary |

### HTTP Request Lifecycle

| Constant | Event Name | Type | Purpose |
| --- | --- | --- | --- |
| `EventRequestReceived` | `request.received` | `RequestReceived` | HTTP request has entered the routing layer |
| `EventRequestHandled` | `request.handled` | `RequestHandled` | HTTP request completed successfully (status code < 500) |
| `EventRequestFailed` | `request.failed` | `RequestFailed` | HTTP request failed (status code >= 500 or panic) |
| `EventRequestFinished` | `request.finished` | `RequestFinished` | HTTP request has finished (fires for both success and failure) |

`RequestReceived` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Method` | `string` | HTTP method |
| `Path` | `string` | Request path |
| `ClientIP` | `string` | Client IP address |
| `RequestID` | `string` | Request ID |
| `ReceivedAt` | `time.Time` | Request arrival time |

`RequestHandled` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Method` | `string` | HTTP method |
| `Path` | `string` | Request path |
| `RequestID` | `string` | Request ID |
| `Status` | `int` | Response status code |
| `Duration` | `time.Duration` | Processing duration |

`RequestFailed` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Method` | `string` | HTTP method |
| `Path` | `string` | Request path |
| `RequestID` | `string` | Request ID |
| `Status` | `int` | Response status code |
| `Duration` | `time.Duration` | Processing duration |
| `Error` | `string` | Error summary |
| `Stack` | `string` | Stack trace |

`RequestFinished` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Method` | `string` | HTTP method |
| `Path` | `string` | Request path |
| `RequestID` | `string` | Request ID |
| `Status` | `int` | Response status code |
| `Duration` | `time.Duration` | Processing duration |
| `Error` | `string` | Error summary (empty on success) |

> `request.finished` is always dispatched after `request.handled` or `request.failed`, making it suitable for unified latency statistics, status code aggregation, and request finalization.

### Console Lifecycle

| Constant | Event Name | Type | Purpose |
| --- | --- | --- | --- |
| `EventConsoleApplicationStarting` | `console.application.starting` | `ConsoleApplicationStarting` | Console Kernel is entering the Artisan starting phase |
| `EventCommandStarting` | `console.command.starting` | `CommandStarting` | A console command is about to execute |
| `EventCommandFinished` | `console.command.finished` | `CommandFinished` | A console command has finished |

`ConsoleApplicationStarting` fields:

| Field | Type | Description |
| --- | --- | --- |
| `KernelName` | `string` | Kernel name |

`CommandStarting` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Command` | `string` | Command name |
| `Input` | `[]string` | Raw command arguments and options |

`CommandFinished` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Command` | `string` | Command name |
| `Succeeded` | `bool` | Whether the command succeeded |
| `Error` | `string` | Error summary |
| `Duration` | `time.Duration` | Execution duration |

### Vendor Publish Event

| Constant | Event Name | Type | Purpose |
| --- | --- | --- | --- |
| — | `vendor.tag.published` | `VendorTagPublished` | Fired after the `vendor:publish` command completes resource publishing |

`VendorTagPublished` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Tag` | `[]string` | List of tags published in this run |
| `Published` | `int` | Number of newly created files |
| `Skipped` | `int` | Number of files skipped (already existed or filtered) |

## Error and Panic Handling

| Scenario | Handling |
| --- | --- |
| Sync listener returns error | Error is logged; subsequent listeners continue |
| Sync listener panics | Recovered, stack is logged; subsequent listeners continue |
| `event.Async` returns error | Error is logged in the goroutine |
| `event.Async` panics | Recovered and stack is logged in the goroutine |
| Queued listener returns error | Handed to the queue implementation for retry, release, or failure archival |

Listener failures do not automatically roll back the main business flow. If a side effect must be strongly consistent with the main flow, execute it directly in the service's main chain instead of using an event.

## Testing

For listener tests, prefer creating an independent bus rather than relying on global state:

```go
func TestWorkorderCreatedListener(t *testing.T) {
    bus := event.New()
    var called bool

    bus.ListenFunc("workorder.created", func(ctx context.Context, ev event.Event) error {
        e := ev.(WorkorderCreated)
        called = e.WorkorderID == 1001
        return nil
    })

    bus.Dispatch(context.Background(), WorkorderCreated{WorkorderID: 1001})

    if !called {
        t.Fatal("listener was not called")
    }
}
```

For queued listener tests, you can use the `sync` queue connection to have the listener execute immediately within `Dispatch`. When you need to cover the real worker path, use Redis or miniredis and start a worker to consume once.

## Best Practices

- Define business events in domain-specific packages; store event names as constants
- Register listeners centrally, e.g., `app/listeners/register.go` in the current project
- Only pass necessary business IDs or lightweight snapshots when dispatching events
- Handle type assertions explicitly in listeners; check `ok` and return an error when necessary
- Use queued listeners when you need reliable async execution, retries, and failure archival
- Only use `event.Async` when you don't want to block the current request
- Use wildcard listeners primarily for logging, monitoring, and debugging
- Do not put actions that must succeed into event listeners
- Use `event.New()` to create an independent bus in tests to avoid polluting the global default bus

## Interface Reference

All interfaces are defined in the `github.com/prismgo/framework/contracts/event` package.

### Event

```go
type Event interface {
    Name() string
}
```

The base interface that all events must implement. `Name()` returns the stable event name (e.g., `"workorder.created"`) used for listener matching, log identification, and monitoring aggregation.

### Listener

```go
type Listener interface {
    Handle(ctx context.Context, ev Event) error
}
```

The base contract for event listeners. `Handle` processes the event; when it returns a non-nil error, the framework logs it but does not interrupt other listeners.

### ListenerFunc

```go
type ListenerFunc func(ctx context.Context, ev Event) error
```

Adapts a plain function to the `Listener` interface, allowing business code to register listeners as closures.

### Dispatcher

```go
type Dispatcher interface {
    Listen(eventName string, l Listener)
    ListenFunc(eventName string, fn func(context.Context, Event) error)
    Subscribe(s Subscriber)
    Forget(eventName string)
    Has(eventName string) bool
    Dispatch(ctx context.Context, ev Event)
}
```

The complete contract for the event bus. Method reference:

| Method | Description |
| --- | --- |
| `Listen(eventName, l)` | Register a listener for the given event name; `eventName` supports exact names, `"*"`, and `"<prefix>.*"` |
| `ListenFunc(eventName, fn)` | Register a function-based listener for the given event name |
| `Subscribe(s)` | Let a subscriber register multiple listeners at once |
| `Forget(eventName)` | Remove all exact-match listeners for the given event name; does not affect wildcard listeners |
| `Has(eventName)` | Check if any exact-match listeners exist for the given event name; does not check wildcards |
| `Dispatch(ctx, ev)` | Dispatch an event to all matching listeners |

### Subscriber

```go
type Subscriber interface {
    Subscribe(dispatcher Dispatcher)
}
```

Contract for batch-registering listeners. Allows an object to mount multiple listeners onto the event bus at once.

### ShouldQueue

```go
type ShouldQueue interface {
    Listener
    ShouldQueue() bool
}
```

Marks a listener for asynchronous execution via the queue. Listeners implementing this interface are not executed synchronously during dispatch; instead, they are serialized and dispatched to the queue for a worker to consume.

### AsyncListener

```go
type AsyncListener interface {
    Listener
    Async() bool
}
```

Optional marker interface. When implemented and returning `true`, the Dispatcher executes the listener in a separate goroutine. Suitable for side effects like notifications and pushes that should not block the main business flow.

The convenience function `event.Async(fn)` wraps any `ListenerFunc` as an async listener.

### QueueOptionsProvider

```go
type QueueOptionsProvider interface {
    QueueConnection() string
    QueueName() string
    QueueDelay() time.Duration
    QueueTries() int
    QueueBackoff() []time.Duration
    QueueTimeout() time.Duration
}
```

Allows queued listeners to declare connection, queue, delay, and retry policies. See [Customizing the Queue Connection, Queue Name, & Delay](#customizing-the-queue-connection-queue-name--delay) for method return value descriptions.

## ServiceProvider

`event.ServiceProvider` is responsible for registering the event bus with the Application Container:

- **Register phase**: Registers a lazy factory (Singleton) for `event.dispatcher`; skips if already bound
- **Boot phase**: Registers the queued listener internal Job with the default queue registry for worker payload recovery

```go
// ServiceProvider registers the event bus lazy factory
type ServiceProvider struct{}

func (ServiceProvider) Name() string { return "event" }

func (ServiceProvider) Register(app providerApplication) error {
    c := app.Container()
    if c.Bound("event.dispatcher") {
        return nil
    }
    return c.Singleton("event.dispatcher", func(containercontract.Resolver) (any, error) {
        return New(), nil
    })
}
```

## Laravel 13 Differences

PrismGo aligns with the core model of Laravel 13 Events, but has the following differences:

| Laravel 13 Feature | PrismGo Status | Notes |
| --- | --- | --- |
| Event Discovery (auto-registration) | Not supported | Listeners must be explicitly registered |
| Listener constructor auto-injection | Not supported | Dependencies are injected when business code or providers construct listeners |
| Returning `false` to stop propagation | Not supported | PrismGo continues executing all matching listeners |
| `Event::fake` / `assertDispatched` | Not supported | Tests use independent dispatchers or custom listener assertions |
| Dispatching events after database transactions | Not supported | Needs to be wrapped separately with `github.com/prismgo/framework/queue` capabilities |
| Queued Listener Middleware | Not supported | — |
| Encrypted Queued Listeners | Not supported | — |
| Unique Event Listeners | Not supported | — |
| `ShouldQueue` + queue options | Supported | Via `QueueOptionsProvider` interface |
| Wildcard listeners | Supported | `"*"` and `"<prefix>.*"` |
| Event Subscribers | Supported | `Subscriber` interface |
| Closure listeners | Supported | `ListenFunc` |
| Lifecycle events | Supported | Application, Provider, HTTP Server, HTTP Request, Console |
