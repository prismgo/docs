---
title: "Translation"
---

# Translation

- [Overview](#overview)
- [Configuration](#configuration)
- [Defining Translation Strings](#defining-translation-strings)
- [Retrieving Translation Strings](#retrieving-translation-strings)
- [Replacing Parameters](#replacing-parameters)
- [Pluralization](#pluralization)
- [Locale Management](#locale-management)
- [Overriding Package Language Files](#overriding-package-language-files)
- [Adding Lines at Runtime](#adding-lines-at-runtime)
- [Handling Missing Keys](#handling-missing-keys)
- [Translation File Paths](#translation-file-paths)
- [Custom Loaders](#custom-loaders)
- [Interface Reference](#interface-reference)
- [Testing](#testing)

---

## Overview

PrismGo's translation component provides a convenient way to manage multilingual strings in an application, aligned with Laravel's localization subsystem. It supports two ways to define strings: short keys and JSON keys that use the default text as the key. Translation files live in the application's `lang` directory and are organized by locale code.

## Configuration

### Environment Variables

The translator's `locale` and `fallback_locale` are configured through `app.locale` and `app.fallback_locale`, usually in `.env`:

```env
APP_LOCALE=en
APP_FALLBACK_LOCALE=en
```

These values are read during the `Register` phase of the `ServiceProvider` and used to initialize the translator. Both default to `"en"`.

### Registering the Service Provider

The translation component is registered automatically by the framework through `foundation.applicationBaseProviders`; no manual setup is required. During `Register`, the provider:

1. Resolves `path.base` from the container and uses `{basePath}/lang` as the default language directory.
2. Registers a `FileLoader` singleton under `"translation.loader"` and automatically calls `AddPath` and `AddJSONPath`.
3. Registers a `Translator` singleton under `"translator"` and reads `app.locale` and `app.fallback_locale`.

```go
// Bindings registered automatically:
// - "translation.loader" -> FileLoader singleton
// - "translator"         -> Translator singleton
```

## Defining Translation Strings

PrismGo supports both short-key translations and JSON-key translations.

### Short Keys

Short-key translations are stored in grouped files under `lang/{locale}/{group}.json`:

```text
lang/
  en/
    messages.json    -> {"welcome": "Welcome to our application!"}
    validation.json  -> {"required": "This field is required."}
  zh_CN/
    messages.json    -> {"welcome": "Welcome to our application!"}
    validation.json  -> {"required": "This field is required."}
```

For locales with regional differences, use ISO 15897 directory names, such as `"en_GB"` instead of `"en-gb"`.

Nested structures are supported:

```json
{
    "auth": {
        "failed": "These credentials do not match our records.",
        "throttle": "Too many login attempts. Please try again in :seconds seconds."
    }
}
```

### JSON Keys

For applications with many translatable strings, creating short keys for every string can become unwieldy. PrismGo also supports using the default translation text itself as the key. These files are stored as `lang/{locale}.json`:

```text
lang/
  en.json    -> {"I love programming.": "I love programming."}
  zh_CN.json -> {"I love programming.": "I love programming."}
```

Do not define a translation key that conflicts with a translation file name. For example, if `nl/action.php` exists but `nl.json` does not, translating `"Action"` may return the content of `nl/action.php`.

### Namespaces

Packages or modules can manage their own translation files through namespaces. Namespaced translations live under `lang/vendor/{namespace}/{locale}/{group}.json`:

```text
lang/
  vendor/
    acme/
      en/
        messages.json -> {"hello": "Hello from acme!"}
      zh_CN/
        messages.json -> {"hello": "Hello from acme!"}
```

After registering a namespace with `AddNamespace`, access strings with `"namespace::group.item"`:

```go
translator.AddNamespace("acme", "/path/to/lang/vendor/acme")
msg := translator.Get("acme::messages.hello", nil)
```

## Retrieving Translation Strings

### Using a Translator Instance

Resolve the translator from the container and call it directly:

```go
translator := container.Make("translator").(transcontract.Translator)
msg := translator.Get("messages.welcome", nil)
```

### Using Facade Helpers

PrismGo also provides Laravel-style facade helpers:

```go
import translation "github.com/prismgo/framework/translation"

msg := translation.Get("messages.welcome", nil)
plural := translation.Choice("messages.apples", 5, nil)
```

If a translation string does not exist, `Get` returns the key itself. For example, missing `"messages.welcome"` returns `"messages.welcome"`.

### Specifying a Locale

`Get` and `Choice` accept an optional locale:

```go
msg := translation.Get("messages.welcome", nil)
msg := translation.Get("messages.welcome", nil, "zh_CN")
```

### Checking Whether a Key Exists

```go
if translation.Has("messages.welcome") {
    // The key exists.
}

if translation.HasForLocale("messages.welcome", "zh_CN") {
    // The key exists in zh_CN.
}
```

### Retrieving a Whole Group

Use `GetMap` to return a whole translation group:

```go
messages := translation.GetMap("messages", "en")
// messages = {"welcome": "Welcome", "exit": "Goodbye"}
```

Nested subgroups are also supported:

```go
auth := translation.GetMap("messages.auth", "en")
// auth = {"failed": "Auth failed", "throttle": "Too many attempts"}
```

## Replacing Parameters

Placeholders start with `:`:

```json
{
    "welcome": "Welcome, :name"
}
```

Pass replacement values as the second argument:

```go
msg := translation.Get("messages.welcome", map[string]any{"name": "dayle"})
// msg = "Welcome, dayle"
```

### Placeholder Case Rules

| Placeholder | Effect | Example |
| --- | --- | --- |
| `:name` | Preserve value as-is | `"dayle"` -> `"dayle"` |
| `:Name` | Title case the value | `"dayle"` -> `"Dayle"` |
| `:NAME` | Uppercase the value | `"dayle"` -> `"DAYLE"` |

Example:

```json
{
    "welcome": "Welcome, :NAME",
    "goodbye": "Goodbye, :Name"
}
```

```go
translation.Get("welcome", map[string]any{"name": "dayle"})
// -> "Welcome, DAYLE"

translation.Get("goodbye", map[string]any{"name": "dayle"})
// -> "Goodbye, Dayle"
```

### Custom Formatting With Stringable

Register a formatter with `Stringable` when custom types need to be used as placeholder values:

```go
type Money struct{ Amount int }

translation.Stringable(Money{}, func(a any) string {
    m := a.(Money)
    return fmt.Sprintf("$%d", m.Amount)
})

msg := translation.Get("price", map[string]any{"amount": Money{100}})
// Translation string "Price: :amount" -> "Price: $100"
```

If the value implements `fmt.Stringer`, its `String()` method is used first. Built-in support includes `string`, `int`, `int64`, `float64`, `bool`, and similar primitive types.

`Stringable` is usually called from a service provider's `Boot` method.

## Pluralization

Pluralization is complex and languages have different rules. PrismGo supports selecting translation variants based on a number.

### Basic Pipe Syntax

Separate variants with `|`:

```json
{
    "apples": "There is one apple|There are many apples"
}
```

Use `Choice`:

```go
msg := translation.Choice("messages.apples", 10, nil)
// msg = "There are many apples"
```

When no explicit interval marker is provided, the default selection rules are:

- Three variants: `0` -> first, `1` -> second, `>=2` -> third.
- Two variants: `0` -> first, `>=1` -> second.

### Explicit Intervals

More complex pluralization rules can specify ranges:

```json
{
    "apples": "{0} There are none|[1,19] There are some|[20,*] There are many"
}
```

Supported interval formats:

| Format | Meaning | Example |
| --- | --- | --- |
| `{0}` | Exact match for 0 | `{0} No items` |
| `{1}` | Exact match for 1 | `{1} One item` |
| `[1,19]` | Closed interval, 1 <= number <= 19 | `[1,19] Some items` |
| `[2,*]` | Open interval, number >= 2 | `[2,*] Many items` |
| `[*,5]` | Open interval, number <= 5 | `[*,5] Few items` |
| `[5]` | Exact match for 5, equivalent to `{5}` | `[5] Exactly five` |

### Placeholders in Pluralized Strings

Pluralized strings may also contain placeholders:

```json
{
    "minutes_ago": "{1} :value minute ago|[2,*] :value minutes ago"
}
```

```go
msg := translation.Choice("time.minutes_ago", 5, map[string]any{"value": 5})
// msg = "5 minutes ago"
```

Use the built-in `:count` placeholder to display the number passed to `Choice`:

```json
{
    "apples": "{0} There are none|{1} There is one|[2,*] There are :count"
}
```

```go
msg := translation.Choice("messages.apples", 10, nil)
// msg = "There are 10"
```

If `replace` already contains a `"count"` key, it is not overwritten.

## Locale Management

### Current Locale

```go
locale := translation.Locale()
locale := translation.CurrentLocale()

translation.SetLocale("zh_CN")
translation.IsLocale("en")
```

`SetLocale` validates the locale and rejects path traversal characters (`/` and `\`). If an invalid value is passed, an error is returned and the locale is not changed.

### Fallback Locale

When a key is missing from the current locale, the translator searches:

1. Current `locale`.
2. `fallback_locale` from configuration.

```go
fallback := translation.GetFallback()
translation.SetFallback("en")
```

`SetFallback` performs the same path traversal validation as `SetLocale`.

Example:

```go
// locale=zh_CN, fallback=en
// "hello" is missing from zh_CN but exists in en as "Hello"
msg := translation.Get("hello", nil)
// msg = "Hello"
```

### Custom Locale Resolution

`DetermineLocalesUsing` lets you fully customize the lookup order:

```go
translation.DetermineLocalesUsing(func(key string, requested string) []string {
    return []string{"zh_CN", "en", "fr"}
})
```

The translator then searches in that order instead of the default current-locale-then-fallback order.

## Overriding Package Language Files

External packages may ship their own language files. Override them by placing files under `lang/vendor/{package}/{locale}/`:

```text
lang/
  vendor/
    hearthfire/
      en/
        messages.json -> {"fire": "Custom fire translation"}
```

Register the namespace and hint path:

```go
translation.AddNamespace("hearthfire", "/path/to/lang/vendor/hearthfire")
msg := translation.Get("hearthfire::messages.fire", nil)
```

Loading priority is: namespace hint path first, then `lang/vendor/{namespace}/`. A hint path can therefore fully override files under the vendor directory.

## Adding Lines at Runtime

`AddLines` dynamically adds translation strings without files:

```go
translation.AddLines(map[string]any{
    "welcome": "Welcome",
    "messages.greeting": "Hello, :Name",
}, "en")

translation.AddLines(map[string]any{
    "alerts.info": "Info from acme",
}, "en", "acme")
```

Lines added through `AddLines` take precedence over file-loader translations. This is useful for tests and dynamic overrides.

`AddLines` supports dot-separated keys such as `"messages.greeting"` and stores them internally as group and item entries.

## Handling Missing Keys

Use `HandleMissingKeysUsing` to register a callback for missing keys:

```go
translation.HandleMissingKeysUsing(func(ctx context.Context, key, locale string) (string, bool) {
    if key == "custom.missing" {
        return "custom missing value", true
    }
    return "", false
})
```

- Returning `(value, true)` uses `value` as the translation result.
- Returning `("", false)` continues the default missing-key behavior, which returns the key itself.

## Translation File Paths

The translator loads files through `FileLoader`.

### Group Paths

`AddPath` loads grouped translation files in the `lang/{locale}/{group}.json` format:

```go
translation.AddPath("/path/to/lang")
```

Multiple paths may be added. They are merged in registration order, and later paths override keys from earlier paths. Duplicate paths are automatically ignored.

### JSON Paths

`AddJSONPath` loads root-level JSON translation files in the `lang/{locale}.json` format:

```go
translation.AddJSONPath("/path/to/lang")
```

Multiple paths are supported and deduplicated. During the service provider's `Register` phase, if `"path.base"` is bound in the container, `{basePath}/lang` is registered as both a group path and JSON path.

## Custom Loaders

`FileLoader` implements the `Loader` interface. To load translations from a database, remote service, or other source, implement `Loader` and replace the default loader:

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

```go
customLoader := NewDatabaseLoader(db)
translator := container.Make("translator").(*translation.Translator)
translator.SetLoader(customLoader)
```

## Interface Reference

### Translator

```go
type Translator interface {
    Get(key string, replace map[string]any, locale ...string) string
    Choice(key string, number any, replace map[string]any, locale ...string) string
    Has(key string, locale ...string) bool
    HasForLocale(key, locale string) bool
    GetMap(key string, locale ...string) map[string]any

    AddLines(lines map[string]any, locale string, namespace ...string)

    Locale() string
    CurrentLocale() string
    SetLocale(locale string) error
    IsLocale(locale string) bool

    GetFallback() string
    SetFallback(locale string) error

    AddNamespace(namespace, hint string)
    AddPath(path string)
    AddJSONPath(path string)

    Stringable(sample any, formatter func(any) string)
    HandleMissingKeysUsing(handler func(context.Context, string, string) (string, bool))
    DetermineLocalesUsing(resolver func(key string, requested string) []string)
}
```

### Loader

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

### Selector

```go
type Selector interface {
    Select(message string, number any, locale string) string
}
```

## Testing

In tests, use `Reset()` to clear translator state, including state operated through the facade:

```go
func TestSomething(t *testing.T) {
    translation.Reset()
    translation.AddLines(map[string]any{"test": "Test"}, "en")
}
```

Or create an isolated `Translator` and `FileLoader`:

```go
loader := translation.NewFileLoader()
translator := translation.NewTranslator(loader, "en", "en")
translator.AddLines(map[string]any{"welcome": "Welcome"}, "en")
result := translator.Get("welcome", nil)
```
