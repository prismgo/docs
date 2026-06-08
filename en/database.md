# Database

- [Introduction](#introduction)
- [Configuration](#configuration)
  - [Config File](#config-file)
  - [Driver Prerequisites](#driver-prerequisites)
  - [Configuration Parameters](#configuration-parameters)
  - [Connecting via DSN](#connecting-via-dsn)
- [Obtaining a Database Connection](#obtaining-a-database-connection)
  - [Using the Facade](#using-the-facade)
  - [Manually Opening a Connection](#manually-opening-a-connection)
  - [Connection Pool Management](#connection-pool-management)
- [Models](#models)
- [Migrations](#migrations)
  - [Registering Migrations](#registering-migrations)
  - [Registering Seeders](#registering-seeders)
  - [Default Seeder](#default-seeder)
- [Migrator Utilities](#migrator-utilities)
  - [Table Options](#table-options)
  - [Engine Management](#engine-management)
  - [Composite Indexes](#composite-indexes)
  - [Composite Unique Indexes](#composite-unique-indexes)
  - [Dropping Obsolete Indexes](#dropping-obsolete-indexes)
  - [Index Existence Check](#index-existence-check)
  - [Primary Key Column Query](#primary-key-column-query)
- [Service Provider](#service-provider)
- [Resource Lifecycle](#resource-lifecycle)
- [Laravel Database Mapping](#laravel-database-mapping)

---

PrismGo's database component provides database connection management, migration registration, and index maintenance capabilities built on top of GORM. It currently ships with built-in MySQL driver support, follows a Laravel-style configuration structure, and implements lazy connection creation and automatic cleanup through the ServiceProvider.

---

## Introduction

The database component is built around the following core capabilities:

- **Connection Management**: Create GORM database connections via `OpenDefaultConnection` / `OpenConnection` based on configuration, with automatic connection pool parameter application.
- **Facade Resolution**: `database.Resolve()` retrieves the default `*gorm.DB` instance from the application container, so business code doesn't need to worry about connection construction details.
- **Migration Registration**: `RegisterMigration` / `RegisterSeeder` declare migration and seeder functions during the `init` phase; commands look them up by name at runtime.
- **Migrator Utilities**: Provides idempotent index maintenance tools such as `EnsureInnoDB`, `EnsureCompositeIndexes`, `EnsureCompositeUniqueIndexes`, and `DropObsoleteIndexes` to compensate for GORM AutoMigrate's limitations with composite indexes and engine switching.

## Configuration

### Config File

Database configuration is registered in `config/database.go`, structurally aligned with Laravel's `config/database.php`. You can override any parameter via environment variables:

```go
// config/database.go
func init() {
    config.Add("database", func() map[string]interface{} {
        return map[string]interface{}{
            "default": config.Env("DATABASE_CONNECTION", "mysql"),
            "connections": map[string]interface{}{
                "mysql": map[string]interface{}{
                    "driver":             config.Env("DATABASE_DRIVER", "mysql"),
                    "host":               config.Env("DATABASE_HOST", "127.0.0.1"),
                    "port":               config.Env("DATABASE_PORT", 3306),
                    "database":           config.Env("DATABASE_NAME", "workorder"),
                    "username":           config.Env("DATABASE_USER", "root"),
                    "password":           config.Env("DATABASE_PASSWORD", "root"),
                    "charset":            config.Env("DATABASE_CHARSET", "utf8mb4"),
                    "parse_time":         config.Env("DATABASE_PARSE_TIME", true),
                    "loc":                config.Env("DATABASE_LOC", "Local"),
                    "dsn":                config.Env("DATABASE_DSN", ""),
                    "max_open_conns":     config.Env("DATABASE_MAX_OPEN_CONNS", 30),
                    "max_idle_conns":     config.Env("DATABASE_MAX_IDLE_CONNS", 10),
                    "conn_max_lifetime":  config.Env("DATABASE_CONN_MAX_LIFETIME", "1h"),
                    "conn_max_idle_time": config.Env("DATABASE_CONN_MAX_IDLE_TIME", "10m"),
                },
            },
        }
    })
}
```

### Driver Prerequisites

#### MySQL

The only built-in database driver at this time. It uses `go-sql-driver/mysql` and `gorm.io/driver/mysql` under the hood. No additional configuration is needed as long as the MySQL server is reachable and the credentials are correct.

> To add support for SQLite, PostgreSQL, or other drivers, add a same-name DSN constructor and a new branch in the `Open` function.

### Configuration Parameters

#### Top-Level Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `database.default` | `DATABASE_CONNECTION` | `"mysql"` | Default database connection name, corresponding to a key under `connections` |

#### MySQL Connection Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `database.connections.mysql.driver` | `DATABASE_DRIVER` | `"mysql"` | Database driver type; currently only `"mysql"` is supported |
| `database.connections.mysql.host` | `DATABASE_HOST` | `"127.0.0.1"` | Database host address |
| `database.connections.mysql.port` | `DATABASE_PORT` | `3306` | Database port number |
| `database.connections.mysql.database` | `DATABASE_NAME` | `"workorder"` | Database name |
| `database.connections.mysql.username` | `DATABASE_USER` | `"root"` | Database username |
| `database.connections.mysql.password` | `DATABASE_PASSWORD` | `"root"` | Database password |
| `database.connections.mysql.charset` | `DATABASE_CHARSET` | `"utf8mb4"` | Character set, appended as the `charset` parameter in the DSN |
| `database.connections.mysql.parse_time` | `DATABASE_PARSE_TIME` | `true` | Whether to automatically scan `DATE`/`DATETIME` as `time.Time` |
| `database.connections.mysql.loc` | `DATABASE_LOC` | `"Local"` | Timezone, appended as the `loc` parameter in the DSN |
| `database.connections.mysql.dsn` | `DATABASE_DSN` | `""` | Full DSN connection string. When non-empty, it takes priority and other fields are ignored |
| `database.connections.mysql.max_open_conns` | `DATABASE_MAX_OPEN_CONNS` | `30` | Maximum number of open connections |
| `database.connections.mysql.max_idle_conns` | `DATABASE_MAX_IDLE_CONNS` | `10` | Maximum number of idle connections |
| `database.connections.mysql.conn_max_lifetime` | `DATABASE_CONN_MAX_LIFETIME` | `"1h"` | Maximum connection lifetime; supports duration text (e.g., `"1h"`, `"30m"`) or seconds as a string (e.g., `"3600"`) |
| `database.connections.mysql.conn_max_idle_time` | `DATABASE_CONN_MAX_IDLE_TIME` | `"10m"` | Maximum connection idle time; same format as above |

### Connecting via DSN

Similar to Laravel's `DB_URL` support, PrismGo allows you to provide a complete MySQL connection string directly via the `dsn` field. When `dsn` is non-empty, the `host`, `port`, `username`, `password`, `database`, `charset`, `parse_time`, and `loc` fields are ignored:

```env
DATABASE_DSN=root:secret@tcp(127.0.0.1:3306)/workorder?charset=utf8mb4&parseTime=true&loc=Local
```

> When using managed database services (e.g., AWS RDS, Alibaba Cloud RDS), you typically only need to configure a single DSN.

## Obtaining a Database Connection

### Using the Facade

The most common approach in business code — retrieve the default `*gorm.DB` instance from the application container:

```go
import "github.com/prismgo/framework/database"

db := database.Resolve()
```

The `*gorm.DB` returned by `Resolve()` is a singleton. The first call triggers the lazy factory registered by the ServiceProvider to create the connection; subsequent calls reuse the same instance.

### Manually Opening a Connection

In standalone programs or tests, you can bypass the container and create a connection directly:

```go
// Open the default connection (reads config/database configuration)
db, err := database.OpenDefaultConnection()
if err != nil {
    return err
}

// Open a named connection
db, err := database.OpenConnection("mysql")
if err != nil {
    return err
}
```

You can also use the low-level `Open` function to specify the driver and DSN directly:

```go
db, err := database.Open("mysql", "root:secret@tcp(127.0.0.1:3306)/app?charset=utf8mb4&parseTime=true&loc=Local")
if err != nil {
    return err
}
```

> `Open` currently only supports the `"mysql"` driver. Passing any other driver name returns an error immediately.

### Connection Pool Management

`OpenConnection` automatically reads connection pool parameters from configuration and applies them. To adjust them manually, you can operate on the underlying `*sql.DB` directly:

```go
sqlDB, err := db.DB()
if err != nil {
    return err
}
sqlDB.SetMaxOpenConns(50)
sqlDB.SetMaxIdleConns(20)
sqlDB.SetConnMaxLifetime(time.Hour)
sqlDB.SetConnMaxIdleTime(10 * time.Minute)
```

#### Duration Format

`conn_max_lifetime` and `conn_max_idle_time` support two formats:

| Format | Example | Description |
| --- | --- | --- |
| Duration text | `"1h"`, `"30m"`, `"1h30m"` | Go standard library `time.ParseDuration` format |
| Seconds as string | `"3600"`, `"600"` | Numeric string representing seconds; supports decimals like `"1.5"` |

Blank or invalid values fall back to defaults (`conn_max_lifetime` defaults to `1h`, `conn_max_idle_time` defaults to `10m`).

## Models

PrismGo uses GORM as its ORM layer. Models are defined as Go structs with GORM tags. Here is a simple example:

```go
type User struct {
    ID        uint           `gorm:"primaryKey"`
    Name      string         `gorm:"size:100;not null"`
    Email     string         `gorm:"uniqueIndex;size:255"`
    Age       int            `gorm:"default:0"`
    CreatedAt time.Time
    UpdatedAt time.Time
}
```

Once you have a `*gorm.DB` instance, you can perform CRUD operations:

```go
db := database.Resolve()

// Auto Migrate (create table)
if err := db.AutoMigrate(&User{}); err != nil {
    return err
}

// Create
user := User{Name: "Alice", Email: "alice@example.com", Age: 25}
if err := db.Create(&user).Error; err != nil {
    return err
}

// Read (single)
var u User
if err := db.First(&u, user.ID).Error; err != nil {
    return err
}

// Read (conditional)
var users []User
if err := db.Where("age > ?", 18).Find(&users).Error; err != nil {
    return err
}

// Update
if err := db.Model(&u).Update("name", "Bob").Error; err != nil {
    return err
}

// Delete
if err := db.Delete(&u).Error; err != nil {
    return err
}
```

> GORM provides a rich set of features including model associations (BelongsTo/HasMany/ManyToMany), eager loading, transactions, Scopes, Hooks, and more. See the official GORM documentation: [https://gorm.io/docs/](https://gorm.io/docs/)

## Migrations

PrismGo's migration system uses a Go function registration pattern rather than Laravel's migration file classes. Business migration files register up/down handlers via `RegisterMigration` during `init()`, and commands look them up by name at runtime.

### Registering Migrations

#### Automatic Name Inference

`RegisterMigration` automatically infers the migration name from the up function's source location (the `.go` filename without the extension), keeping it consistent with directory scan results:

```go
// File: database/migration/202601010000_create_users_table.go
func init() {
    database.RegisterMigration(UpCreateUsersTable, DownCreateUsersTable)
}

func UpCreateUsersTable(db *gorm.DB) error {
    return db.AutoMigrate(&User{})
}

func DownCreateUsersTable(db *gorm.DB) error {
    return db.Migrator().DropTable("users")
}
```

The registered name is automatically inferred as `"202601010000_create_users_table"`.

> **Naming convention**: The up function must be defined in the corresponding migration file. The registration name is derived from the file where the up function resides (without the `.go` extension). The down function may be anonymous; the name is still derived from the up function's source.

#### Explicit Name Registration

In tests, temporary tools, or unconventional filename scenarios, you can use `RegisterMigrationAs` to specify the migration name explicitly:

```go
database.RegisterMigrationAs("custom_migration_name", upFunc, downFunc)
```

The migration name must not be empty, or the function will panic.

#### Querying Registered Migrations

```go
entry, ok := database.MigrationByName("202601010000_create_users_table")
if ok {
    if err := entry.Up(db); err != nil {
        return err
    }
}
```

### Registering Seeders

#### Automatic Class Name Inference

`RegisterSeeder` automatically infers the class name from the Seed function's source location. The short class name is derived from the filename by removing the timestamp prefix and converting to PascalCase. A package-path namespace alias is also registered, compatible with Laravel-style `--class` parameters:

```go
// File: database/seeders/202604280001_database_seeder.go
func init() {
    database.RegisterSeeder(SeedDatabase)
}

func SeedDatabase(db *gorm.DB) error {
    return db.Create(&User{Name: "Admin"}).Error
}
```

Automatically registered class names:
- Short name: `"DatabaseSeeder"`
- Namespace alias: `"Prismgo\\Database\\Seeders\\DatabaseSeeder"`

#### Explicit Class Name Registration

```go
database.RegisterSeederAs("CustomSeeder", seedFunc)
```

#### Querying and Validation

```go
// Query a seeder function
fn, ok := database.SeederByClass("DatabaseSeeder")

// Get all registered class names
names := database.SeederClassNames()

// Validate a seeder is registered; returns an error if not
if err := database.EnsureSeederRegistered("DatabaseSeeder"); err != nil {
    return err
}
```

### Default Seeder

When the `db:seed` command is run without a `--class` parameter, `"DatabaseSeeder"` is used as the default seeder class:

```go
const DefaultSeederClass = "DatabaseSeeder"
```

## Migrator Utilities

GORM's `AutoMigrate` cannot handle composite index creation, engine switching, or obsolete index deletion. PrismGo provides a set of idempotent migrator utility functions to perform these supplementary operations after migration.

### Table Options

`TableOptions` returns the table creation options for a given dialect, used to inject options before `AutoMigrate`:

```go
opts := database.TableOptions("mysql")
// Returns "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"

db.Set("gorm:table_options", opts).AutoMigrate(&User{})
```

Returns an empty string for non-MySQL dialects.

### Engine Management

#### EnsureInnoDB

Forces all managed MySQL tables to switch to the InnoDB engine. GORM AutoMigrate cannot change an existing table's ENGINE, so this utility is needed for engine switching. Non-MySQL dialects are skipped:

```go
if err := database.EnsureInnoDB(db, []any{&User{}, &Order{}}); err != nil {
    return err
}
```

#### ShouldAlterEngine

Determines whether a given engine needs to be switched to InnoDB. Returns `true` for any engine other than InnoDB, including an empty string:

```go
if database.ShouldAlterEngine("MyISAM") {
    // Engine needs to be switched
}
```

#### ManagedTableNames

Resolves the actual table names for given models via GORM, used for post-migration ALTER operations:

```go
names, err := database.ManagedTableNames(db, []any{&User{}, &Order{}})
// names = []string{"users", "orders"}
```

### Composite Indexes

`CompositeIndex` describes a non-unique composite index declaration. GORM AutoMigrate cannot automatically create composite indexes across embedded struct fields, so they must be created explicitly via SQL:

```go
indexes := []database.CompositeIndex{
    {
        Table:   "users",
        Name:    "idx_users_tenant_status",
        Columns: "`tenant_id`, `status`",
    },
    {
        Table:   "orders",
        Name:    "idx_orders_tenant_created",
        Columns: "`tenant_id`, `created_at`",
    },
}

if err := database.EnsureCompositeIndexes(db, indexes); err != nil {
    return err
}
```

`EnsureCompositeIndexes` is an idempotent operation:
- **MySQL**: Checks whether the index already exists via `IndexExists` first; skips if it exists.
- **SQLite**: Uses the `CREATE INDEX IF NOT EXISTS` syntax.
- Other dialects are silently ignored.

### Composite Unique Indexes

`CompositeUniqueIndex` describes a composite unique index declaration:

```go
uniqueIndexes := []database.CompositeUniqueIndex{
    {
        Table:   "users",
        Name:    "idx_users_tenant_phone",
        Columns: "`tenant_id`, `phone`",
    },
}

if err := database.EnsureCompositeUniqueIndexes(db, uniqueIndexes); err != nil {
    return err
}
```

`EnsureCompositeUniqueIndexes` is also idempotent, with the same behavior as `EnsureCompositeIndexes`, except it creates a `UNIQUE INDEX`.

### Dropping Obsolete Indexes

`DropIndex` describes an obsolete index to be dropped. `DropObsoleteIndexes` only executes under MySQL; SQLite is skipped (test databases are rebuilt each time and don't need cleanup):

```go
obsoleteIndexes := []database.DropIndex{
    {Table: "users", Name: "idx_users_legacy"},
    {Table: "orders", Name: "idx_orders_legacy"},
}

if err := database.DropObsoleteIndexes(db, obsoleteIndexes); err != nil {
    return err
}
```

The operation is idempotent: if the index does not exist, it is skipped.

### Index Existence Check

`IndexExists` queries MySQL's `information_schema.statistics` to determine whether a specified index exists on a given table:

```go
exists, err := database.IndexExists(db, "users", "idx_users_tenant_status")
if err != nil {
    return err
}
if exists {
    // Index already exists
}
```

### Primary Key Column Query

`PrimaryKeyColumns` returns the current primary key columns of a specified MySQL table (in order). Returns an empty slice if the table does not exist or has no primary key:

```go
columns, err := database.PrimaryKeyColumns(db, "users")
// columns = []string{"id"}
```

`SameColumns` determines whether two sets of column names are identical and in the same order, used to check if a target composite primary key is already in place:

```go
if database.SameColumns(currentPK, targetPK) {
    // Primary key structure matches; no ALTER needed
}
```

## Service Provider

`ServiceProvider` registers the default database connection as a lazy factory in the application container. The `Register` phase only declares the factory; it does not open a GORM connection upfront. Configuration or connection errors are surfaced when the connection is later resolved:

```go
// Register in bootstrap/app.go
app.Register(&database.ServiceProvider{})
```

The `Boot` phase has no side effects. The database connection is only opened when it is strictly resolved or actually used.

If a `"database.default"` binding already exists in the container (e.g., a custom `*gorm.DB` was injected in a test), `Register` preserves the existing binding without overwriting it.

## Resource Lifecycle

`ServiceProvider` binds a close callback via `container.WithCloser` during registration. When the application exits normally, the framework calls `*gorm.DB`'s underlying `sql.DB.Close()` to release the connection pool. Developers do not need to handle this manually.

When manually creating connections in standalone programs or tests, ensure they are closed:

```go
db, err := database.Open("mysql", dsn)
if err != nil {
    return err
}
sqlDB, _ := db.DB()
defer sqlDB.Close()
```

Or use the facade's `DBCloseOption` to bind close behavior during bootstrap registration:

```go
app.Instance("database.default", db, database.DBCloseOption())
```

## Laravel Database Mapping

| Laravel Concept | PrismGo Equivalent |
| --- | --- |
| `config/database.php` | `config/database.go` |
| `DB_CONNECTION` env variable | `DATABASE_CONNECTION` env variable |
| `DB::connection('mysql')` | `database.OpenConnection("mysql")` |
| `DB::connection()->getPdo()` | `db.DB()` (returns `*sql.DB`) |
| Migration file class | `database.RegisterMigration(up, down)` |
| `php artisan migrate` | `go run ./ migrate` |
| `php artisan db:seed` | `go run ./ seed` |
| `php artisan db:seed --class=UserSeeder` | `database.SeederByClass("UserSeeder")` |
| `DatabaseSeeder` default class | `database.DefaultSeederClass` constant |
| Schema Builder | `prismgo/database/schema` sub-package (separate docs) |
