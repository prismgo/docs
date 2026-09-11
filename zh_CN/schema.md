# 数据库：Schema 构造器

- [简介](#简介)
- [配置](#配置)
  - [配置参数说明](#配置参数说明)
- [Builder 入口](#builder-入口)
  - [绑定迁移连接](#绑定迁移连接)
  - [`New` 构造函数](#new-构造函数)
  - [指定命名连接](#指定命名连接)
  - [包级 Facade](#包级-facade)
- [创建数据表](#创建数据表)
- [修改数据表](#修改数据表)
  - [新增字段](#新增字段)
  - [修改字段](#修改字段)
  - [重命名字段](#重命名字段)
  - [删除字段](#删除字段)
  - [原始 SQL 命令](#原始-sql-命令)
- [重命名与删除表](#重命名与删除表)
  - [重命名与删除](#重命名与删除)
  - [危险清理操作](#危险清理操作)
- [可用字段类型](#可用字段类型)
  - [主键与自增](#主键与自增)
  - [字符串与文本类型](#字符串与文本类型)
  - [数值类型](#数值类型)
  - [日期时间类型](#日期时间类型)
  - [布尔、JSON、二进制、枚举与空间类型](#布尔json二进制枚举与空间类型)
  - [外键 ID 与多态类型](#外键-id-与多态类型)
  - [便捷方法](#便捷方法)
- [字段修饰符](#字段修饰符)
- [修改字段](#修改字段-1)
- [删除字段](#删除字段-1)
  - [删除约定字段](#删除约定字段)
- [索引](#索引)
  - [创建索引](#创建索引)
  - [重命名索引](#重命名索引)
  - [删除索引](#删除索引)
- [外键约束](#外键约束)
  - [创建外键](#创建外键)
  - [删除外键](#删除外键)
- [元数据检查](#元数据检查)
  - [表 / 视图 / Schema 检查](#表--视图--schema-检查)
  - [字段检查](#字段检查)
  - [索引检查](#索引检查)
  - [外键检查](#外键检查)
  - [元数据结构类型](#元数据结构类型)
- [条件执行](#条件执行)
  - [字段条件](#字段条件)
  - [索引条件](#索引条件)
- [外键约束开关](#外键约束开关)
- [数据库与扩展管理](#数据库与扩展管理)
- [SyncModels 过渡能力](#syncmodels-过渡能力)
- [Dialect 兼容性](#dialect-兼容性)
- [与 Laravel Schema 的对应关系](#与-laravel-schema-的对应关系)

---

## 简介

PrismGo 的 `database/schema` 包提供了 Laravel 风格的 Schema 构造器，用于在 Go 迁移中声明数据库表结构。它构建在 GORM 之上，通过 GORM Dialector 携带可选方言能力：

- **MySQL** — framework 核心内置的生产主路径方言
- **SQLite** — 安装 `github.com/prismgo/sqlite` 后可用的测试/开发方言

未安装 SQLite 扩展，或 Dialector 未提供对应能力时，操作会返回 `schema.ErrUnsupportedFeature`，防止生成未经验证的 SQL。扩展安装方式见[数据库：SQLite](database.md#sqlite)。安装后 `schema.New(db)`、`schema.Bind(db)` 与全部迁移调用方式保持不变。

SQLite schema 迁移必须串行执行。SQLite 的外键 PRAGMA 与 attached database 仅作用于单个物理连接，且不支持并发 schema 变更。直接调用约束开关或检查 attached schema 时，应使用 `db.Connection`，并基于该固定连接创建 Schema 构造器。

Schema 构造器适用于：

- 使用声明式 API 创建数据表
- 修改既有表（新增、修改、重命名、删除字段）
- 管理索引和外键约束
- 检查数据库元数据（表、字段、索引、视图、schema、外键）

> 新的迁移应优先使用 `schema.Create` / `schema.Table`，而非模型驱动的方式。`SyncModels` 仅用于承接遗留的 GORM 模型驱动的迁移。

---

## 配置

Schema 构造器不需要独立的配置文件。影响字段类型行为的全局默认值通过包级函数在 `AppServiceProvider` 或 bootstrap 中编程设置：

### 配置参数说明

| 函数 | 默认值 | 说明 |
| --- | --- | --- |
| `schema.DefaultStringLength(length)` | `255` | 未显式指定长度时，`String` / `Char` 字段的默认长度。设置 `191` 以兼容 MySQL < 5.7 或 InnoDB 大前缀索引。 |
| `schema.DefaultTimePrecision(precision)` | `nil`（无精度） | `DateTime`、`Time`、`Timestamp` 字段的默认秒精度。传 `nil` 或负值可关闭。 |
| `schema.DefaultMorphKeyType(kind)` | `"int"` | 多态 ID 字段（`{name}_id`）的数据类型。接受 `"int"`、`"uuid"` 或 `"ulid"`。 |
| `schema.MorphUsingUuids()` | — | `DefaultMorphKeyType("uuid")` 的快捷方式。多态 ID 字段变为 `char(36)`。 |
| `schema.MorphUsingUlids()` | — | `DefaultMorphKeyType("ulid")` 的快捷方式。多态 ID 字段变为 `char(26)`。 |

**在应用 ServiceProvider 中使用示例：**

```go
import "github.com/prismgo/framework/database/schema"

func Boot() {
    schema.DefaultStringLength(191)

    precision := 3
    schema.DefaultTimePrecision(&precision)

    schema.MorphUsingUuids()
}
```

这些默认值会影响：

- 未显式指定长度的 `String` / `Char` 字段
- 未显式指定精度的 `DateTime` / `Time` / `Timestamp` 字段
- `Morphs` / `NullableMorphs` ID 字段类型
- `SyncModels` 解析模型 struct 字段时的默认值

模型字段上显式声明的 `gorm` tag（`size`、`type`、`precision`）不会被覆盖。

---

## Builder 入口

`Builder` 是执行 Schema 操作的核心对象。有四种方式获取 Builder 实例：

### 绑定迁移连接

迁移函数会从 migrator 收到 `*gorm.DB`。使用 `Bind(db)` 将 Schema 构造器绑定到该连接或事务：

```go
func up(db *gorm.DB) error {
    builder := schema.Bind(db)

    if err := builder.Create("customers", func(table *schema.Blueprint) {
        table.Id()
        table.String("name", 100).Comment("客户名称")
    }); err != nil {
        return err
    }

    return builder.Table("customers", func(table *schema.Blueprint) {
        table.String("phone", 32).Nullable().Comment("手机号")
    })
}
```

`Bind` 返回同一个 Builder 实例，支持链式调用。迁移中始终应使用 `Bind(db)`，避免误用未绑定的默认连接。

### `New` 构造函数

创建一个绑定到指定 `*gorm.DB` 的独立 Builder：

```go
builder := schema.New(db)

err := builder.Create("demo_tables", func(table *schema.Blueprint) {
    table.Id()
    table.String("code", 32).Unique()
})
```

### 指定命名连接

使用 `config/database.go` 中 `database.connections.{name}` 定义的连接：

```go
err := schema.Connection("mysql").Create("external_logs", func(table *schema.Blueprint) {
    table.Id()
    table.Text("message")
    table.Timestamps()
})
```

如果连接打开失败，错误会暂存在 Builder 中，并在执行 Schema 操作时返回。

### 包级 Facade

所有 Builder 方法都以包级函数形式暴露，委托给从应用容器解析的默认 Builder：

```go
err := schema.Create("demo_tables", func(table *schema.Blueprint) {
    table.Id()
})

exists := schema.HasTable("demo_tables")
```

这在独立脚本和测试中很方便，但迁移仍应使用 `schema.Bind(db)` 以保持在迁移事务内。

---

## 创建数据表

`Create(table, fn)` 创建新表。如果表已存在则会跳过（幂等）：

```go
err := schema.Bind(db).Create("customers", func(table *schema.Blueprint) {
    table.Id()
    table.UnsignedBigInteger("tenant_id").Comment("租户 ID")
    table.String("name", 100).Comment("客户名称")
    table.String("phone", 32).Nullable().Comment("手机号")
    table.TinyInteger("status").Default(1).Comment("状态：1=启用 2=停用")
    table.Decimal("balance", 12, 2).Default(0).Comment("账户余额")
    table.Json("profile").Nullable().Comment("扩展资料")
    table.Timestamps()
    table.SoftDeletes()

    table.IndexNamed("idx_customers_tenant_status", "tenant_id", "status")
    table.UniqueNamed("uix_customers_tenant_phone", "tenant_id", "phone")
})
```

**注意：**

- 至少需要一个字段，否则返回错误。
- MySQL 会自动追加 `database.TableOptions`（`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`）。
- SQLite 会忽略 MySQL 专属语法（注释、字符集、外键约束）。

---

## 修改数据表

`Table(table, fn)` 修改既有表。支持新增字段、修改字段、重命名字段、删除字段，以及管理索引和外键。

### 新增字段

新增字段时，如果字段已存在则会跳过（幂等）：

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.String("email", 128).Nullable().After("phone").Comment("邮箱")
    table.Timestamp("email_verified_at").Nullable().Comment("邮箱验证时间")
    table.IndexNamed("idx_customers_email", "email")
})
```

### 修改字段

使用 `Change()` 修改既有字段的类型、可空状态或默认值：

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.String("phone", 64).Nullable().Comment("手机号").Change()
})
```

`Change()` 在 MySQL 下编译为 `ALTER TABLE ... MODIFY COLUMN`。SQLite 不支持安全的字段修改，会返回 `schema.ErrUnsupportedFeature`。

### 重命名字段

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.RenameColumn("mobile", "phone")
})
```

如果来源字段不存在或目标字段已存在，操作会跳过。

### 删除字段

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.DropColumn("legacy_code", "legacy_level")
    table.DropColumns([]string{"old_name", "old_phone"})
})
```

不存在的字段会被静默忽略。

### 原始 SQL 命令

对于 DSL 暂时无法表达的一次性结构修复，可以使用 `Raw`：

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.Raw("ALTER TABLE `customers` ADD COLUMN `search_name` varchar(255) GENERATED ALWAYS AS (`name`) STORED")
})
```

常规的字段、索引、外键操作应优先使用 Blueprint 方法，以保证可测试性和跨方言兼容性。

---

## 重命名与删除表

### 重命名与删除

幂等的表级操作：

```go
builder := schema.Bind(db)

// 重命名：来源表不存在或目标表已存在时跳过
err := builder.Rename("old_customers", "customers")

// 删除：表不存在时跳过
err = builder.Drop("temp_customers")
err = builder.DropIfExists("temp_customers")

// 从表中删除指定字段
err = builder.DropColumns("customers", "legacy_code", "legacy_level")
```

### 危险清理操作

请极其谨慎使用——仅适用于测试库和明确的清理命令：

```go
err := schema.Bind(db).DropAllTables()
err = schema.Bind(db).DropAllViews()
err = schema.Bind(db).DropAllTypes()
```

`DropAllTables` 在删除前会临时禁用外键检查。

---

## 可用字段类型

### 主键与自增

| 方法 | MySQL 类型 | 说明 |
| --- | --- | --- |
| `Id(name ...string)` | `bigint unsigned auto_increment primary key` | 默认主键；未传参时使用 `"id"` |
| `Increments(name)` | `int unsigned auto_increment primary key` | 自增 int 主键 |
| `BigIncrements(name)` | `bigint unsigned auto_increment primary key` | 自增 bigint 主键 |
| `TinyIncrements(name)` | `tinyint unsigned auto_increment primary key` | 自增 tinyint 主键 |
| `SmallIncrements(name)` | `smallint unsigned auto_increment primary key` | 自增 smallint 主键 |
| `MediumIncrements(name)` | `mediumint unsigned auto_increment primary key` | 自增 mediumint 主键 |
| `Integer(name)` | `int` | 有符号整数 |
| `BigInteger(name)` | `bigint` | 有符号大整数 |
| `MediumInteger(name)` | `mediumint` | 有符号中整数 |
| `SmallInteger(name)` | `smallint` | 有符号小整数 |
| `TinyInteger(name)` | `tinyint` | 有符号极小整数 |
| `UnsignedInteger(name)` | `int unsigned` | 无符号整数 |
| `UnsignedBigInteger(name)` | `bigint unsigned` | 无符号大整数 |
| `UnsignedMediumInteger(name)` | `mediumint unsigned` | 无符号中整数 |
| `UnsignedSmallInteger(name)` | `smallint unsigned` | 无符号小整数 |
| `UnsignedTinyInteger(name)` | `tinyint unsigned` | 无符号极小整数 |

```go
table.Id()
table.UnsignedBigInteger("tenant_id").Comment("租户 ID")
table.TinyInteger("status").Default(1).Comment("状态：1=启用 2=停用")
```

### 字符串与文本类型

| 方法 | MySQL 类型 | 说明 |
| --- | --- | --- |
| `String(name, length ...int)` | `varchar(length)` | 可变长字符串；默认使用 `DefaultStringLength`（255） |
| `Char(name, length ...int)` | `char(length)` | 固定长度字符串 |
| `Text(name)` | `text` | 长文本 |
| `TinyText(name)` | `tinytext` | 极小文本 |
| `MediumText(name)` | `mediumtext` | 中等文本 |
| `LongText(name)` | `longtext` | 极长文本 |
| `Uuid(name)` | `char(36)` | UUID |
| `Ulid(name)` | `char(26)` | ULID |
| `IpAddress(name)` | `varchar(45)` | IP 地址（支持 IPv4 和 IPv6） |
| `MacAddress(name)` | `varchar(17)` | MAC 地址 |
| `RememberToken()` | `varchar(100) null` | Laravel 风格的 `remember_token` 字段 |

```go
table.String("name", 100).Comment("名称")
table.Text("description").Nullable().Comment("说明")
table.Uuid("uuid").Unique()
table.RememberToken()
```

### 数值类型

| 方法 | MySQL 类型 | 说明 |
| --- | --- | --- |
| `Boolean(name)` | `tinyint(1)` | 布尔值 |
| `Float(name, totalAndPlaces ...int)` | `float(total, places)` | 浮点数；默认精度 (8,2) |
| `Double(name, totalAndPlaces ...int)` | `double(total, places)` | 双精度浮点数；默认精度 (8,2) |
| `Decimal(name, totalAndPlaces ...int)` | `decimal(total, places)` | 精确小数；默认精度 (8,2) |
| `UnsignedDecimal(name, totalAndPlaces ...int)` | `decimal(total, places) unsigned` | 无符号精确小数 |

> 禁止使用 `Float` / `Double` 存储金额，始终使用 `Decimal` 或将金额以最小货币单位（整数）存储。

```go
table.Boolean("is_enabled").Default(true).Comment("是否启用")
table.Decimal("amount", 12, 2).Default(0).Comment("金额")
```

### 日期时间类型

| 方法 | MySQL 类型 | 说明 |
| --- | --- | --- |
| `Date(name)` | `date` | 日期 |
| `DateTime(name)` | `datetime` | 日期时间 |
| `DateTimeTz(name)` | `datetime` | 日期时间（时区感知别名，SQL 相同） |
| `Time(name)` | `time` | 时间 |
| `TimeTz(name)` | `time` | 时间（时区感知别名，SQL 相同） |
| `Timestamp(name)` | `timestamp` | 时间戳 |
| `TimestampTz(name)` | `timestamp` | 时间戳（时区感知别名，SQL 相同） |
| `Year(name)` | `year` | 年份 |
| `Timestamps()` | `created_at`、`updated_at` nullable timestamp | 两个可空时间戳字段 |
| `TimestampsTz()` | 同 `Timestamps()` | 别名（SQL 相同） |
| `SoftDeletes()` | `deleted_at` nullable timestamp + 索引 | 软删除字段及默认索引 |
| `SoftDeletesTz()` | 同 `SoftDeletes()` | 别名（SQL 相同） |

```go
table.Timestamp("published_at").Nullable()
table.Timestamp("created_at").UseCurrent()
table.Timestamp("updated_at").UseCurrent().UseCurrentOnUpdate()
table.Timestamps()
table.SoftDeletes()
```

### 布尔、JSON、二进制、枚举与空间类型

| 方法 | MySQL 类型 | 说明 |
| --- | --- | --- |
| `Binary(name)` | `blob` | 二进制数据 |
| `Json(name)` | `json` | JSON 数据 |
| `Jsonb(name)` | `json` | JSONB 别名；MySQL/SQLite 下编译为 `json` |
| `Enum(name, allowed)` | `enum(...)` | 枚举 |
| `Set(name, allowed)` | `set(...)` | MySQL set 类型 |
| `Geometry(name)` | `geometry` | 空间几何 |
| `Geography(name)` | `geography` | 空间地理 |
| `Point(name)` | `point` | 空间点 |
| `LineString(name)` | `linestring` | 空间线 |
| `Polygon(name)` | `polygon` | 空间面 |
| `Vector(name, dimensions)` | `vector(dimensions)` | 向量字段（如用于 embedding） |

SQLite 测试环境会将多数 MySQL 专属类型降级为兼容类型。

```go
table.Json("payload").Nullable()
table.Enum("source", []string{"manual", "import"}).Default("manual")
table.Vector("embedding", 1536).Nullable()
```

### 外键 ID 与多态类型

```go
table.ForeignId("customer_id")                              // bigint unsigned
table.ForeignIdFor("owner_id")                              // bigint unsigned
table.Morphs("owner")                                       // {name}_id bigint unsigned, {name}_type varchar(255), 联合索引
table.NullableMorphs("source")                              // 同 Morphs 但允许 NULL
```

**行为说明：**

- `ForeignId(name)` 创建 `bigint unsigned` 字段。
- `ForeignIdFor(name)` 是直接别名；传入最终字段名。
- `Morphs(name)` 创建 `{name}_id`、`{name}_type` 和联合索引。
- `NullableMorphs(name)` 功能相同，但两个字段都允许 `NULL`。
- `{name}_id` 的类型由 `DefaultMorphKeyType` 控制（`int`、`uuid` 或 `ulid`）。

### 便捷方法

| 方法 | 说明 |
| --- | --- |
| `NullableTimestamps()` | `Timestamps()` 的别名 |
| `NullableMorphs(name)` | `Morphs` 的可空变体 |

---

## 字段修饰符

每个字段方法返回 `*ColumnDefinition`，支持链式调用：

```go
table.String("name", 100).
    Nullable().
    Default("unknown").
    Comment("名称").
    After("tenant_id").
    Index()
```

| 修饰符 | 说明 |
| --- | --- |
| `Nullable()` | 允许 `NULL` 值 |
| `NotNull()` | 禁止 `NULL` 值（非主键字段的默认行为） |
| `Unsigned()` | 数值字段设为无符号 |
| `AutoIncrement()` | 设置自增 |
| `Primary()` | 设置为主键 |
| `Unique(enabled ...bool)` | 在字段上添加唯一索引；传 `false` 按默认名删除 |
| `Index(enabled ...bool)` | 在字段上添加普通索引；传 `false` 按默认名删除 |
| `Default(value any)` | 设置默认值 |
| `Comment(value string)` | 设置字段注释（仅 MySQL） |
| `First()` | 将字段放到表的第一位置（仅 MySQL） |
| `After(column string)` | 将字段放到指定字段之后（仅 MySQL） |
| `Charset(value string)` | 设置字符集（仅 MySQL 字符串字段） |
| `Collation(value string)` | 设置排序规则（仅 MySQL 字符串字段） |
| `UseCurrent()` | 默认值设为 `CURRENT_TIMESTAMP` |
| `UseCurrentOnUpdate()` | 设置 `ON UPDATE CURRENT_TIMESTAMP` |
| `Invisible()` | 设为不可见字段（仅 MySQL） |
| `Change()` | 标记为修改既有字段（MySQL `MODIFY COLUMN`；SQLite 返回错误） |
| `StoredAs(expr string)` | 声明存储生成列（API 占位，当前不编译） |
| `VirtualAs(expr string)` | 声明虚拟生成列（API 占位，当前不编译） |
| `From(value int)` | Laravel 兼容入口，当前不影响 SQL |
| `Instant()` | Laravel 兼容入口，当前不影响 SQL |
| `Lock(value string)` | Laravel 兼容入口，当前不影响 SQL |

**默认值的 SQL 字面量：**

```go
table.String("name").Default("guest")        // DEFAULT 'guest'
table.Boolean("is_enabled").Default(true)    // DEFAULT 1
table.Integer("sort").Default(0)             // DEFAULT 0
table.Timestamp("created_at").Default("CURRENT_TIMESTAMP")
table.Json("payload").Default("NULL")
```

`CURRENT_TIMESTAMP`、`NULL` 和括号表达式会按原样保留。

---

## 修改字段

使用 `Change()` 修饰符更新既有字段的类型、可空状态或默认值：

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.String("phone", 64).Nullable().Comment("手机号").Change()
})
```

**行为说明：**

- **MySQL**：编译为 `ALTER TABLE ... MODIFY COLUMN`。
- **SQLite**：返回 `schema.ErrUnsupportedFeature`——SQLite 无法在不重建表的情况下安全修改字段类型、可空性或默认值。
- **幂等注意**：`Change()` 不会检查字段是否已匹配目标定义，调用方需确保操作有意义。

---

## 删除字段

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.DropColumn("legacy_code")
    table.DropColumns([]string{"old_name", "old_phone"})
})
```

不存在的字段会被静默忽略。

### 删除约定字段

```go
table.DropRememberToken()                     // 删除 remember_token
table.DropTimestamps()                        // 删除 created_at、updated_at
table.DropTimestampsTz()                      // 同 DropTimestamps
table.DropSoftDeletes()                       // 删除 deleted_at + 默认索引
table.DropSoftDeletesTz()                     // 同 DropSoftDeletes
table.DropMorphs("owner")                     // 删除 owner_id、owner_type + 默认联合索引
table.DropConstrainedForeignId("customer_id") // 删除外键约束 + 字段
table.DropForeignIdFor("owner_id")            // 仅删除字段，保留约束
```

---

## 索引

### 创建索引

```go
table.Primary("id")
table.Unique("tenant_id", "code")
table.Index("tenant_id", "status")
table.FullText("title", "content")
table.SpatialIndex("location")

// 自定义索引名称
table.UniqueNamed("uix_customers_tenant_phone", "tenant_id", "phone")
table.IndexNamed("idx_customers_tenant_status", "tenant_id", "status")
```

**字段级索引：**

```go
table.String("email", 128).Unique()
table.String("phone", 32).Index()
```

**默认索引命名规则**（Laravel 风格）：

```text
{表名}_{列1}_{列2}_{类型}
```

示例：
- `customers_email_unique`
- `customers_tenant_id_status_index`

对于联合索引或关键业务索引，建议显式命名以保证回滚时的名称稳定性：
- 前缀建议：`idx_`（普通）、`uix_`（唯一）、`ftx_`（全文）、`spx_`（空间）
- 名称超过 64 字符时自动截断并附加 SHA1 hash 后缀，以兼容 MySQL。

### 重命名索引

```go
table.RenameIndex("idx_old_name", "idx_new_name")
```

- **MySQL**：编译为 `ALTER TABLE ... RENAME INDEX ...`。
- **SQLite**：跳过（SQLite 的原生重命名索引支持有限）。

### 删除索引

```go
table.DropIndex("idx_customers_email")
table.DropUnique("uix_customers_tenant_phone")
table.DropPrimary()
table.DropFullText("ftx_articles_title")
table.DropSpatialIndex("spx_locations_point")
```

字段级的 `Index(true/false)` 和 `Unique(true/false)` 修饰符也可以删除索引：

```go
// 按默认名删除 "phone" 上的唯一索引
table.String("phone", 32).Unique(false).Change()
```

---

## 外键约束

### 创建外键

**约定外键（Laravel 风格）：**

```go
table.ForeignId("customer_id").
    Constrained().
    CascadeOnDelete().
    CascadeOnUpdate()
```

`Constrained()` 的默认引用解析：
- 去掉 `_id` 后缀并加 `s`：`customer_id` → `customers`
- 默认引用字段：`id`
- 可显式指定：`Constrained("users", "id")`

**手动外键：**

```go
table.Foreign("tenant_id").
    References("id").
    On("tenants").
    CascadeOnDelete().
    CascadeOnUpdate()
```

**外键动作：**

| 方法 | SQL 动作 |
| --- | --- |
| `OnUpdate(action string)` | 自定义 ON UPDATE |
| `OnDelete(action string)` | 自定义 ON DELETE |
| `CascadeOnUpdate()` | `ON UPDATE CASCADE` |
| `CascadeOnDelete()` | `ON DELETE CASCADE` |
| `RestrictOnUpdate()` | `ON UPDATE RESTRICT` |
| `RestrictOnDelete()` | `ON DELETE RESTRICT` |
| `NullOnUpdate()` | `ON UPDATE SET NULL` |
| `NullOnDelete()` | `ON DELETE SET NULL` |
| `NoActionOnUpdate()` | `ON UPDATE NO ACTION` |
| `NoActionOnDelete()` | `ON DELETE NO ACTION` |

**自定义约束名：**

```go
table.ForeignId("owner_id").
    Constrained("users", "id").
    Name("fk_customers_owner").
    RestrictOnDelete()
```

> 外键 SQL 仅在 MySQL 下生成。SQLite 在 CREATE TABLE 中会跳过外键约束声明。

### 删除外键

```go
table.DropForeign("fk_customers_owner")           // 按名称删除约束
table.DropConstrainedForeignId("customer_id")      // 按约定名称删除约束 + 字段
table.DropForeignIdFor("owner_id")                 // 只删除字段，保留约束
```

**区别：**

- `DropForeign(name)` — 仅删除外键约束。
- `DropConstrainedForeignId(column)` — 按约定名称删除约束并删除字段。
- `DropForeignIdFor(column)` — 仅删除字段。

---

## 元数据检查

Builder 提供只读的数据库元数据检查方法。

### 表 / 视图 / Schema 检查

```go
builder := schema.Bind(db)

hasTable := builder.HasTable("customers")
hasView  := builder.HasView("active_customers")

tables,     err := builder.GetTables(nil)          // []TableInfo
tableNames, err := builder.GetTableListing(nil)     // []string（默认带 schema 前缀）
views,      err := builder.GetViews(nil)            // []ViewInfo
schemas,    err := builder.GetSchemas()             // []SchemaInfo
types,      err := builder.GetTypes(nil)            // []TypeInfo（MySQL/SQLite 为空）
```

- `schemaFilter` 接受 `nil`、`string`（单个 schema）或 `[]string`（多个 schema）。
- `GetTableListing` 接受可选的 `schemaQualified` 变长 bool 参数（默认 `true`）。

### 字段检查

```go
hasColumn  := builder.HasColumn("customers", "phone")
hasColumns := builder.HasColumns("customers", []string{"tenant_id", "phone"})

columns,     err := builder.GetColumns("customers")       // []ColumnInfo
columnNames, err := builder.GetColumnListing("customers") // []string
columnType,  err := builder.GetColumnType("customers", "phone", true) // string
```

`GetColumnType` 接受可选的 `fullDefinition` bool 参数：
- `false`（默认）：返回短类型名（如 `varchar`）
- `true`：返回完整类型定义（如 `varchar(32) unsigned`）

### 索引检查

```go
hasIndex    := builder.HasIndex("customers", "idx_customers_email")
hasIndexCol := builder.HasIndex("customers", []string{"tenant_id", "status"}) // 按字段组合
hasIndexTyp := builder.HasIndex("customers", "idx_customers_email", "unique") // 按类型过滤

indexes,      err := builder.GetIndexes("customers")       // []IndexInfo
indexNames,   err := builder.GetIndexListing("customers")  // []string
```

### 外键检查

```go
foreignKeys, err := builder.GetForeignKeys("customers") // []ForeignKeyInfo
```

### 元数据结构类型

| 类型 | 主要字段 |
| --- | --- |
| `SchemaInfo` | `Name` |
| `TableInfo` | `Name`、`Schema`、`Type` |
| `ViewInfo` | `Name`、`Schema`、`Definition` |
| `TypeInfo` | `Name`、`Schema`、`Type` |
| `ColumnInfo` | `Name`、`Type`、`FullType`、`Nullable`、`Default`、`Comment`、`Primary`、`AutoIncrement`、`Unique`、`Length`、`Precision`、`Scale` |
| `IndexInfo` | `Name`、`Columns`、`Type`、`Unique`、`Primary` |
| `ForeignKeyInfo` | `Name`、`Columns`、`ForeignTable`、`ForeignColumns`、`OnUpdate`、`OnDelete` |

---

## 条件执行

条件辅助方法帮助迁移在不同 Schema 状态的环境中保持幂等。

### 字段条件

```go
builder := schema.Bind(db)

// 仅在字段存在时执行
err := builder.WhenTableHasColumn("customers", "mobile", func() error {
    return builder.Table("customers", func(table *schema.Blueprint) {
        table.RenameColumn("mobile", "phone")
    })
})

// 仅在字段不存在时执行
err = builder.WhenTableDoesntHaveColumn("customers", "email", func() error {
    return builder.Table("customers", func(table *schema.Blueprint) {
        table.String("email", 128).Nullable()
    })
})
```

### 索引条件

```go
// 按索引名
err := builder.WhenTableDoesntHaveIndex("customers", "idx_customers_email", func() error {
    return builder.Table("customers", func(table *schema.Blueprint) {
        table.IndexNamed("idx_customers_email", "email")
    })
})

// 按字段列表（可选类型过滤）
err = builder.WhenTableDoesntHaveIndex("customers", []string{"tenant_id", "phone"}, func() error {
    return builder.Table("customers", func(table *schema.Blueprint) {
        table.UniqueNamed("uix_customers_tenant_phone", "tenant_id", "phone")
    })
}, "unique")
```

---

## 外键约束开关

临时关闭和重新启外键约束检查：

```go
builder := schema.Bind(db)

err := builder.DisableForeignKeyConstraints()
err = builder.EnableForeignKeyConstraints()
```

在禁用外键检查的上下文中执行回调（始终会尝试重新启用）：

```go
err := schema.Bind(db).WithoutForeignKeyConstraints(func() error {
    if err := schema.Bind(db).DropIfExists("legacy_items"); err != nil {
        return err
    }
    return schema.Bind(db).DropIfExists("legacy_orders")
})
```

**Dialect 行为：**

| Dialect | 机制 |
| --- | --- |
| MySQL | `SET FOREIGN_KEY_CHECKS=0/1` |
| SQLite | `PRAGMA foreign_keys = OFF/ON` |
| 其他 | 返回 `schema.ErrUnsupportedFeature` |

`WithoutForeignKeyConstraints` 在回调执行后始终会尝试重新启用约束，即使回调返回错误。回调错误优先返回。

---

## 数据库与扩展管理

```go
created, err := schema.Bind(db).CreateDatabase("archive")       // 仅 MySQL
dropped, err := schema.Bind(db).DropDatabaseIfExists("archive") // 仅 MySQL
err = schema.Bind(db).EnsureExtensionExists("vector")           // MySQL/SQLite 不支持
err = schema.Bind(db).EnsureVectorExtensionExists()             // MySQL/SQLite 不支持
```

**说明：**

- `CreateDatabase` 和 `DropDatabaseIfExists` 仅在 MySQL 下执行；其他方言返回 `ErrUnsupportedFeature`。
- MySQL 和 SQLite 不支持扩展管理，因此 `EnsureExtensionExists` 和 `EnsureVectorExtensionExists` 返回 `ErrUnsupportedFeature`。

---

## SyncModels 过渡能力

`SyncModels(models ...any)` 为遗留的 GORM 模型驱动迁移提供了过渡方案：

```go
err := schema.Bind(db).SyncModels(
    &model.User{},
    &model.Customer{},
)
```

**行为：**

- 模型的表不存在时，通过 GORM migrator 创建表。
- 表已存在时，仅补充模型中新增但数据库缺失的字段。
- 自动应用 MySQL 表选项（`InnoDB`、`utf8mb4`）。
- 应用 Schema 默认配置（`DefaultStringLength`、`DefaultTimePrecision`、`DefaultMorphKeyType`）到模型字段解析。
- 不直接调用 GORM `AutoMigrate`。

**使用建议：**

- 历史总迁移可继续使用 `SyncModels` 承接既有模型。
- 新表、新字段、新索引、新外键优先使用 `Create` / `Table` 显式声明。
- 索引、外键和复杂字段变更不应依赖模型隐式推导。

---

## Dialect 兼容性

| 功能 | MySQL | SQLite |
| --- | --- | --- |
| 创建表 | 支持 | 支持 |
| 添加字段 | 支持 | 支持 |
| 修改字段（`Change()`） | 支持 | 返回 `ErrUnsupportedFeature` |
| 重命名字段 | 支持 | 支持 |
| 删除字段 | 支持 | 支持（有限） |
| 字段注释 | 支持 | 忽略 |
| `First` / `After` 定位 | 支持 | 忽略 |
| 字符集 / 排序规则 | 支持 | 忽略 |
| 不可见列 | 支持 | 忽略 |
| 普通 / 唯一索引 | 支持 | 支持 |
| 全文 / 空间索引 | 支持 | 降级为普通索引 |
| 重命名索引 | 支持 | 跳过 |
| 外键约束 SQL | 支持 | 跳过 |
| 外键约束开关 | 支持 | 支持 |
| 创建 / 删除数据库 | 支持 | 不支持 |
| 扩展管理 | 不支持 | 不支持 |

其他数据库方言会返回 `schema.ErrUnsupportedFeature`，防止生成未经验证的 SQL。

---

## 与 Laravel Schema 的对应关系

| Laravel 概念 | PrismGo 等价 |
| --- | --- |
| `Schema::create($table, $callback)` | `schema.Create(table, fn)` |
| `Schema::table($table, $callback)` | `schema.Table(table, fn)` |
| `Schema::drop($table)` / `dropIfExists` | `schema.Drop` / `schema.DropIfExists` |
| `Schema::rename($from, $to)` | `schema.Rename(from, to)` |
| `Schema::hasTable` / `hasColumn` | `schema.HasTable` / `schema.HasColumn` |
| `Blueprint::id()` | `table.Id()` |
| `Blueprint::string($name, $len)` | `table.String(name, len)` |
| `Blueprint::text()` / `json()` / `boolean()` | `table.Text()` / `table.Json()` / `table.Boolean()` |
| `Blueprint->nullable()` | `.Nullable()` |
| `Blueprint->default($value)` | `.Default(value)` |
| `Blueprint->unique()` | `.Unique()` |
| `Blueprint->index()` | `.Index()` |
| `Blueprint->change()` | `.Change()` |
| `Blueprint->foreignId()->constrained()` | `table.ForeignId(name).Constrained()` |
| `Blueprint->timestamps()` | `table.Timestamps()` |
| `Blueprint->softDeletes()` | `table.SoftDeletes()` |
| `Blueprint->morphs($name)` | `table.Morphs(name)` |
| `Schema::defaultStringLength($len)` | `schema.DefaultStringLength(len)` |
| `Schema::morphUsingUuids()` | `schema.MorphUsingUuids()` |
