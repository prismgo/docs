# Console

- [简介](#简介)
- [定义命令](#定义命令)
  - [命令结构](#命令结构)
  - [Signature 语法](#signature-语法)
  - [参数](#参数)
  - [选项](#选项)
  - [MustDefinition 快捷构造](#mustdefinition-快捷构造)
- [命令输入](#命令输入)
  - [读取参数](#读取参数)
  - [读取选项](#读取选项)
- [命令输出](#命令输出)
  - [样式化输出](#样式化输出)
  - [Alert 警示块](#alert-警示块)
  - [表格](#表格)
  - [进度条](#进度条)
- [交互式输入](#交互式输入)
  - [Ask 提问](#ask-提问)
  - [Secret 密码输入](#secret-密码输入)
  - [Confirm 确认](#confirm-确认)
  - [Choice 选择](#choice-选择)
  - [Anticipate 自动补全](#anticipate-自动补全)
- [命令上下文](#命令上下文)
  - [获取 CommandContext](#获取-commandcontext)
  - [上下文方法一览](#上下文方法一览)
  - [信号处理（Trap）](#信号处理trap)
  - [主动失败（Fail）](#主动失败fail)
- [命令互调](#命令互调)
  - [Call 调用其他命令](#call-调用其他命令)
  - [CallSilently 静默调用](#callsilently-静默调用)
  - [CallInput 传参](#callinput-传参)
- [命令隔离（Isolatable）](#命令隔离isolatable)
- [缺失参数交互提示（PromptsForMissingInput）](#缺失参数交互提示promptsformissinginput)
- [ANSI 颜色支持](#ansi-颜色支持)
- [命令列表渲染](#命令列表渲染)
- [Definition 校验与规范化](#definition-校验与规范化)
- [Cobra 绑定](#cobra-绑定)
- [包级快捷函数](#包级快捷函数)
- [与 Laravel Artisan Console 的对应关系](#与-laravel-artisan-console-的对应关系)

---

PrismGo 的 Console 组件提供了一套 Laravel Artisan 风格的命令行开发体验，包括结构化命令定义、Signature DSL 解析、统一的输入/输出接口、交互式提问、命令互调、信号处理和命令隔离等能力。

内置命令、`make:*` 生成器、`serve`、`migrate:*`、`queue:*` 等命令参考见 [命令行](commands.md)。

---

## 简介

Console 包围绕 `Command` 接口组织，每个命令通过 `Definition` 提供静态定义（名称、参数、选项），通过 `Handle(ctx CommandContext)` 承担实际执行逻辑。运行时由 Kernel 负责注册、参数绑定和调度，命令作者只需关注"定义什么参数"和"执行什么逻辑"。

核心概念：

| 概念 | 说明 |
| --- | --- |
| `Definition` | 命令的静态定义：名称、描述、参数、选项、别名、示例等 |
| `Command` | 命令接口：`Definition()` 返回定义，`Handle(ctx)` 执行逻辑 |
| `CommandContext` | 运行期上下文：封装输入、输出、互调、信号处理等能力 |
| `Input` | 统一的命令输入读取接口，屏蔽底层 flag/arg 解析细节 |
| `IO` | 统一的命令行交互与输出接口 |

## 定义命令

### 命令结构

所有命令都实现 `Command` 接口：

```go
type Command interface {
    Definition() *Definition
    Handle(ctx CommandContext) error
}
```

一个典型的命令实现：

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
    // ... 业务逻辑
    return nil
}
```

### Signature 语法

PrismGo 支持 Laravel 风格的 Signature DSL，用一条声明式字符串定义命令名称、参数和选项：

```
命令名 {参数} {--选项}
```

Signature 由命令名和大括号包裹的 token 组成，token 分为参数 token 和选项 token。

**完整示例**：

```
mail:send {user : The ID of the user} {--Q|queue=default : The queue to use} {--force}
```

### 参数

参数在 `{}` 中声明，不以 `--` 开头：

| 语法 | 说明 | 示例 |
| --- | --- | --- |
| `{name}` | 必填参数 | `{user}` |
| `{name?}` | 可选参数（默认为空） | `{user?}` |
| `{name=default}` | 可选参数，带默认值 | `{user=foo}` |
| `{name*}` | 必填数组参数（至少一个值） | `{ids*}` |
| `{name?*}` | 可选数组参数（零或多个值） | `{tags?*}` |
| `{name : 描述}` | 带描述的参数 | `{user : The user ID}` |

**规则**：
- 可选参数不能出现在必填参数之前
- 数组参数必须是最后一个参数，其后不能再有其他参数
- 参数名不能重复

### 选项

选项以 `--` 开头：

| 语法 | 说明 | 示例 |
| --- | --- | --- |
| `{--flag}` | 布尔开关（不接收值，默认 `false`） | `{--force}` |
| `{--option=}` | 接收值的选项（使用时必须提供值） | `{--queue=}` |
| `{--option=default}` | 接收值的选项，带默认值 | `{--queue=default}` |
| `{--S\|short}` | 带短选项的选项 | `{--Q\|queue=default}` |
| `{--id=*}` | 接收数组的选项 | `{--id=*}` |
| `{--option : 描述}` | 带描述的选项 | `{--force : Force the operation}` |

**规则**：
- 选项名不能重复
- 短选项必须是单个字符，且不能重复
- 数组选项必须接收值（`ValueMode` 不能为 `OptionValueNone`）

### MustDefinition 快捷构造

`MustDefinition` 通过 Signature DSL 构造 Definition，解析失败时直接 panic，适合在命令的 `Definition()` 方法中使用：

```go
func (c *SendEmailsCommand) Definition() *console.Definition {
    return console.MustDefinition(
        "mail:send {user} {--queue=default}",
        "Send a marketing email to a user",
    )
}
```

如果需要更精细的控制，可以使用 `ParseSignature` 手动解析并处理错误：

```go
definition, err := console.ParseSignature("mail:send {user} {--queue=default}")
if err != nil {
    return nil, err
}
definition.Description = "Send a marketing email to a user"
```

## 命令输入

`Input` 接口提供统一的命令输入读取能力，屏蔽底层 Cobra flag/arg 解析细节。

### 读取参数

```go
// 读取单个参数值（取第一个）
user := ctx.Argument("user")

// 读取数组参数的所有值
ids := ctx.Arguments("ids")
```

如果参数未提供且没有默认值，`Argument` 返回空字符串，`Arguments` 返回 `nil`。

### 读取选项

```go
// 读取字符串选项
queue := ctx.Option("queue")

// 读取字符串数组选项
ids := ctx.OptionStrings("id")

// 读取布尔选项
force := ctx.OptionBool("force")

// 读取整数选项
port := ctx.OptionInt("port")

// 判断选项是否存在
hasQueue := ctx.HasOption("queue")
```

**选项读取规则**：
- `Option` 返回选项的第一个值，未设置时返回空字符串
- `OptionBool` 对布尔类型选项返回其布尔值，对字符串选项会尝试 `strconv.ParseBool` 解析
- `OptionInt` 等价于 `strconv.Atoi(Option(name))`
- `HasOption` 同时检查本地 flags 和从父命令继承的全局 flags
- 可选值选项（`{--option=}`）在裸传 `--flag` 时，内部会映射为哨兵值，读取层自动还原为空字符串

## 命令输出

### 样式化输出

`IO` 接口提供 Laravel/Symfony 风格的样式化输出方法：

```go
io := ctx.IO()

// 普通消息（无样式）
io.Line("Plain message")

// 带自定义样式的消息
io.Line("Styled message", "info")

// 信息消息（绿色）
io.Info("The command was successful!")

// 注释消息（黄色）
io.Comment("This is a comment")

// 问题消息（黑字青底）
io.Question("What is your name?")

// 成功消息（白字绿底）
io.Success("Operation completed!")

// 警告消息（黄色，输出到 stderr）
io.Warn("Something might be wrong!")

// 错误消息（白字红底，输出到 stderr）
io.Error("Something went wrong!")
```

**样式对照**：

| 方法 | 颜色 | 输出流 |
| --- | --- | --- |
| `Line` | 无样式或指定样式 | stdout |
| `Info` | 绿色 | stdout |
| `Comment` | 黄色 | stdout |
| `Question` | 黑字青底 | stdout |
| `Success` | 白字绿底 | stdout |
| `Warn` | 黄色 | stderr |
| `Error` | 白字红底 | stderr |

### Alert 警示块

`Alert` 输出 Laravel 风格的黄色警示块，用星号边框包裹消息：

```go
io.Alert("This is an important alert!")
```

输出效果：

```
**************************
*     This is an important alert!     *
**************************
```

### 表格

`Table` 以对齐的表格格式输出数据：

```go
err := io.Table(
    []string{"Name", "Email"},
    [][]string{
        {"Taylor", "taylor@example.com"},
        {"Dayle", "dayle@example.com"},
    },
)
```

### 进度条

`Progress` 创建一个简单的进度条：

```go
progress := io.Progress(100)
for i := 0; i < 100; i++ {
    // 执行任务...
    progress.Advance(1)
}
progress.Finish()
```

- `Advance(step)` 推进进度，`step <= 0` 时默认为 1
- `Finish()` 结束进度条，输出换行

## 交互式输入

### Ask 提问

`Ask` 提示用户输入，返回用户输入的字符串：

```go
name, err := io.Ask("What is your name?")
```

带默认值：

```go
name, err := io.Ask("What is your name?", "Taylor")
// 提示会显示: What is your name? [default: Taylor]:
```

用户按回车时返回默认值。

### Secret 密码输入

`Secret` 让用户输入时不回显字符，适合密码等敏感信息：

```go
password, err := io.Secret("What is the password?")
```

非 TTY 环境下回退为 `Ask` 行为。

### Confirm 确认

`Confirm` 询问用户是/否：

```go
if ok, err := io.Confirm("Do you wish to continue?", false); ok {
    // 用户确认
}
```

- 第二个参数 `defaultYes` 控制默认值：`true` 显示 `[Y/n]`，`false` 显示 `[y/N]`
- 用户输入 `y`/`yes` 返回 `true`，`n`/`no` 返回 `false`

### Choice 选择

`Choice` 提供列表选择：

```go
name, err := io.Choice("What is your name?", []string{"Taylor", "Dayle"}, "Taylor")
```

用户可以输入选项编号或选项文本。

**多选和高级配置**：

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

`ChoiceOptions` 字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Multiple` | `bool` | 是否允许多选，多选时用逗号分隔 |
| `Defaults` | `[]string` | 默认选中项 |
| `Attempts` | `int` | 最大尝试次数，`<= 0` 时默认为 1 |

### Anticipate 自动补全

`Anticipate` 提供带候选词的输入提示：

```go
name, err := io.Anticipate("What is your name?", []string{"Taylor", "Dayle"}, "Taylor")
```

当前实现中，非 TTY 或 raw mode 不可用时回退为 `Ask` 行为。

## 命令上下文

`CommandContext` 是命令运行期的统一上下文，封装了输入、输出、互调、信号处理等所有能力。

### 获取 CommandContext

在命令的 `Handle` 方法中，`CommandContext` 直接作为参数传入：

```go
func (c *MyCommand) Handle(ctx console.CommandContext) error {
    // 直接使用 ctx
    return nil
}
```

从标准 `context.Context` 中提取：

```go
commandCtx, ok := console.FromContext(stdCtx)
```

从 Cobra 命令中提取：

```go
commandCtx, ok := console.FromCommand(cobraCmd)

// 或要求必须存在，否则返回错误
commandCtx, err := console.MustFromCommand(cobraCmd)
```

将 `CommandContext` 注入标准 `context.Context`：

```go
stdCtx := console.WithContext(parentCtx, commandCtx)
```

获取底层 Cobra 命令：

```go
cobraCmd := console.CobraCommand(commandCtx)
```

### 上下文方法一览

| 方法 | 返回类型 | 说明 |
| --- | --- | --- |
| `Context()` | `context.Context` | 返回绑定的标准 Go context |
| `CommandName()` | `string` | 返回当前命令名称 |
| `Definition()` | `*Definition` | 返回命令定义的副本 |
| `Input()` | `Input` | 返回输入接口 |
| `IO()` | `IO` | 返回输出接口 |
| `Argument(name)` | `string` | 读取参数（便捷方法） |
| `Arguments(name)` | `[]string` | 读取数组参数 |
| `Option(name)` | `string` | 读取选项 |
| `OptionStrings(name)` | `[]string` | 读取数组选项 |
| `OptionBool(name)` | `bool` | 读取布尔选项 |
| `OptionInt(name)` | `int` | 读取整数选项 |
| `HasOption(name)` | `bool` | 判断选项是否存在 |
| `Call(signature, ...input)` | `error` | 调用其他命令 |
| `CallSilently(signature, ...input)` | `error` | 静默调用其他命令 |
| `Fail(...messageOrErr)` | `error` | 构造主动失败错误 |
| `Trap(signals, callback)` | `(func(), error)` | 注册信号处理器 |

### 信号处理（Trap）

`Trap` 允许命令捕获操作系统信号，适合长运行命令的优雅退出：

```go
release, err := ctx.Trap([]os.Signal{syscall.SIGTERM, syscall.SIGINT}, func(sig os.Signal) {
    fmt.Printf("Received signal: %v\n", sig)
    // 执行清理逻辑...
})
if err != nil {
    return err
}
defer release()
```

**规则**：
- 必须提供至少一个信号
- `callback` 不能为 `nil`
- 返回的 `release` 函数用于取消信号监听
- 命令上下文结束时，`ReleaseTraps` 会自动释放所有已注册的 trap

### 主动失败（Fail）

`Fail` 构造一个可被 Kernel 识别的主动失败错误，命令可以通过 `ctx.Fail()` 主动标记失败：

```go
return ctx.Fail("something went wrong")

// 或包装一个 error
return ctx.Fail(err)

// 或组合消息和 error
return ctx.Fail("processing failed:", err)
```

使用 `IsManualFailure` 判断错误是否为主动失败：

```go
if manual, ok := console.IsManualFailure(err); ok {
    fmt.Println("Manual failure:", manual.Message)
}
```

## 命令互调

### Call 调用其他命令

在命令内部调用另一个命令：

```go
err := ctx.Call("mail:send", console.CallInput{
    Arguments: map[string]string{"user": "1"},
    Options:   map[string]string{"queue": "default"},
})
```

### CallSilently 静默调用

静默调用不输出任何内容：

```go
err := ctx.CallSilently("mail:send", console.CallInput{
    Arguments: map[string]string{"user": "1"},
})
```

### CallInput 传参

`CallInput` 用于程序化调用时传递参数和选项：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Arguments` | `map[string]string` | 传递给目标命令的参数 |
| `Options` | `map[string]string` | 传递给目标命令的选项 |

## 命令隔离（Isolatable）

实现 `Isolatable` 接口可以防止同一命令的多个实例并发执行：

```go
type SyncCommand struct{}

func (c *SyncCommand) IsolationKey(ctx console.CommandContext) string {
    // 返回隔离 key，相同 key 的命令不会并发执行
    // 默认使用命令名，可以基于参数定制
    return c.CommandName() + ":" + ctx.Argument("tenant")
}
```

Kernel 在执行 `Isolatable` 命令前会检查隔离锁，如果已有相同 key 的命令在运行，则新命令会被拒绝。

## 缺失参数交互提示（PromptsForMissingInput）

实现 `PromptsForMissingInput` 接口，可以在必填参数缺失时自动交互提示用户输入：

```go
type SendEmailsCommand struct{}

// PromptForMissingArgumentsUsing 返回每个缺失参数的交互提示配置
func (c *SendEmailsCommand) PromptForMissingArgumentsUsing() []console.MissingArgumentPrompt {
    return []console.MissingArgumentPrompt{
        {
            Question: "Which user should receive the email?",
            Default:  "1",
            Ask:      nil, // 使用默认 Ask 行为
        },
    }
}

// AfterPromptingForMissingArguments 在交互提示完成后执行
func (c *SendEmailsCommand) AfterPromptingForMissingArguments(ctx console.CommandContext) {
    // 可选：在提示完成后执行额外逻辑
}
```

`MissingArgumentPrompt` 字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Question` | `string` | 提示问题文本 |
| `Default` | `string` | 默认值 |
| `Ask` | `func(io IO) (string, error)` | 自定义提问函数，为 `nil` 时使用默认 `Ask` |

## ANSI 颜色支持

Console 包实现了 Symfony/Laravel 风格的 ANSI 颜色自动检测：

```go
// 解析输出选项
opts := console.ResolveOutputOptions(os.Stdout, ansiSet, noANSISet, quiet, silent)

// 检测是否支持 ANSI
supportsANSI := console.SupportsANSI(os.Stdout)
```

**ANSI 检测优先级**（从高到低）：

1. `--no-ansi` 标志：强制关闭
2. `--ansi` 标志：强制开启
3. `NO_COLOR` 环境变量：关闭颜色
4. `FORCE_COLOR` 环境变量：开启颜色（`0`/`false`/`no`/`off` 除外）
5. 终端自动检测：检查输出流是否为 TTY，以及 `COLORTERM`、`TERM` 等环境变量

**OutputOptions 字段**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ANSI` | `bool` | 是否启用 ANSI 样式 |
| `Quiet` | `bool` | 静默模式，仅显示错误 |
| `Silent` | `bool` | 完全静默，不输出任何内容 |

## 命令列表渲染

`RenderCommandList` 渲染 Symfony/Laravel 风格的命令列表：

```go
err := console.RenderCommandList(os.Stdout, definitions, console.CommandListOptions{
    AppName:     "PrismGo",
    Description: "PrismGo Framework",
    Format:      "txt",  // 支持 "txt"、"json"、"md"
    Output:      opts,
})
```

**CommandListOptions 字段**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `AppName` | `string` | 应用名称，用于 markdown 格式标题 |
| `Description` | `string` | 列表顶部描述文本 |
| `Namespace` | `string` | 按命名空间过滤（如 `"mail"` 只显示 `mail:*` 命令） |
| `Format` | `string` | 输出格式：`"txt"`（默认）、`"json"`、`"md"` |
| `Raw` | `bool` | 原始格式，每行 `name description` |
| `Short` | `bool` | 短格式，每行只显示命令名 |
| `Output` | `OutputOptions` | 输出选项 |

**命令分组规则**：命令按 `:` 前的命名空间自动分组，例如 `mail:send` 和 `mail:queue` 归入 `mail` 组，没有 `:` 的命令归入默认组。

**ArgumentDescriptors 和 RenderArgumentList** 用于渲染 help 中的参数明细：

```go
descriptors := console.ArgumentDescriptors(definition.Arguments)
console.RenderArgumentList(os.Stdout, definition.Arguments, opts)
```

## Definition 校验与规范化

`NormalizeDefinition` 校验并整理 Definition，返回适合注册到 Kernel 的规范化定义：

```go
normalized, err := console.NormalizeDefinition(definition)
```

**校验规则**：
- 命令名不能为空
- 参数名不能为空，不能重复
- 可选参数不能出现在必填参数之前
- 数组参数之后不能再有其他参数
- 选项名不能为空，不能重复
- 短选项必须是单个字符，不能重复
- 数组选项必须接收值
- 所有名称和描述会 TrimSpace
- 别名和示例会去重、去空

`CloneDefinition` 深拷贝 Definition，避免注册时修改调用方传入的数据：

```go
cloned := console.CloneDefinition(definition)
```

`DefinitionUsage` 生成适合 Cobra `Use` 字段的参数用法字符串：

```go
usage := console.DefinitionUsage(definition)
// 例如: "mail:send <user> [--queue]"
```

## Cobra 绑定

`BindDefinitionFlags` 根据结构化 Definition 为 Cobra 命令注册 flags：

```go
err := console.BindDefinitionFlags(cobraCmd, definition)
```

该方法会根据 Option 的 `ValueMode`、`IsArray`、`Shortcut` 等字段自动选择合适的 Cobra flag 类型（`Bool`/`String`/`StringArray` 等），并设置 `NoOptDefVal` 以支持可选值选项的裸 `--flag` 形式。

## 包级快捷函数

Console 包提供了一组包级快捷函数，直接输出到 `os.Stdout`/`os.Stderr`，适合在简单脚本或初始化阶段使用：

| 函数 | 说明 |
| --- | --- |
| `console.Line(msg, ...style)` | 打印消息，可选样式 |
| `console.Info(msg)` | 打印绿色信息消息 |
| `console.Comment(msg)` | 打印黄色注释消息 |
| `console.Question(msg)` | 打印黑字青底问题消息 |
| `console.Success(msg)` | 打印白字绿底成功消息 |
| `console.Warn(msg)` | 打印黄色警告消息 |
| `console.Error(msg)` | 打印白字红底错误消息 |
| `console.Alert(msg)` | 打印黄色警示块 |
| `console.Exit(msg)` | 打印错误消息并退出进程 |
| `console.ExitIf(err)` | 在 `err != nil` 时打印错误并退出 |

> 包级快捷函数不依赖 Kernel 或 CommandContext，适合在命令外使用。在命令内部应优先使用 `ctx.IO()` 的方法。

## 与 Laravel Artisan Console 的对应关系

| Laravel 概念 | PrismGo 等价 |
| --- | --- |
| `protected $signature` | `Definition()` 返回 `MustDefinition(signature, desc)` |
| `protected $description` | `MustDefinition` 的第二个参数 |
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
| `Isolatable` 接口 | `console.Isolatable` 接口 |
| `Artisan::call('command', $args)` | `ctx.Call("command", callInput)` |
| `Artisan::queue('command', $args)` | 通过队列系统异步调度 |
| `{name}` 必填参数 | `{name}` |
| `{name?}` 可选参数 | `{name?}` |
| `{name=default}` 带默认值参数 | `{name=default}` |
| `{name*}` 数组参数 | `{name*}` |
| `{--flag}` 布尔开关 | `{--flag}` |
| `{--option=default}` 带值选项 | `{--option=default}` |
| `{--O\|option}` 短选项 | `{--O\|option}` |
| `{--id=*}` 数组选项 | `{--id=*}` |
