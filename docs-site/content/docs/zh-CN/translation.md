---
title: "Translation"
---

# Translation

- [概述](#概述)
- [配置](#配置)
  - [环境变量](#环境变量)
  - [注册服务提供者](#注册服务提供者)
- [定义翻译字符串](#定义翻译字符串)
  - [短键（Short Key）](#短键short-key)
  - [以翻译字符串作为键（JSON Key）](#以翻译字符串作为键json-key)
  - [命名空间翻译（Namespace）](#命名空间翻译namespace)
- [获取翻译字符串](#获取翻译字符串)
  - [使用 Translator 实例](#使用-translator-实例)
  - [使用 Facade 便捷方法](#使用-facade-便捷方法)
  - [指定语言环境](#指定语言环境)
  - [检查翻译键是否存在](#检查翻译键是否存在)
  - [获取整个分组](#获取整个分组)
- [替换翻译字符串中的参数](#替换翻译字符串中的参数)
  - [占位符大小写规则](#占位符大小写规则)
  - [自定义类型格式化（Stringable）](#自定义类型格式化stringable)
- [复数化（Pluralization）](#复数化pluralization)
  - [基础管道语法](#基础管道语法)
  - [显式区间语法](#显式区间语法)
  - [在复数化字符串中使用占位符](#在复数化字符串中使用占位符)
- [语言环境管理](#语言环境管理)
  - [获取与设置当前语言环境](#获取与设置当前语言环境)
  - [回退语言环境](#回退语言环境)
  - [自定义语言环境解析链](#自定义语言环境解析链)
- [覆盖包语言文件](#覆盖包语言文件)
- [运行时添加翻译行](#运行时添加翻译行)
- [缺失翻译键处理](#缺失翻译键处理)
- [翻译文件加载路径](#翻译文件加载路径)
  - [分组翻译路径（AddPath）](#分组翻译路径addpath)
  - [JSON 翻译路径（AddJSONPath）](#json-翻译路径addjsonpath)
- [自定义加载器](#自定义加载器)
- [接口参考](#接口参考)
  - [Translator 接口](#translator-接口)
  - [Loader 接口](#loader-接口)
  - [Selector 接口](#selector-接口)
- [测试](#测试)

---

## 概述

PrismGo 的翻译组件提供了在应用程序中管理多语言字符串的便捷方式，对齐 Laravel 的本地化子系统。支持两种翻译字符串定义方式：短键（short key）和以默认翻译文本作为键（JSON key）。翻译文件统一存放在应用程序的 `lang` 目录中，按语言代码组织。

## 配置

### 环境变量

翻译器的 `locale` 和 `fallback_locale` 通过配置文件中的 `app.locale` 和 `app.fallback_locale` 字段来设置，通常在 `.env` 文件中定义：

```env
APP_LOCALE=en
APP_FALLBACK_LOCALE=en
```

这些配置在 `ServiceProvider` 的 `Register` 阶段被读取并用于初始化翻译器，默认值均为 `"en"`。

### 注册服务提供者

翻译组件在框架启动时自动注册（`foundation.applicationBaseProviders`），无需手动配置。`ServiceProvider` 在 `Register` 阶段会：

1. 从容器中解析 `path.base`，拼接 `{basePath}/lang` 作为默认翻译目录
2. 以 `"translation.loader"` 为键注册 `FileLoader` 单例，并自动添加 `AddPath` 和 `AddJSONPath`
3. 以 `"translator"` 为键注册 `Translator` 单例，读取 `app.locale` 和 `app.fallback_locale` 配置

```go
// ServiceProvider 自动注册的绑定
// - "translation.loader" → FileLoader 单例
// - "translator"         → Translator 单例
```

## 定义翻译字符串

PrismGo 支持两种翻译字符串定义方式，你可以根据应用场景选择合适的方式。

### 短键（Short Key）

翻译字符串以分组文件的形式存放在 `lang/{locale}/{group}.json` 中。每个分组文件是一个键值对映射：

```
lang/
  en/
    messages.json    → {"welcome": "Welcome to our application!"}
    validation.json  → {"required": "This field is required."}
  zh_CN/
    messages.json    → {"welcome": "欢迎使用我们的应用！"}
    validation.json  → {"required": "此字段为必填。"}
```

对于有地区差异的语言，应按照 ISO 15897 标准命名语言目录，例如英式英语使用 `"en_GB"` 而非 `"en-gb"`。

短键支持嵌套结构，在 JSON 文件中定义子对象即可：

```json
{
    "auth": {
        "failed": "These credentials do not match our records.",
        "throttle": "Too many login attempts. Please try again in :seconds seconds."
    }
}
```

### 以翻译字符串作为键（JSON Key）

对于拥有大量可翻译字符串的应用，为每个字符串定义"短键"可能会变得混乱。因此，PrismGo 也支持使用"默认"翻译文本作为键。使用这种方式时，翻译文件以 JSON 格式存放在 `lang/{locale}.json` 中：

```
lang/
  en.json    → {"I love programming.": "I love programming."}
  zh_CN.json → {"I love programming.": "我喜欢编程。"}
```

**注意：** 不要定义与其他翻译文件名冲突的翻译键。例如，当存在 `nl/action.php` 但不存在 `nl.json` 时，翻译 `"Action"` 会返回整个 `nl/action.php` 的内容。

### 命名空间翻译（Namespace）

外部包或模块可以通过命名空间来管理自己的翻译文件。命名空间翻译文件存放在 `lang/vendor/{namespace}/{locale}/{group}.json` 中：

```
lang/
  vendor/
    acme/
      en/
        messages.json → {"hello": "Hello from acme!"}
      zh_CN/
        messages.json → {"hello": "来自 acme 的 hello！"}
```

使用 `AddNamespace` 注册命名空间后，即可通过 `"namespace::group.item"` 格式访问：

```go
translator.AddNamespace("acme", "/path/to/lang/vendor/acme")
msg := translator.Get("acme::messages.hello", nil)
```

## 获取翻译字符串

你可以通过翻译器实例或 Facade 便捷方法来获取翻译字符串。

### 使用 Translator 实例

从容器中解析翻译器实例后直接调用其方法：

```go
translator := container.Make("translator").(transcontract.Translator)
msg := translator.Get("messages.welcome", nil)
```

### 使用 Facade 便捷方法

PrismGo 提供了与 Laravel 类似的 Facade 便捷调用方式：

```go
import translation "github.com/prismgo/framework/translation"

msg := translation.Get("messages.welcome", nil)
plural := translation.Choice("messages.apples", 5, nil)
```

如果指定的翻译字符串不存在，`Get` 方法将返回翻译键本身。例如，当 `"messages.welcome"` 不存在时，`Get` 方法返回 `"messages.welcome"`。

### 指定语言环境

`Get` 和 `Choice` 方法支持可选的 `locale` 参数，按需指定语言环境：

```go
// 使用当前默认 locale
msg := translation.Get("messages.welcome", nil)

// 指定 zh_CN
msg := translation.Get("messages.welcome", nil, "zh_CN")
```

### 检查翻译键是否存在

使用 `Has` 方法判断翻译键是否存在：

```go
if translation.Has("messages.welcome") {
    // 翻译键存在
}
```

也可以指定语言环境来检查：

```go
if translation.HasForLocale("messages.welcome", "zh_CN") {
    // 在 zh_CN 语言环境中该键存在
}
```

### 获取整个分组

使用 `GetMap` 方法获取整个翻译分组的键值对映射：

```go
messages := translation.GetMap("messages", "en")
// messages = {"welcome": "Welcome", "exit": "Goodbye"}
```

也可以获取嵌套的子分组：

```go
auth := translation.GetMap("messages.auth", "en")
// auth = {"failed": "Auth failed", "throttle": "Too many attempts"}
```

## 替换翻译字符串中的参数

你可以在翻译字符串中定义占位符。所有占位符都以 `:` 为前缀。例如，你可以定义一个带有 `name` 占位符的欢迎消息：

```json
{
    "welcome": "Welcome, :name"
}
```

获取翻译字符串时，将替换 `map` 作为第二个参数传入：

```go
msg := translation.Get("messages.welcome", map[string]any{"name": "dayle"})
// msg = "Welcome, dayle"
```

### 占位符大小写规则

占位符的大小写会影响替换后值的格式：

| 占位符 | 效果 | 示例 |
|--------|------|------|
| `:name` | 值保持原样，不做大小写转换 | `"dayle"` → `"dayle"` |
| `:Name` | 值的首字母大写（Title Case） | `"dayle"` → `"Dayle"` |
| `:NAME` | 值全部转为大写 | `"dayle"` → `"DAYLE"` |

示例：

```json
{
    "welcome": "Welcome, :NAME",
    "goodbye": "Goodbye, :Name"
}
```

```go
translation.Get("welcome", map[string]any{"name": "dayle"})
// → "Welcome, DAYLE"

translation.Get("goodbye", map[string]any{"name": "dayle"})
// → "Goodbye, Dayle"
```

### 自定义类型格式化（Stringable）

如果你需要将自定义类型作为翻译占位符的值，可以通过 `Stringable` 方法注册自定义格式化处理器。当占位符的值类型匹配时，会调用注册的格式化函数：

```go
type Money struct{ Amount int }

translation.Stringable(Money{}, func(a any) string {
    m := a.(Money)
    return fmt.Sprintf("$%d", m.Amount)
})

msg := translation.Get("price", map[string]any{"amount": Money{100}})
// 翻译字符串 "Price: :amount" → "Price: $100"
```

如果类型实现了 `fmt.Stringer` 接口，则优先使用 `String()` 方法。内置支持的类型包括 `string`、`int`、`int64`、`float64`、`bool` 等。

通常，`Stringable` 方法应在 `ServiceProvider` 的 `Boot` 方法中调用。

## 复数化（Pluralization）

复数化是一个复杂的问题，不同语言有各种复杂的复数规则。PrismGo 支持基于数量选择不同的翻译变体，帮助你在不同数量下翻译字符串。

### 基础管道语法

使用 `|` 字符分隔多个变体：

```json
{
    "apples": "There is one apple|There are many apples"
}
```

使用 `Choice` 方法根据数量获取对应的翻译：

```go
msg := translation.Choice("messages.apples", 10, nil)
// msg = "There are many apples"
```

当没有显式区间标记时，默认分配规则：

- **三个变体**：`0` → 第一个，`1` → 第二个，`≥2` → 第三个
- **两个变体**：`0` → 第一个，`≥1` → 第二个

### 显式区间语法

你还可以创建更复杂的复数规则，为多个值范围指定翻译字符串：

```json
{
    "apples": "{0} There are none|[1,19] There are some|[20,*] There are many"
}
```

**支持的区间格式：**

| 格式 | 含义 | 示例 |
|------|------|------|
| `{0}` | 精确匹配，数量为 0 | `{0} No items` |
| `{1}` | 精确匹配，数量为 1 | `{1} One item` |
| `[1,19]` | 闭区间，1 ≤ 数量 ≤ 19 | `[1,19] Some items` |
| `[2,*]` | 开区间，数量 ≥ 2 | `[2,*] Many items` |
| `[*,5]` | 开区间，数量 ≤ 5 | `[*,5] Few items` |
| `[5]` | 精确匹配，数量为 5（等同于 `{5}`） | `[5] Exactly five` |

### 在复数化字符串中使用占位符

在复数化字符串中也可以定义占位符属性。通过传递第三个参数来替换：

```json
{
    "minutes_ago": "{1} :value minute ago|[2,*] :value minutes ago"
}
```

```go
msg := translation.Choice("time.minutes_ago", 5, map[string]any{"value": 5})
// msg = "5 minutes ago"
```

如果需要显示传入 `Choice` 的整数值，可以使用内置的 `:count` 占位符：

```json
{
    "apples": "{0} There are none|{1} There is one|[2,*] There are :count"
}
```

```go
msg := translation.Choice("messages.apples", 10, nil)
// msg = "There are 10"
```

**注意：** 如果 `replace` 参数中已经包含 `"count"` 键，则该值不会被覆盖。

## 语言环境管理

### 获取与设置当前语言环境

```go
locale := translation.Locale()        // 获取当前 locale，如 "en"
locale := translation.CurrentLocale() // 与 Locale() 相同

translation.SetLocale("zh_CN")        // 切换到中文
translation.IsLocale("en")            // 检查当前是否为英文
```

**安全校验：** `SetLocale` 会校验 `locale` 参数，禁止包含路径遍历字符（`/` 和 `\`），以防止安全问题。如果传入非法字符，调用将返回错误且 `locale` 不会被修改。

### 回退语言环境

当当前语言环境中找不到指定翻译键时，翻译器会按以下顺序查找：

1. 当前 `locale`
2. `fallback_locale`（通过 `app.fallback_locale` 配置）

```go
fallback := translation.GetFallback()  // 获取当前回退语言
translation.SetFallback("en")          // 设置回退语言
```

与 `SetLocale` 一样，`SetFallback` 也会校验参数，禁止路径遍历字符。

**回退链示例：**

```go
// 配置：locale=zh_CN，fallback=en
// 翻译文件：zh_CN 中没有 "hello" 键，en 中有 "hello" → "Hello"
msg := translation.Get("hello", nil)
// msg = "Hello"（回退到 en）
```

### 自定义语言环境解析链

使用 `DetermineLocalesUsing` 方法可以完全自定义语言环境的查找顺序：

```go
translation.DetermineLocalesUsing(func(key string, requested string) []string {
    return []string{"zh_CN", "en", "fr"}
})
```

这会让翻译器按照你指定的顺序依次查找翻译键，而不是使用默认的 `当前 locale → fallback_locale` 顺序。

## 覆盖包语言文件

有些外部包可能附带自己的语言文件。你可以通过将文件放在 `lang/vendor/{package}/{locale}/` 目录中来覆盖这些翻译，而无需修改包的原始文件：

```
lang/
  vendor/
    hearthfire/
      en/
        messages.json → {"fire": "Custom fire translation"}
```

使用 `AddNamespace` 注册命名空间，并指定 `hint` 路径：

```go
translation.AddNamespace("hearthfire", "/path/to/lang/vendor/hearthfire")
msg := translation.Get("hearthfire::messages.fire", nil)
```

**加载优先级：** 命名空间 `hint` 路径 > `lang/vendor/{namespace}/` 路径。这意味着你可以通过 `hint` 路径完全覆盖 `vendor` 目录下的翻译文件。

## 运行时添加翻译行

使用 `AddLines` 方法可以在运行时动态添加翻译字符串，无需文件：

```go
translation.AddLines(map[string]any{
    "welcome": "Welcome",
    "messages.greeting": "Hello, :Name",
}, "en")

// 也可以指定命名空间
translation.AddLines(map[string]any{
    "alerts.info": "Info from acme",
}, "en", "acme")
```

通过 `AddLines` 添加的翻译行优先于文件加载器中的翻译，适合测试环境或需要动态覆盖翻译的场景。

**注意：** `AddLines` 支持点分隔的键名（如 `"messages.greeting"`），会自动解析为 `group` 和 `item` 存入内部缓存。

## 缺失翻译键处理

使用 `HandleMissingKeysUsing` 方法可以注册一个回调函数，在翻译键缺失时被调用：

```go
translation.HandleMissingKeysUsing(func(ctx context.Context, key, locale string) (string, bool) {
    if key == "custom.missing" {
        return "自定义缺失值", true
    }
    return "", false  // 返回 false 继续默认逻辑（返回 key 本身）
})
```

- 回调返回 `(value, true)` 时使用该值作为翻译结果
- 回调返回 `("", false)` 时继续执行默认的缺失键处理逻辑（返回 key 本身）

## 翻译文件加载路径

翻译器通过 `FileLoader` 从文件系统中加载翻译文件。你可以通过以下方法管理加载路径。

### 分组翻译路径（AddPath）

用于加载 `lang/{locale}/{group}.json` 格式的分组翻译文件：

```go
translation.AddPath("/path/to/lang")
```

可以添加多个路径，加载时会按添加顺序合并，后添加的路径中的翻译会覆盖先添加的路径中同名的键。重复添加同一路径会被自动去重。

### JSON 翻译路径（AddJSONPath）

用于加载 `lang/{locale}.json` 格式的根级 JSON 翻译文件：

```go
translation.AddJSONPath("/path/to/lang")
```

同样支持添加多个路径，按添加顺序合并，重复路径自动去重。

在 `ServiceProvider` 的 `Register` 阶段，如果容器中有 `"path.base"` 绑定，会自动将 `{basePath}/lang` 同时注册为分组路径和 JSON 路径。

## 自定义加载器

`FileLoader` 实现了 `Loader` 接口。如果你需要从数据库、远程服务或其他来源加载翻译，可以实现 `Loader` 接口并替换默认的加载器：

```go
type Loader interface {
    Load(locale, group, namespace string) (map[string]any, error)
    AddNamespace(namespace, hint string)
    AddPath(path string)
    AddJSONPath(path string)
    Namespaces() map[string]string
    Paths() []string
    JSONPaths() []string
}
```

使用 `SetLoader` 方法替换加载器：

```go
customLoader := NewDatabaseLoader(db)
translator := container.Make("translator").(*translation.Translator)
translator.SetLoader(customLoader)
```

## 接口参考

### Translator 接口

```go
type Translator interface {
    // 翻译检索
    Get(key string, replace map[string]any, locale ...string) string
    Choice(key string, number any, replace map[string]any, locale ...string) string
    Has(key string, locale ...string) bool
    HasForLocale(key, locale string) bool
    GetMap(key string, locale ...string) map[string]any

    // 运行时添加翻译行
    AddLines(lines map[string]any, locale string, namespace ...string)

    // 语言环境管理
    Locale() string
    CurrentLocale() string
    SetLocale(locale string) error
    IsLocale(locale string) bool

    // 回退语言
    GetFallback() string
    SetFallback(locale string) error

    // 路径与命名空间管理
    AddNamespace(namespace, hint string)
    AddPath(path string)
    AddJSONPath(path string)

    // 高级功能
    Stringable(sample any, formatter func(any) string)
    HandleMissingKeysUsing(handler func(context.Context, string, string) (string, bool))
    DetermineLocalesUsing(resolver func(key string, requested string) []string)
}
```

### Loader 接口

```go
type Loader interface {
    Load(locale, group, namespace string) (map[string]any, error)
    AddNamespace(namespace, hint string)
    AddPath(path string)
    AddJSONPath(path string)
    Namespaces() map[string]string
    Paths() []string
    JSONPaths() []string
}
```

### Selector 接口

```go
type Selector interface {
    Select(message string, number any, locale string) string
}
```

## 测试

在测试环境中，建议使用 `Reset()` 方法清空翻译器状态（包括通过 Facade 操作的内部状态），确保测试之间相互隔离：

```go
func TestSomething(t *testing.T) {
    translation.Reset()
    translation.AddLines(map[string]any{"test": "Test"}, "en")
    // 执行测试...
}
```

或者直接创建独立的 `Translator` 实例和 `FileLoader`：

```go
loader := translation.NewFileLoader()
translator := translation.NewTranslator(loader, "en", "en")
translator.AddLines(map[string]any{"welcome": "Welcome"}, "en")
result := translator.Get("welcome", nil)
```