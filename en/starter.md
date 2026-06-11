# Getting Started

- [Create a Project](#create-a-project)
- [Start the Server](#start-the-server)
- [Inspect the Default Routes](#inspect-the-default-routes)
- [Add Your First Endpoint](#add-your-first-endpoint)
- [Verify the Result](#verify-the-result)
- [Next Steps](#next-steps)

This tutorial starts with a new PrismGo application, runs the HTTP server, and adds a JSON endpoint.

## Create a Project

Install the installer:

```bash
go install github.com/prismgo/installer/cmd/prismgo@latest
```

Create the application:

```bash
prismgo new hello-prism
cd hello-prism
```

If you already have the installer, start with `prismgo new`.

## Start the Server

The entry point of a new app is `main.go`. It creates `bootstrap.NewApplication()` and passes CLI arguments to the PrismGo Console Kernel:

```go
func main() {
    app := bootstrap.NewApplication()

    if err := app.HandleCommand(context.Background(), os.Args); err != nil {
        console.Exit(err.Error())
    }
}
```

Start the HTTP server:

```bash
go run . serve
```

The default listen address comes from `.env`:

```dotenv
SERVER_HOST=127.0.0.1
SERVER_PORT=8080
```

Call the health endpoint:

```bash
curl http://127.0.0.1:8080/api/health
```

You should see:

```json
{"status":"ok"}
```

## Inspect the Default Routes

In another terminal, run:

```bash
go run . route:list
```

A new project registers `/api/health` and `/api` by default. The route declarations live in `routes/api.go` and are mounted through `app/http/register.go`.

## Add Your First Endpoint

Open `routes/api.go` and add a route inside the `Register` function:

```go
route.Get("/api/ping", func(c *gin.Context) {
    c.JSON(http.StatusOK, gin.H{
        "message": "pong",
    })
})
```

The full shape should look like this:

```go
func Register(app Dependencies) {
    route.Get("/api/health", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{"status": "ok"})
    })

    route.Get("/api/ping", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{"message": "pong"})
    })

    if app.WelcomeController != nil {
        route.Get("/api", app.WelcomeController.Show)
    }
}
```

If `go run . serve` is still running, stop and restart it:

```bash
go run . serve
```

## Verify the Result

Call the new endpoint:

```bash
curl http://127.0.0.1:8080/api/ping
```

You should see:

```json
{"message":"pong"}
```

Inspect the route list again:

```bash
go run . route:list --path=ping
```

## Next Steps

- Use the [generator commands](commands.md#make-generators) to create controllers, models, migrations, and jobs.
- Read [Routing](route.md) for groups, named routes, resource routes, and throttling.
- Read [HTTP Server](http-server.md) to configure ports, timeouts, proxies, and graceful restarts.
- Read [Database](database.md) and [Queue](queue.md) to add persistence and background work.

