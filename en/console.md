# Console

- [Introduction](#introduction)
- [Defining Commands](#defining-commands)
  - [Command Structure](#command-structure)
  - [Signature Syntax](#signature-syntax)
  - [Arguments](#arguments)
  - [Options](#options)
  - [MustDefinition Shortcut](#mustdefinition-shortcut)
- [Command Input](#command-input)
  - [Retrieving Arguments](#retrieving-arguments)
  - [Retrieving Options](#retrieving-options)
- [Command Output](#command-output)
  - [Styled Output](#styled-output)
  - [Alert Blocks](#alert-blocks)
  - [Tables](#tables)
  - [Progress Bars](#progress-bars)
- [Interactive Input](#interactive-input)
  - [Ask](#ask)
  - [Secret](#secret)
  - [Confirm](#confirm)
  - [Choice](#choice)
  - [Anticipate](#anticipate)
- [Command Context](#command-context)
  - [Obtaining CommandContext](#obtaining-commandcontext)
  - [Context Methods Reference](#context-methods-reference)
  - [Signal Handling (Trap)](#signal-handling-trap)
  - [Manual Failure (Fail)](#manual-failure-fail)
- [Calling Other Commands](#calling-other-commands)
  - [Call](#call)
  - [CallSilently](#callsilently)
  - [CallInput](#callinput)
- [Command Isolation (Isolatable)](#command-isolation-isolatable)
- [Prompting for Missing Input (PromptsForMissingInput)](#prompting-for-missing-input-promptsformissinginput)
- [ANSI Color Support](#ansi-color-support)
- [Command List Rendering](#command-list-rendering)
- [Definition Validation and Normalization](#definition-validation-and-normalization)
- [Cobra Binding](#cobra-binding)
- [Package-Level Helper Functions](#package-level-helper-functions)
- [Laravel Artisan Console Mapping](#laravel-artisan-console-mapping)

---

PrismGo's Console component provides a Laravel Artisan-style command-line development experience, including structured command definitions, Signature DSL parsing, unified input/output interfaces, interactive prompts, inter-command calls, signal handling, and command isolation.

For built-in commands, `make:*` generators, `serve`, `migrate:*`, `queue:*`, and related command references, see [Commands](commands.md).

---

## Introduction

The Console package is organized around the `Command` interface. Each command provides a static definition via `Definition` (name, arguments, options) and implements its execution logic via `Handle(ctx CommandContext)`. The Kernel handles registration, argument binding, and dispatching at runtime, so command authors only need to focus on "what parameters to define" and "what logic to execute."

Core concepts:

| Concept | Description |
| --- | --- |
| `Definition` | Static command definition: name, description, arguments, options, aliases, examples, etc. |
| `Command` | Command interface: `Definition()` returns the definition, `Handle(ctx)` executes the logic |
| `CommandContext` | Runtime context: encapsulates input, output, inter-command calls, signal handling, etc. |
| `Input` | Unified command input reading interface, abstracting away underlying flag/arg parsing |
| `IO` | Unified console interaction and output interface |

## Defining Commands

### Command Structure

All commands implement the `Command` interface:

```go
type Command interface {
    Definition() *Definition
    Handle(ctx CommandContext) error
}
```

A typical command implementation:

```go
package cmd

import (
    "github.com/prismgo/framework/console"
)

type SendEmailsCommand struct{}

func (c *SendEmailsCommand) Definition() *console.Definition {
    return console.MustDefinition(
        "mail:send {user} {--queue=default : The queue connection to use}",
        "Send a marketing email to a user",
    )
}

func (c *SendEmailsCommand) Handle(ctx console.CommandContext) error {
    user := ctx.Argument("user")
    queue := ctx.Option("queue")

    ctx.IO().Info("Sending mail to: " + user)
    // ... business logic
    return nil
}
```

### Signature Syntax

PrismGo supports Laravel-style Signature DSL, using a single declarative string to define the command name, arguments, and options:

```
command-name {argument} {--option}
```

A signature consists of the command name and curly-brace-enclosed tokens. Tokens are either argument tokens or option tokens.

**Full example**:

```
mail:send {user : The ID of the user} {--Q|queue=default : The queue to use} {--force}
```

### Arguments

Arguments are declared inside `{}` without a `--` prefix:

| Syntax | Description | Example |
| --- | --- | --- |
| `{name}` | Required argument | `{user}` |
| `{name?}` | Optional argument (defaults to empty) | `{user?}` |
| `{name=default}` | Optional argument with default value | `{user=foo}` |
| `{name*}` | Required array argument (at least one value) | `{ids*}` |
| `{name?*}` | Optional array argument (zero or more values) | `{tags?*}` |
| `{name : description}` | Argument with description | `{user : The user ID}` |

**Rules**:
- Optional arguments cannot appear before required arguments
- Array arguments must be the last argument; no other arguments may follow
- Argument names must be unique

### Options

Options are prefixed with `--`:

| Syntax | Description | Example |
| --- | --- | --- |
| `{--flag}` | Boolean switch (no value accepted, defaults to `false`) | `{--force}` |
| `{--option=}` | Option that accepts a value (required when used) | `{--queue=}` |
| `{--option=default}` | Option with default value | `{--queue=default}` |
| `{--S\|short}` | Option with a short alias | `{--Q\|queue=default}` |
| `{--id=*}` | Option that accepts an array of values | `{--id=*}` |
| `{--option : description}` | Option with description | `{--force : Force the operation}` |

**Rules**:
- Option names must be unique
- Short options must be a single character and must be unique
- Array options must accept values (`ValueMode` cannot be `OptionValueNone`)

### MustDefinition Shortcut

`MustDefinition` constructs a Definition from a Signature DSL string, panicking on parse failure. It is designed for use in a command's `Definition()` method:

```go
func (c *SendEmailsCommand) Definition() *console.Definition {
    return console.MustDefinition(
        "mail:send {user} {--queue=default}",
        "Send a marketing email to a user",
    )
}
```

For finer control, use `ParseSignature` to manually parse and handle errors:

```go
definition, err := console.ParseSignature("mail:send {user} {--queue=default}")
if err != nil {
    return nil, err
}
definition.Description = "Send a marketing email to a user"
```

## Command Input

The `Input` interface provides unified command input reading, abstracting away the underlying Cobra flag/arg parsing details.

### Retrieving Arguments

```go
// Read a single argument value (first value)
user := ctx.Argument("user")

// Read all values of an array argument
ids := ctx.Arguments("ids")
```

If an argument is not provided and has no default value, `Argument` returns an empty string and `Arguments` returns `nil`.

### Retrieving Options

```go
// Read a string option
queue := ctx.Option("queue")

// Read a string array option
ids := ctx.OptionStrings("id")

// Read a boolean option
force := ctx.OptionBool("force")

// Read an integer option
port := ctx.OptionInt("port")

// Check if an option exists
hasQueue := ctx.HasOption("queue")
```

**Option reading rules**:
- `Option` returns the first value of the option; returns an empty string when not set
- `OptionBool` returns the boolean value for boolean-type options; for string options, it attempts `strconv.ParseBool`
- `OptionInt` is equivalent to `strconv.Atoi(Option(name))`
- `HasOption` checks both local flags and flags inherited from parent commands
- Optional-value options (`{--option=}`) map bare `--flag` to an internal sentinel value, which is automatically restored to an empty string at the reading layer

## Command Output

### Styled Output

The `IO` interface provides Laravel/Symfony-style styled output methods:

```go
io := ctx.IO()

// Plain message (no style)
io.Line("Plain message")

// Message with custom style
io.Line("Styled message", "info")

// Info message (green)
io.Info("The command was successful!")

// Comment message (yellow)
io.Comment("This is a comment")

// Question message (black on cyan)
io.Question("What is your name?")

// Success message (white on green)
io.Success("Operation completed!")

// Warning message (yellow, written to stderr)
io.Warn("Something might be wrong!")

// Error message (white on red, written to stderr)
io.Error("Something went wrong!")
```

**Style reference**:

| Method | Color | Output Stream |
| --- | --- | --- |
| `Line` | No style or specified style | stdout |
| `Info` | Green | stdout |
| `Comment` | Yellow | stdout |
| `Question` | Black on cyan | stdout |
| `Success` | White on green | stdout |
| `Warn` | Yellow | stderr |
| `Error` | White on red | stderr |

### Alert Blocks

`Alert` outputs a Laravel-style yellow alert block with an asterisk border:

```go
io.Alert("This is an important alert!")
```

Output:

```
**************************
*     This is an important alert!     *
**************************
```

### Tables

`Table` outputs data in an aligned table format:

```go
err := io.Table(
    []string{"Name", "Email"},
    [][]string{
        {"Taylor", "taylor@example.com"},
        {"Dayle", "dayle@example.com"},
    },
)
```

### Progress Bars

`Progress` creates a simple progress bar:

```go
progress := io.Progress(100)
for i := 0; i < 100; i++ {
    // Perform task...
    progress.Advance(1)
}
progress.Finish()
```

- `Advance(step)` advances the progress; `step <= 0` defaults to 1
- `Finish()` ends the progress bar and outputs a newline

## Interactive Input

### Ask

`Ask` prompts the user for input and returns the entered string:

```go
name, err := io.Ask("What is your name?")
```

With a default value:

```go
name, err := io.Ask("What is your name?", "Taylor")
// Prompt displays: What is your name? [default: Taylor]:
```

When the user presses Enter without typing, the default value is returned.

### Secret

`Secret` hides user input (no echo), suitable for passwords and other sensitive information:

```go
password, err := io.Secret("What is the password?")
```

Falls back to `Ask` behavior in non-TTY environments.

### Confirm

`Confirm` asks the user a yes/no question:

```go
if ok, err := io.Confirm("Do you wish to continue?", false); ok {
    // User confirmed
}
```

- The second parameter `defaultYes` controls the default: `true` displays `[Y/n]`, `false` displays `[y/N]`
- User input of `y`/`yes` returns `true`; `n`/`no` returns `false`

### Choice

`Choice` presents a list of options for the user to select:

```go
name, err := io.Choice("What is your name?", []string{"Taylor", "Dayle"}, "Taylor")
```

Users can enter either the option number or the option text.

**Multiple selection and advanced configuration**:

```go
names, err := io.ChoiceWithOptions(
    "Select names?",
    []string{"Taylor", "Dayle", "Abigail"},
    console.ChoiceOptions{
        Multiple: true,
        Defaults: []string{"Taylor"},
        Attempts: 3,
    },
)
```

`ChoiceOptions` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Multiple` | `bool` | Whether to allow multiple selections; comma-separated when enabled |
| `Defaults` | `[]string` | Default selected items |
| `Attempts` | `int` | Maximum number of attempts; defaults to 1 when `<= 0` |

### Anticipate

`Anticipate` provides input with candidate suggestions:

```go
name, err := io.Anticipate("What is your name?", []string{"Taylor", "Dayle"}, "Taylor")
```

In the current implementation, non-TTY or unavailable raw mode falls back to `Ask` behavior.

## Command Context

`CommandContext` is the unified runtime context for command execution, encapsulating input, output, inter-command calls, signal handling, and more.

### Obtaining CommandContext

In a command's `Handle` method, `CommandContext` is passed directly as a parameter:

```go
func (c *MyCommand) Handle(ctx console.CommandContext) error {
    // Use ctx directly
    return nil
}
```

Extract from a standard `context.Context`:

```go
commandCtx, ok := console.FromContext(stdCtx)
```

Extract from a Cobra command:

```go
commandCtx, ok := console.FromCommand(cobraCmd)

// Or require it to exist, returning an error if not found
commandCtx, err := console.MustFromCommand(cobraCmd)
```

Inject `CommandContext` into a standard `context.Context`:

```go
stdCtx := console.WithContext(parentCtx, commandCtx)
```

Get the underlying Cobra command:

```go
cobraCmd := console.CobraCommand(commandCtx)
```

### Context Methods Reference

| Method | Return Type | Description |
| --- | --- | --- |
| `Context()` | `context.Context` | Returns the bound standard Go context |
| `CommandName()` | `string` | Returns the current command name |
| `Definition()` | `*Definition` | Returns a copy of the command definition |
| `Input()` | `Input` | Returns the input interface |
| `IO()` | `IO` | Returns the output interface |
| `Argument(name)` | `string` | Reads an argument (convenience method) |
| `Arguments(name)` | `[]string` | Reads an array argument |
| `Option(name)` | `string` | Reads an option |
| `OptionStrings(name)` | `[]string` | Reads an array option |
| `OptionBool(name)` | `bool` | Reads a boolean option |
| `OptionInt(name)` | `int` | Reads an integer option |
| `HasOption(name)` | `bool` | Checks if an option exists |
| `Call(signature, ...input)` | `error` | Calls another command |
| `CallSilently(signature, ...input)` | `error` | Calls another command silently |
| `Fail(...messageOrErr)` | `error` | Constructs a manual failure error |
| `Trap(signals, callback)` | `(func(), error)` | Registers a signal handler |

### Signal Handling (Trap)

`Trap` allows commands to catch operating system signals, useful for graceful shutdown of long-running commands:

```go
release, err := ctx.Trap([]os.Signal{syscall.SIGTERM, syscall.SIGINT}, func(sig os.Signal) {
    fmt.Printf("Received signal: %v\n", sig)
    // Perform cleanup...
})
if err != nil {
    return err
}
defer release()
```

**Rules**:
- At least one signal must be provided
- `callback` must not be `nil`
- The returned `release` function cancels signal listening
- When the command context ends, `ReleaseTraps` automatically releases all registered traps

### Manual Failure (Fail)

`Fail` constructs an error recognized by the Kernel as a manual failure. Commands can use `ctx.Fail()` to proactively mark themselves as failed:

```go
return ctx.Fail("something went wrong")

// Or wrap an error
return ctx.Fail(err)

// Or combine a message and an error
return ctx.Fail("processing failed:", err)
```

Use `IsManualFailure` to check if an error is a manual failure:

```go
if manual, ok := console.IsManualFailure(err); ok {
    fmt.Println("Manual failure:", manual.Message)
}
```

## Calling Other Commands

### Call

Call another command from within a command:

```go
err := ctx.Call("mail:send", console.CallInput{
    Arguments: map[string]string{"user": "1"},
    Options:   map[string]string{"queue": "default"},
})
```

### CallSilently

Call another command silently, suppressing all output:

```go
err := ctx.CallSilently("mail:send", console.CallInput{
    Arguments: map[string]string{"user": "1"},
})
```

### CallInput

`CallInput` is used to pass arguments and options when calling commands programmatically:

| Field | Type | Description |
| --- | --- | --- |
| `Arguments` | `map[string]string` | Arguments to pass to the target command |
| `Options` | `map[string]string` | Options to pass to the target command |

## Command Isolation (Isolatable)

Implementing the `Isolatable` interface prevents multiple instances of the same command from running concurrently:

```go
type SyncCommand struct{}

func (c *SyncCommand) IsolationKey(ctx console.CommandContext) string {
    // Return an isolation key; commands with the same key will not run concurrently
    // Defaults to the command name; can be customized based on arguments
    return c.CommandName() + ":" + ctx.Argument("tenant")
}
```

The Kernel checks the isolation lock before executing an `Isolatable` command. If another command with the same key is already running, the new command is rejected.

## Prompting for Missing Input (PromptsForMissingInput)

Implementing the `PromptsForMissingInput` interface allows automatic interactive prompting when required arguments are missing:

```go
type SendEmailsCommand struct{}

// PromptForMissingArgumentsUsing returns interactive prompt configurations for each missing argument
func (c *SendEmailsCommand) PromptForMissingArgumentsUsing() []console.MissingArgumentPrompt {
    return []console.MissingArgumentPrompt{
        {
            Question: "Which user should receive the email?",
            Default:  "1",
            Ask:      nil, // Uses default Ask behavior
        },
    }
}

// AfterPromptingForMissingArguments is called after interactive prompting is complete
func (c *SendEmailsCommand) AfterPromptingForMissingArguments(ctx console.CommandContext) {
    // Optional: perform additional logic after prompting
}
```

`MissingArgumentPrompt` fields:

| Field | Type | Description |
| --- | --- | --- |
| `Question` | `string` | Prompt question text |
| `Default` | `string` | Default value |
| `Ask` | `func(io IO) (string, error)` | Custom ask function; uses default `Ask` when `nil` |

## ANSI Color Support

The Console package implements Symfony/Laravel-style ANSI color auto-detection:

```go
// Resolve output options
opts := console.ResolveOutputOptions(os.Stdout, ansiSet, noANSISet, quiet, silent)

// Check if ANSI is supported
supportsANSI := console.SupportsANSI(os.Stdout)
```

**ANSI detection priority** (highest to lowest):

1. `--no-ansi` flag: force disable
2. `--ansi` flag: force enable
3. `NO_COLOR` environment variable: disable colors
4. `FORCE_COLOR` environment variable: enable colors (except `0`/`false`/`no`/`off`)
5. Terminal auto-detection: checks if the output stream is a TTY, and `COLORTERM`, `TERM`, etc. environment variables

**OutputOptions fields**:

| Field | Type | Description |
| --- | --- | --- |
| `ANSI` | `bool` | Whether ANSI styling is enabled |
| `Quiet` | `bool` | Quiet mode; only errors are displayed |
| `Silent` | `bool` | Silent mode; no output at all |

## Command List Rendering

`RenderCommandList` renders a Symfony/Laravel-style command list:

```go
err := console.RenderCommandList(os.Stdout, definitions, console.CommandListOptions{
    AppName:     "PrismGo",
    Description: "PrismGo Framework",
    Format:      "txt",  // Supports "txt", "json", "md"
    Output:      opts,
})
```

**CommandListOptions fields**:

| Field | Type | Description |
| --- | --- | --- |
| `AppName` | `string` | Application name, used for markdown format title |
| `Description` | `string` | Description text at the top of the list |
| `Namespace` | `string` | Filter by namespace (e.g., `"mail"` shows only `mail:*` commands) |
| `Format` | `string` | Output format: `"txt"` (default), `"json"`, `"md"` |
| `Raw` | `bool` | Raw format: `name description` per line |
| `Short` | `bool` | Short format: only command names per line |
| `Output` | `OutputOptions` | Output options |

**Command grouping rules**: Commands are automatically grouped by their namespace prefix (the part before `:`). For example, `mail:send` and `mail:queue` belong to the `mail` group. Commands without `:` belong to the default group.

**ArgumentDescriptors and RenderArgumentList** are used to render argument details in help output:

```go
descriptors := console.ArgumentDescriptors(definition.Arguments)
console.RenderArgumentList(os.Stdout, definition.Arguments, opts)
```

## Definition Validation and Normalization

`NormalizeDefinition` validates and tidies a Definition, returning a normalized definition suitable for Kernel registration:

```go
normalized, err := console.NormalizeDefinition(definition)
```

**Validation rules**:
- Command name must not be empty
- Argument names must not be empty and must be unique
- Optional arguments cannot appear before required arguments
- No arguments may follow an array argument
- Option names must not be empty and must be unique
- Short options must be a single character and must be unique
- Array options must accept values
- All names and descriptions are trimmed
- Aliases and examples are deduplicated and empties removed

`CloneDefinition` performs a deep copy of a Definition to prevent modification of the caller's data during registration:

```go
cloned := console.CloneDefinition(definition)
```

`DefinitionUsage` generates a usage string suitable for Cobra's `Use` field:

```go
usage := console.DefinitionUsage(definition)
// Example: "mail:send <user> [--queue]"
```

## Cobra Binding

`BindDefinitionFlags` registers Cobra flags based on a structured Definition:

```go
err := console.BindDefinitionFlags(cobraCmd, definition)
```

This method automatically selects the appropriate Cobra flag type (`Bool`/`String`/`StringArray`, etc.) based on the Option's `ValueMode`, `IsArray`, `Shortcut`, and other fields. It also sets `NoOptDefVal` to support the bare `--flag` form for optional-value options.

## Package-Level Helper Functions

The Console package provides a set of package-level helper functions that output directly to `os.Stdout`/`os.Stderr`, suitable for use in simple scripts or during initialization:

| Function | Description |
| --- | --- |
| `console.Line(msg, ...style)` | Print a message with optional style |
| `console.Info(msg)` | Print a green info message |
| `console.Comment(msg)` | Print a yellow comment message |
| `console.Question(msg)` | Print a black-on-cyan question message |
| `console.Success(msg)` | Print a white-on-green success message |
| `console.Warn(msg)` | Print a yellow warning message |
| `console.Error(msg)` | Print a white-on-red error message |
| `console.Alert(msg)` | Print a yellow alert block |
| `console.Exit(msg)` | Print an error message and exit the process |
| `console.ExitIf(err)` | Print the error and exit if `err != nil` |

> Package-level helper functions do not depend on the Kernel or CommandContext and are suitable for use outside of commands. Inside commands, prefer using `ctx.IO()` methods.

## Laravel Artisan Console Mapping

| Laravel Concept | PrismGo Equivalent |
| --- | --- |
| `protected $signature` | `Definition()` returning `MustDefinition(signature, desc)` |
| `protected $description` | Second argument of `MustDefinition` |
| `handle()` | `Handle(ctx CommandContext) error` |
| `$this->argument('name')` | `ctx.Argument("name")` |
| `$this->arguments()` | `ctx.Arguments("name")` |
| `$this->option('name')` | `ctx.Option("name")` |
| `$this->line($msg)` | `ctx.IO().Line(msg)` |
| `$this->info($msg)` | `ctx.IO().Info(msg)` |
| `$this->comment($msg)` | `ctx.IO().Comment(msg)` |
| `$this->question($msg)` | `ctx.IO().Question(msg)` |
| `$this->warn($msg)` | `ctx.IO().Warn(msg)` |
| `$this->error($msg)` | `ctx.IO().Error(msg)` |
| `$this->alert($msg)` | `ctx.IO().Alert(msg)` |
| `$this->newLine($n)` | `ctx.IO().NewLine(n)` |
| `$this->ask($question)` | `ctx.IO().Ask(question)` |
| `$this->secret($question)` | `ctx.IO().Secret(question)` |
| `$this->confirm($question)` | `ctx.IO().Confirm(question, defaultYes)` |
| `$this->choice($question, $choices)` | `ctx.IO().Choice(question, choices, default)` |
| `$this->anticipate($question, $choices)` | `ctx.IO().Anticipate(question, choices, default)` |
| `$this->table($headers, $rows)` | `ctx.IO().Table(headers, rows)` |
| `$this->output->createProgressBar($total)` | `ctx.IO().Progress(total)` |
| `$this->call('command', $args)` | `ctx.Call("command", callInput)` |
| `$this->callSilent('command', $args)` | `ctx.CallSilently("command", callInput)` |
| `$this->trap(SIGTERM, $callback)` | `ctx.Trap([]os.Signal{syscall.SIGTERM}, callback)` |
| `Isolatable` interface | `console.Isolatable` interface |
| `Artisan::call('command', $args)` | `ctx.Call("command", callInput)` |
| `Artisan::queue('command', $args)` | Dispatch asynchronously via the queue system |
| `{name}` required argument | `{name}` |
| `{name?}` optional argument | `{name?}` |
| `{name=default}` argument with default | `{name=default}` |
| `{name*}` array argument | `{name*}` |
| `{--flag}` boolean switch | `{--flag}` |
| `{--option=default}` option with value | `{--option=default}` |
| `{--O\|option}` short option | `{--O\|option}` |
| `{--id=*}` array option | `{--id=*}` |
