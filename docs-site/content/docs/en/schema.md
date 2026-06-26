---
title: "Database: Schema Builder"
---

# Database: Schema Builder

- [Introduction](#introduction)
- [Configuration](#configuration)
  - [Configuration Parameters](#configuration-parameters)
- [Builder Entry Points](#builder-entry-points)
  - [Binding a Migration Connection](#binding-a-migration-connection)
  - [The `New` Constructor](#the-new-constructor)
  - [Specifying a Named Connection](#specifying-a-named-connection)
  - [Package-Level Facade](#package-level-facade)
- [Creating Tables](#creating-tables)
- [Updating Tables](#updating-tables)
  - [Adding Columns](#adding-columns)
  - [Modifying Columns](#modifying-columns)
  - [Renaming Columns](#renaming-columns)
  - [Dropping Columns](#dropping-columns)
  - [Raw SQL Commands](#raw-sql-commands)
- [Renaming and Dropping Tables](#renaming-and-dropping-tables)
  - [Renaming / Dropping](#renaming--dropping)
  - [Destructive Operations](#destructive-operations)
- [Available Column Types](#available-column-types)
  - [Primary Keys & Increments](#primary-keys--increments)
  - [String & Text Types](#string--text-types)
  - [Numeric Types](#numeric-types)
  - [Date & Time Types](#date--time-types)
  - [Boolean, JSON, Binary, Enum & Spatial Types](#boolean-json-binary-enum--spatial-types)
  - [Foreign ID & Morph Types](#foreign-id--morph-types)
  - [Convenience Methods](#convenience-methods)
- [Column Modifiers](#column-modifiers)
- [Modifying Columns](#modifying-columns-1)
- [Dropping Columns](#dropping-columns-1)
  - [Dropping Convention Columns](#dropping-convention-columns)
- [Indexes](#indexes)
  - [Creating Indexes](#creating-indexes)
  - [Renaming Indexes](#renaming-indexes)
  - [Dropping Indexes](#dropping-indexes)
- [Foreign Key Constraints](#foreign-key-constraints)
  - [Creating Foreign Keys](#creating-foreign-keys)
  - [Dropping Foreign Keys](#dropping-foreign-keys)
- [Metadata Inspection](#metadata-inspection)
  - [Table / View / Schema Inspection](#table--view--schema-inspection)
  - [Column Inspection](#column-inspection)
  - [Index Inspection](#index-inspection)
  - [Foreign Key Inspection](#foreign-key-inspection)
  - [Metadata Structure Types](#metadata-structure-types)
- [Conditional Execution](#conditional-execution)
  - [Column Conditionals](#column-conditionals)
  - [Index Conditionals](#index-conditionals)
- [Foreign Key Constraint Toggles](#foreign-key-constraint-toggles)
- [Database & Extension Management](#database--extension-management)
- [SyncModels Transition](#syncmodels-transition)
- [Dialect Compatibility](#dialect-compatibility)
- [Laravel Schema Mapping](#laravel-schema-mapping)

---

## Introduction

PrismGo's `database/schema` package provides a Laravel-style Schema Builder for declaring database table structures in Go migrations. It is built on top of GORM and supports two dialects out of the box:

- **MySQL** — production primary dialect
- **SQLite** — test/development compatibility

Unsupported dialects return `schema.ErrUnsupportedFeature` to prevent generating unverified SQL.

The Schema Builder is ideal for:

- Creating tables with a declarative API
- Altering existing tables (adding, modifying, renaming, dropping columns)
- Managing indexes and foreign key constraints
- Inspecting database metadata (tables, columns, indexes, views, schemas, foreign keys)

> New migrations should prefer `schema.Create` / `schema.Table` over model-driven approaches. The `SyncModels` method exists only for transitioning legacy GORM model-based migrations.

---

## Configuration

The Schema Builder does not require its own configuration file. Global defaults that affect column type behaviour are set programmatically via package-level functions in your `AppServiceProvider` or bootstrap:

### Configuration Parameters

| Function | Default | Description |
| --- | --- | --- |
| `schema.DefaultStringLength(length)` | `255` | Default length for `String` / `Char` columns when no explicit length is given. Set to `191` for MySQL < 5.7 or InnoDB large prefix compatibility. |
| `schema.DefaultTimePrecision(precision)` | `nil` (no precision) | Default fractional seconds precision for `DateTime`, `Time`, and `Timestamp` columns. Pass `nil` or a negative value to disable. |
| `schema.DefaultMorphKeyType(kind)` | `"int"` | Data type for morph ID columns (`{name}_id`). Accepts `"int"`, `"uuid"`, or `"ulid"`. |
| `schema.MorphUsingUuids()` | — | Shortcut for `DefaultMorphKeyType("uuid")`. Morph ID columns become `char(36)`. |
| `schema.MorphUsingUlids()` | — | Shortcut for `DefaultMorphKeyType("ulid")`. Morph ID columns become `char(26)`. |

**Usage example** in your application service provider:

```go
import "github.com/prismgo/framework/database/schema"

func Boot() {
    schema.DefaultStringLength(191)

    precision := 3
    schema.DefaultTimePrecision(&precision)

    schema.MorphUsingUuids()
}
```

These defaults affect:

- `String` / `Char` columns without an explicit length
- `DateTime` / `Time` / `Timestamp` columns without an explicit precision
- `Morphs` / `NullableMorphs` ID column types
- `SyncModels` when parsing model struct fields

Explicit `gorm` tags (`size`, `type`, `precision`) on model fields are never overridden.

---

## Builder Entry Points

The `Builder` is the central object that executes schema operations. There are four ways to obtain one:

### Binding a Migration Connection

Migration functions receive a `*gorm.DB` from the migrator. Use `Bind(db)` to attach the Schema Builder to that specific connection or transaction:

```go
func up(db *gorm.DB) error {
    builder := schema.Bind(db)

    if err := builder.Create("customers", func(table *schema.Blueprint) {
        table.Id()
        table.String("name", 100).Comment("Customer name")
    }); err != nil {
        return err
    }

    return builder.Table("customers", func(table *schema.Blueprint) {
        table.String("phone", 32).Nullable().Comment("Phone number")
    })
}
```

`Bind` returns the same `Builder` instance for chaining. In migrations, always prefer `Bind(db)` to prevent accidentally using the unbound default connection.

### The `New` Constructor

Create a standalone `Builder` bound to a specific `*gorm.DB`:

```go
builder := schema.New(db)

err := builder.Create("demo_tables", func(table *schema.Blueprint) {
    table.Id()
    table.String("code", 32).Unique()
})
```

### Specifying a Named Connection

Use a connection defined in `config/database.go` under `database.connections.{name}`:

```go
err := schema.Connection("mysql").Create("external_logs", func(table *schema.Blueprint) {
    table.Id()
    table.Text("message")
    table.Timestamps()
})
```

If the connection fails to open, the error is stored in the `Builder` and returned when a schema operation is executed.

### Package-Level Facade

All builder methods are exposed as package-level functions that delegate to the default builder resolved from the application container:

```go
err := schema.Create("demo_tables", func(table *schema.Blueprint) {
    table.Id()
})

exists := schema.HasTable("demo_tables")
```

This is convenient for standalone scripts and tests, but migrations should still use `schema.Bind(db)` to stay within the migration transaction.

---

## Creating Tables

`Create(table, fn)` creates a new table. If the table already exists, it is skipped (idempotent):

```go
err := schema.Bind(db).Create("customers", func(table *schema.Blueprint) {
    table.Id()
    table.UnsignedBigInteger("tenant_id").Comment("Tenant ID")
    table.String("name", 100).Comment("Customer name")
    table.String("phone", 32).Nullable().Comment("Phone number")
    table.TinyInteger("status").Default(1).Comment("Status: 1=active 2=disabled")
    table.Decimal("balance", 12, 2).Default(0).Comment("Account balance")
    table.Json("profile").Nullable().Comment("Extended profile")
    table.Timestamps()
    table.SoftDeletes()

    table.IndexNamed("idx_customers_tenant_status", "tenant_id", "status")
    table.UniqueNamed("uix_customers_tenant_phone", "tenant_id", "phone")
})
```

**Notes:**

- At least one column is required, or the builder returns an error.
- MySQL automatically appends `database.TableOptions` (`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).
- SQLite ignores MySQL-specific syntax (comments, character sets, foreign key constraints).

---

## Updating Tables

`Table(table, fn)` modifies an existing table. It supports adding columns, modifying columns, renaming columns, dropping columns, and managing indexes and foreign keys.

### Adding Columns

New columns are skipped if they already exist (idempotent):

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.String("email", 128).Nullable().After("phone").Comment("Email")
    table.Timestamp("email_verified_at").Nullable().Comment("Email verified at")
    table.IndexNamed("idx_customers_email", "email")
})
```

### Modifying Columns

Use `Change()` to modify an existing column's type, nullable state, or default value:

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.String("phone", 64).Nullable().Comment("Phone number").Change()
})
```

`Change()` compiles to `ALTER TABLE ... MODIFY COLUMN` on MySQL. SQLite does not support safe column modification and returns `schema.ErrUnsupportedFeature`.

### Renaming Columns

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.RenameColumn("mobile", "phone")
})
```

The operation is skipped if the source column does not exist or the target column already exists.

### Dropping Columns

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.DropColumn("legacy_code", "legacy_level")
    table.DropColumns([]string{"old_name", "old_phone"})
})
```

Non-existent columns are silently ignored.

### Raw SQL Commands

For one-off structural fixes that cannot be expressed through the DSL:

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.Raw("ALTER TABLE `customers` ADD COLUMN `search_name` varchar(255) GENERATED ALWAYS AS (`name`) STORED")
})
```

Regular column, index, and foreign key operations should use Blueprint methods for testability and dialect compatibility.

---

## Renaming and Dropping Tables

### Renaming / Dropping

Idempotent table-level operations:

```go
builder := schema.Bind(db)

// Rename: skips if source is missing or target already exists
err := builder.Rename("old_customers", "customers")

// Drop: skips if table does not exist
err = builder.Drop("temp_customers")
err = builder.DropIfExists("temp_customers")

// Drop specified columns from a table
err = builder.DropColumns("customers", "legacy_code", "legacy_level")
```

### Destructive Operations

Use with extreme caution — these are intended for test databases and explicit cleanup commands only:

```go
err := schema.Bind(db).DropAllTables()
err = schema.Bind(db).DropAllViews()
err = schema.Bind(db).DropAllTypes()
```

`DropAllTables` temporarily disables foreign key checks before dropping.

---

## Available Column Types

### Primary Keys & Increments

| Method | MySQL Type | Description |
| --- | --- | --- |
| `Id(name ...string)` | `bigint unsigned auto_increment primary key` | Default primary key; falls back to `"id"` if no name given |
| `Increments(name)` | `int unsigned auto_increment primary key` | Auto-incrementing int primary key |
| `BigIncrements(name)` | `bigint unsigned auto_increment primary key` | Auto-incrementing bigint primary key |
| `TinyIncrements(name)` | `tinyint unsigned auto_increment primary key` | Auto-incrementing tinyint primary key |
| `SmallIncrements(name)` | `smallint unsigned auto_increment primary key` | Auto-incrementing smallint primary key |
| `MediumIncrements(name)` | `mediumint unsigned auto_increment primary key` | Auto-incrementing mediumint primary key |
| `Integer(name)` | `int` | Signed integer |
| `BigInteger(name)` | `bigint` | Signed big integer |
| `MediumInteger(name)` | `mediumint` | Signed medium integer |
| `SmallInteger(name)` | `smallint` | Signed small integer |
| `TinyInteger(name)` | `tinyint` | Signed tiny integer |
| `UnsignedInteger(name)` | `int unsigned` | Unsigned integer |
| `UnsignedBigInteger(name)` | `bigint unsigned` | Unsigned big integer |
| `UnsignedMediumInteger(name)` | `mediumint unsigned` | Unsigned medium integer |
| `UnsignedSmallInteger(name)` | `smallint unsigned` | Unsigned small integer |
| `UnsignedTinyInteger(name)` | `tinyint unsigned` | Unsigned tiny integer |

```go
table.Id()
table.UnsignedBigInteger("tenant_id").Comment("Tenant ID")
table.TinyInteger("status").Default(1).Comment("Status: 1=active 2=disabled")
```

### String & Text Types

| Method | MySQL Type | Description |
| --- | --- | --- |
| `String(name, length ...int)` | `varchar(length)` | Variable-length string; defaults to `DefaultStringLength` (255) |
| `Char(name, length ...int)` | `char(length)` | Fixed-length string |
| `Text(name)` | `text` | Long text |
| `TinyText(name)` | `tinytext` | Tiny text |
| `MediumText(name)` | `mediumtext` | Medium text |
| `LongText(name)` | `longtext` | Long text |
| `Uuid(name)` | `char(36)` | UUID |
| `Ulid(name)` | `char(26)` | ULID |
| `IpAddress(name)` | `varchar(45)` | IP address (supports both IPv4 and IPv6) |
| `MacAddress(name)` | `varchar(17)` | MAC address |
| `RememberToken()` | `varchar(100) null` | Laravel-style `remember_token` field |

```go
table.String("name", 100).Comment("Name")
table.Text("description").Nullable().Comment("Description")
table.Uuid("uuid").Unique()
table.RememberToken()
```

### Numeric Types

| Method | MySQL Type | Description |
| --- | --- | --- |
| `Boolean(name)` | `tinyint(1)` | Boolean value |
| `Float(name, totalAndPlaces ...int)` | `float(total, places)` | Floating-point number; defaults to (8,2) |
| `Double(name, totalAndPlaces ...int)` | `double(total, places)` | Double-precision float; defaults to (8,2) |
| `Decimal(name, totalAndPlaces ...int)` | `decimal(total, places)` | Exact decimal; defaults to (8,2) |
| `UnsignedDecimal(name, totalAndPlaces ...int)` | `decimal(total, places) unsigned` | Unsigned exact decimal |

> Do not use `Float` / `Double` for monetary values. Always use `Decimal` or store amounts as the smallest currency unit (integer).

```go
table.Boolean("is_enabled").Default(true).Comment("Is enabled")
table.Decimal("amount", 12, 2).Default(0).Comment("Amount")
```

### Date & Time Types

| Method | MySQL Type | Description |
| --- | --- | --- |
| `Date(name)` | `date` | Date value |
| `DateTime(name)` | `datetime` | Date and time |
| `DateTimeTz(name)` | `datetime` | Date and time (timezone-aware alias, same SQL) |
| `Time(name)` | `time` | Time value |
| `TimeTz(name)` | `time` | Time (timezone-aware alias, same SQL) |
| `Timestamp(name)` | `timestamp` | Timestamp |
| `TimestampTz(name)` | `timestamp` | Timestamp (timezone-aware alias, same SQL) |
| `Year(name)` | `year` | Year value |
| `Timestamps()` | `created_at`, `updated_at` nullable timestamp | Two nullable timestamp fields |
| `TimestampsTz()` | Same as `Timestamps()` | Alias (same SQL) |
| `SoftDeletes()` | `deleted_at` nullable timestamp + index | Soft delete field with default index |
| `SoftDeletesTz()` | Same as `SoftDeletes()` | Alias (same SQL) |

```go
table.Timestamp("published_at").Nullable()
table.Timestamp("created_at").UseCurrent()
table.Timestamp("updated_at").UseCurrent().UseCurrentOnUpdate()
table.Timestamps()
table.SoftDeletes()
```

### Boolean, JSON, Binary, Enum & Spatial Types

| Method | MySQL Type | Description |
| --- | --- | --- |
| `Binary(name)` | `blob` | Binary data |
| `Json(name)` | `json` | JSON data |
| `Jsonb(name)` | `json` | JSONB alias; compiles to `json` on MySQL/SQLite |
| `Enum(name, allowed)` | `enum(...)` | Enumeration |
| `Set(name, allowed)` | `set(...)` | MySQL set type |
| `Geometry(name)` | `geometry` | Spatial geometry |
| `Geography(name)` | `geography` | Spatial geography |
| `Point(name)` | `point` | Spatial point |
| `LineString(name)` | `linestring` | Spatial linestring |
| `Polygon(name)` | `polygon` | Spatial polygon |
| `Vector(name, dimensions)` | `vector(dimensions)` | Vector field (e.g., for embeddings) |

SQLite downgrades most MySQL-specific types to compatible equivalents during testing.

```go
table.Json("payload").Nullable()
table.Enum("source", []string{"manual", "import"}).Default("manual")
table.Vector("embedding", 1536).Nullable()
```

### Foreign ID & Morph Types

```go
table.ForeignId("customer_id")                              // bigint unsigned
table.ForeignIdFor("owner_id")                              // bigint unsigned
table.Morphs("owner")                                       // {name}_id bigint unsigned, {name}_type varchar(255), joint index
table.NullableMorphs("source")                              // Same as Morphs but nullable
```

**Behaviour:**

- `ForeignId(name)` creates a `bigint unsigned` column.
- `ForeignIdFor(name)` is a direct alias; pass the final column name.
- `Morphs(name)` creates `{name}_id`, `{name}_type`, and a composite index.
- `NullableMorphs(name)` is the same but both columns allow `NULL`.
- The `{name}_id` type is controlled by `DefaultMorphKeyType` (`int`, `uuid`, or `ulid`).

### Convenience Methods

| Method | Description |
| --- | --- |
| `NullableTimestamps()` | Alias for `Timestamps()` |
| `NullableMorphs(name)` | Nullable variant of `Morphs` |

---

## Column Modifiers

Each column method returns a `*ColumnDefinition`, enabling chainable modifiers:

```go
table.String("name", 100).
    Nullable().
    Default("unknown").
    Comment("Name").
    After("tenant_id").
    Index()
```

| Modifier | Description |
| --- | --- |
| `Nullable()` | Allow `NULL` values |
| `NotNull()` | Disallow `NULL` values (default for non-primary columns) |
| `Unsigned()` | Mark numeric column as unsigned |
| `AutoIncrement()` | Set auto-increment |
| `Primary()` | Set as primary key |
| `Unique(enabled ...bool)` | Add a unique index on the column; pass `false` to drop by default name |
| `Index(enabled ...bool)` | Add a regular index on the column; pass `false` to drop by default name |
| `Default(value any)` | Set a default value |
| `Comment(value string)` | Set column comment (MySQL only) |
| `First()` | Place column first in table (MySQL only) |
| `After(column string)` | Place column after another (MySQL only) |
| `Charset(value string)` | Set character set (MySQL string columns only) |
| `Collation(value string)` | Set collation (MySQL string columns only) |
| `UseCurrent()` | Set default to `CURRENT_TIMESTAMP` |
| `UseCurrentOnUpdate()` | Set `ON UPDATE CURRENT_TIMESTAMP` |
| `Invisible()` | Make column invisible (MySQL only) |
| `Change()` | Mark as modification of existing column (MySQL `MODIFY COLUMN`; SQLite returns error) |
| `StoredAs(expr string)` | Declare stored generated column (API placeholder, not compiled) |
| `VirtualAs(expr string)` | Declare virtual generated column (API placeholder, not compiled) |
| `From(value int)` | Laravel compatibility placeholder; no effect |
| `Instant()` | Laravel compatibility placeholder; no effect |
| `Lock(value string)` | Laravel compatibility placeholder; no effect |

**Default value SQL literals:**

```go
table.String("name").Default("guest")        // DEFAULT 'guest'
table.Boolean("is_enabled").Default(true)    // DEFAULT 1
table.Integer("sort").Default(0)             // DEFAULT 0
table.Timestamp("created_at").Default("CURRENT_TIMESTAMP")
table.Json("payload").Default("NULL")
```

`CURRENT_TIMESTAMP`, `NULL`, and parenthesised expressions are preserved as-is.

---

## Modifying Columns

Use the `Change()` modifier to update an existing column's type, nullable state, or default value:

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.String("phone", 64).Nullable().Comment("Phone number").Change()
})
```

**Behaviour:**

- **MySQL**: Compiles to `ALTER TABLE ... MODIFY COLUMN`.
- **SQLite**: Returns `schema.ErrUnsupportedFeature` — SQLite cannot safely modify column types, nullability, or defaults without table rebuild.
- **Idempotent**: The `Change()` modifier does not check whether the column already matches the desired definition. Callers must ensure the operation is meaningful.

---

## Dropping Columns

```go
err := schema.Bind(db).Table("customers", func(table *schema.Blueprint) {
    table.DropColumn("legacy_code")
    table.DropColumns([]string{"old_name", "old_phone"})
})
```

Non-existent columns are silently ignored.

### Dropping Convention Columns

```go
table.DropRememberToken()                     // Drops remember_token
table.DropTimestamps()                        // Drops created_at, updated_at
table.DropTimestampsTz()                      // Same as DropTimestamps
table.DropSoftDeletes()                       // Drops deleted_at + default index
table.DropSoftDeletesTz()                     // Same as DropSoftDeletes
table.DropMorphs("owner")                     // Drops owner_id, owner_type + default index
table.DropConstrainedForeignId("customer_id") // Drops foreign key constraint + column
table.DropForeignIdFor("owner_id")            // Drops column only, keeps constraint
```

---

## Indexes

### Creating Indexes

```go
table.Primary("id")
table.Unique("tenant_id", "code")
table.Index("tenant_id", "status")
table.FullText("title", "content")
table.SpatialIndex("location")

// Custom index names
table.UniqueNamed("uix_customers_tenant_phone", "tenant_id", "phone")
table.IndexNamed("idx_customers_tenant_status", "tenant_id", "status")
```

**Column-level indexes:**

```go
table.String("email", 128).Unique()
table.String("phone", 32).Index()
```

**Default index naming convention** (Laravel-style):

```text
{table}_{column1}_{column2}_{kind}
```

Examples:
- `customers_email_unique`
- `customers_tenant_id_status_index`

For composite indexes or business-critical indexes, use explicit naming to guarantee stable names for rollbacks:
- Prefix: `idx_` (plain), `uix_` (unique), `ftx_` (fulltext), `spx_` (spatial)
- Names exceeding 64 characters are auto-trimmed with a SHA1 hash suffix for MySQL compatibility.

### Renaming Indexes

```go
table.RenameIndex("idx_old_name", "idx_new_name")
```

- **MySQL**: Compiles to `ALTER TABLE ... RENAME INDEX ...`.
- **SQLite**: Skipped (SQLite's native rename index support is limited).

### Dropping Indexes

```go
table.DropIndex("idx_customers_email")
table.DropUnique("uix_customers_tenant_phone")
table.DropPrimary()
table.DropFullText("ftx_articles_title")
table.DropSpatialIndex("spx_locations_point")
```

The `Index(true/false)` and `Unique(true/false)` column-level modifiers can also remove indexes:

```go
// Removes the unique index on "phone" by default name
table.String("phone", 32).Unique(false).Change()
```

---

## Foreign Key Constraints

### Creating Foreign Keys

**Constrained foreign ID (Laravel-style):**

```go
table.ForeignId("customer_id").
    Constrained().
    CascadeOnDelete().
    CascadeOnUpdate()
```

`Constrained()` resolves the referenced table and column:
- Strips `_id` suffix and pluralises: `customer_id` → `customers`
- Default referenced column: `id`
- Explicit override: `Constrained("users", "id")`

**Manual foreign key:**

```go
table.Foreign("tenant_id").
    References("id").
    On("tenants").
    CascadeOnDelete().
    CascadeOnUpdate()
```

**Foreign key actions:**

| Method | SQL Action |
| --- | --- |
| `OnUpdate(action string)` | Custom ON UPDATE action |
| `OnDelete(action string)` | Custom ON DELETE action |
| `CascadeOnUpdate()` | `ON UPDATE CASCADE` |
| `CascadeOnDelete()` | `ON DELETE CASCADE` |
| `RestrictOnUpdate()` | `ON UPDATE RESTRICT` |
| `RestrictOnDelete()` | `ON DELETE RESTRICT` |
| `NullOnUpdate()` | `ON UPDATE SET NULL` |
| `NullOnDelete()` | `ON DELETE SET NULL` |
| `NoActionOnUpdate()` | `ON UPDATE NO ACTION` |
| `NoActionOnDelete()` | `ON DELETE NO ACTION` |

**Custom constraint name:**

```go
table.ForeignId("owner_id").
    Constrained("users", "id").
    Name("fk_customers_owner").
    RestrictOnDelete()
```

> Foreign key SQL is only generated for MySQL. SQLite skips foreign key constraint statements in CREATE TABLE.

### Dropping Foreign Keys

```go
table.DropForeign("fk_customers_owner")           // Drop constraint by name
table.DropConstrainedForeignId("customer_id")      // Drop constraint by convention name + column
table.DropForeignIdFor("owner_id")                 // Drop column only, keep constraint
```

**Differences:**

- `DropForeign(name)` — removes only the foreign key constraint.
- `DropConstrainedForeignId(column)` — removes the constraint (by convention name) and the column.
- `DropForeignIdFor(column)` — removes only the column.

---

## Metadata Inspection

The Builder provides read-only inspection methods for database metadata.

### Table / View / Schema Inspection

```go
builder := schema.Bind(db)

hasTable := builder.HasTable("customers")
hasView  := builder.HasView("active_customers")

tables,     err := builder.GetTables(nil)          // []TableInfo
tableNames, err := builder.GetTableListing(nil)     // []string (schema-qualified by default)
views,      err := builder.GetViews(nil)            // []ViewInfo
schemas,    err := builder.GetSchemas()             // []SchemaInfo
types,      err := builder.GetTypes(nil)            // []TypeInfo (empty on MySQL/SQLite)
```

- `schemaFilter` accepts `nil`, a `string` (single schema), or `[]string` (multiple schemas).
- `GetTableListing` takes an optional `schemaQualified` variadic boolean (defaults to `true`).

### Column Inspection

```go
hasColumn  := builder.HasColumn("customers", "phone")
hasColumns := builder.HasColumns("customers", []string{"tenant_id", "phone"})

columns,     err := builder.GetColumns("customers")       // []ColumnInfo
columnNames, err := builder.GetColumnListing("customers") // []string
columnType,  err := builder.GetColumnType("customers", "phone", true) // string
```

`GetColumnType` accepts an optional `fullDefinition` boolean:
- `false` (default): returns the short type name (e.g., `varchar`)
- `true`: returns the full type definition (e.g., `varchar(32) unsigned`)

### Index Inspection

```go
hasIndex    := builder.HasIndex("customers", "idx_customers_email")
hasIndexCol := builder.HasIndex("customers", []string{"tenant_id", "status"}) // by columns
hasIndexTyp := builder.HasIndex("customers", "idx_customers_email", "unique") // by type filter

indexes,      err := builder.GetIndexes("customers")       // []IndexInfo
indexNames,   err := builder.GetIndexListing("customers")  // []string
```

### Foreign Key Inspection

```go
foreignKeys, err := builder.GetForeignKeys("customers") // []ForeignKeyInfo
```

### Metadata Structure Types

| Type | Key Fields |
| --- | --- |
| `SchemaInfo` | `Name` |
| `TableInfo` | `Name`, `Schema`, `Type` |
| `ViewInfo` | `Name`, `Schema`, `Definition` |
| `TypeInfo` | `Name`, `Schema`, `Type` |
| `ColumnInfo` | `Name`, `Type`, `FullType`, `Nullable`, `Default`, `Comment`, `Primary`, `AutoIncrement`, `Unique`, `Length`, `Precision`, `Scale` |
| `IndexInfo` | `Name`, `Columns`, `Type`, `Unique`, `Primary` |
| `ForeignKeyInfo` | `Name`, `Columns`, `ForeignTable`, `ForeignColumns`, `OnUpdate`, `OnDelete` |

---

## Conditional Execution

Conditional helpers keep migrations idempotent across environments with different schema states.

### Column Conditionals

```go
builder := schema.Bind(db)

// Execute only if the column exists
err := builder.WhenTableHasColumn("customers", "mobile", func() error {
    return builder.Table("customers", func(table *schema.Blueprint) {
        table.RenameColumn("mobile", "phone")
    })
})

// Execute only if the column is missing
err = builder.WhenTableDoesntHaveColumn("customers", "email", func() error {
    return builder.Table("customers", func(table *schema.Blueprint) {
        table.String("email", 128).Nullable()
    })
})
```

### Index Conditionals

```go
// By index name
err := builder.WhenTableDoesntHaveIndex("customers", "idx_customers_email", func() error {
    return builder.Table("customers", func(table *schema.Blueprint) {
        table.IndexNamed("idx_customers_email", "email")
    })
})

// By column list (with optional type filter)
err = builder.WhenTableDoesntHaveIndex("customers", []string{"tenant_id", "phone"}, func() error {
    return builder.Table("customers", func(table *schema.Blueprint) {
        table.UniqueNamed("uix_customers_tenant_phone", "tenant_id", "phone")
    })
}, "unique")
```

---

## Foreign Key Constraint Toggles

Temporarily disable and re-enable foreign key constraint checks:

```go
builder := schema.Bind(db)

err := builder.DisableForeignKeyConstraints()
err = builder.EnableForeignKeyConstraints()
```

Execute a callback with foreign key checks disabled (always attempts re-enable):

```go
err := schema.Bind(db).WithoutForeignKeyConstraints(func() error {
    if err := schema.Bind(db).DropIfExists("legacy_items"); err != nil {
        return err
    }
    return schema.Bind(db).DropIfExists("legacy_orders")
})
```

**Dialect behaviour:**

| Dialect | Mechanism |
| --- | --- |
| MySQL | `SET FOREIGN_KEY_CHECKS=0/1` |
| SQLite | `PRAGMA foreign_keys = OFF/ON` |
| Other | Returns `schema.ErrUnsupportedFeature` |

`WithoutForeignKeyConstraints` always attempts to re-enable constraints after the callback, even if the callback returns an error. The callback error takes precedence.

---

## Database & Extension Management

```go
created, err := schema.Bind(db).CreateDatabase("archive")       // MySQL only
dropped, err := schema.Bind(db).DropDatabaseIfExists("archive") // MySQL only
err = schema.Bind(db).EnsureExtensionExists("vector")           // Unsupported on MySQL/SQLite
err = schema.Bind(db).EnsureVectorExtensionExists()             // Unsupported on MySQL/SQLite
```

**Notes:**

- `CreateDatabase` and `DropDatabaseIfExists` execute only on MySQL; other dialects return `ErrUnsupportedFeature`.
- MySQL and SQLite do not support extension management, so `EnsureExtensionExists` and `EnsureVectorExtensionExists` return `ErrUnsupportedFeature`.

---

## SyncModels Transition

`SyncModels(models ...any)` provides a migration path for legacy GORM model-driven migrations:

```go
err := schema.Bind(db).SyncModels(
    &model.User{},
    &model.Customer{},
)
```

**Behaviour:**

- If the model's table does not exist, it is created via the GORM migrator.
- If the table exists, only columns present in the model struct but missing from the database are added.
- MySQL table options (`InnoDB`, `utf8mb4`) are automatically applied.
- Schema defaults (`DefaultStringLength`, `DefaultTimePrecision`, `DefaultMorphKeyType`) are applied to model field parsing.
- Does not call GORM `AutoMigrate` directly.

**Recommendations:**

- Existing total migrations can continue using `SyncModels` for legacy models.
- New tables, columns, indexes, and foreign keys should use `Create` / `Table` explicitly.
- Indexes, foreign keys, and complex column changes should not rely on model inference.

---

## Dialect Compatibility

| Feature | MySQL | SQLite |
| --- | --- | --- |
| Create table | Supported | Supported |
| Add column | Supported | Supported |
| Modify column (`Change()`) | Supported | Returns `ErrUnsupportedFeature` |
| Rename column | Supported | Supported |
| Drop column | Supported | Supported (limited) |
| Column comments | Supported | Ignored |
| `First` / `After` positioning | Supported | Ignored |
| Charset / Collation | Supported | Ignored |
| Invisible column | Supported | Ignored |
| Plain / Unique indexes | Supported | Supported |
| Fulltext / Spatial indexes | Supported | Downgraded to plain index |
| Rename index | Supported | Skipped |
| Foreign key constraints SQL | Supported | Skipped |
| Foreign key constraint toggles | Supported | Supported |
| Create / Drop database | Supported | Unsupported |
| Extension management | Unsupported | Unsupported |

Other database dialects return `schema.ErrUnsupportedFeature` to prevent generating untested SQL.

---

## Laravel Schema Mapping

| Laravel Concept | PrismGo Equivalent |
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