# Database

- [简介](#简介)
- [配置](#配置)
  - [配置文件](#配置文件)
  - [驱动前置条件](#驱动前置条件)
  - [配置参数说明](#配置参数说明)
  - [使用 DSN 连接](#使用-dsn-连接)
- [获取数据库连接](#获取数据库连接)
  - [使用 Facade 解析](#使用-facade-解析)
  - [手动打开连接](#手动打开连接)
  - [连接池管理](#连接池管理)
- [模型定义与使用](#模型定义与使用)
- [迁移](#迁移)
  - [注册迁移](#注册迁移)
  - [注册 Seeder](#注册-seeder)
  - [默认 Seeder](#默认-seeder)
- [Migrator 辅助工具](#migrator-辅助工具)
  - [建表选项](#建表选项)
  - [引擎管理](#引擎管理)
  - [联合索引](#联合索引)
  - [联合唯一索引](#联合唯一索引)
  - [删除废弃索引](#删除废弃索引)
  - [索引存在性检查](#索引存在性检查)
  - [主键列查询](#主键列查询)
- [服务提供者](#服务提供者)
- [资源生命周期](#资源生命周期)
- [与 Laravel Database 的对应关系](#与-laravel-database-的对应关系)

---

PrismGo 的数据库组件基于 GORM 提供数据库连接管理、迁移注册和索引维护等能力。当前内置 MySQL 驱动支持，采用 Laravel 风格的配置结构，通过 ServiceProvider 实现延迟连接和自动关闭。

---

## 简介

数据库组件围绕以下几个核心能力构建：

- **连接管理**：通过 `OpenDefaultConnection` / `OpenConnection` 按配置创建 GORM 数据库连接，自动应用连接池参数。
- **Facade 解析**：`database.Resolve()` 从应用容器获取默认 `*gorm.DB` 实例，业务代码无需关心连接构造细节。
- **迁移注册**：`RegisterMigration` / `RegisterSeeder` 在 `init` 阶段声明迁移和填充函数，命令运行时按名称查找执行。
- **Migrator 辅助**：提供 `EnsureInnoDB`、`EnsureCompositeIndexes`、`EnsureCompositeUniqueIndexes`、`DropObsoleteIndexes` 等幂等索引维护工具，弥补 GORM AutoMigrate 在联合索引和引擎切换方面的不足。

## 配置

### 配置文件

数据库配置集中注册在 `config/database.go`，结构对齐 Laravel 的 `config/database.php`。你可以使用环境变量覆盖各项参数：

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

### 驱动前置条件

#### MySQL

当前唯一内置的数据库驱动。底层使用 `go-sql-driver/mysql` 和 `gorm.io/driver/mysql`。无需额外配置，只要 MySQL 服务可达且账号密码正确即可连接。

> 如需扩展 SQLite / PostgreSQL 等驱动，可在 `Open` 函数中新增同名 DSN 构造器并添加分支。

### 配置参数说明

#### 顶层配置

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `database.default` | `DATABASE_CONNECTION` | `"mysql"` | 默认使用的数据库连接名，对应 `connections` 下的键名 |

#### MySQL 连接配置

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `database.connections.mysql.driver` | `DATABASE_DRIVER` | `"mysql"` | 数据库驱动类型，目前仅支持 `"mysql"` |
| `database.connections.mysql.host` | `DATABASE_HOST` | `"127.0.0.1"` | 数据库主机地址 |
| `database.connections.mysql.port` | `DATABASE_PORT` | `3306` | 数据库端口号 |
| `database.connections.mysql.database` | `DATABASE_NAME` | `"workorder"` | 数据库名称 |
| `database.connections.mysql.username` | `DATABASE_USER` | `"root"` | 数据库用户名 |
| `database.connections.mysql.password` | `DATABASE_PASSWORD` | `"root"` | 数据库密码 |
| `database.connections.mysql.charset` | `DATABASE_CHARSET` | `"utf8mb4"` | 字符集，拼接到 DSN 的 `charset` 参数 |
| `database.connections.mysql.parse_time` | `DATABASE_PARSE_TIME` | `true` | 是否将 `DATE`/`DATETIME` 自动扫描为 `time.Time` |
| `database.connections.mysql.loc` | `DATABASE_LOC` | `"Local"` | 时区，拼接到 DSN 的 `loc` 参数 |
| `database.connections.mysql.dsn` | `DATABASE_DSN` | `""` | 完整 DSN 连接串。非空时优先使用，其余字段被忽略 |
| `database.connections.mysql.max_open_conns` | `DATABASE_MAX_OPEN_CONNS` | `30` | 最大打开连接数 |
| `database.connections.mysql.max_idle_conns` | `DATABASE_MAX_IDLE_CONNS` | `10` | 最大空闲连接数 |
| `database.connections.mysql.conn_max_lifetime` | `DATABASE_CONN_MAX_LIFETIME` | `"1h"` | 连接最大存活时间，支持持续时间文本（如 `"1h"`、`"30m"`）或秒数字符串（如 `"3600"`） |
| `database.connections.mysql.conn_max_idle_time` | `DATABASE_CONN_MAX_IDLE_TIME` | `"10m"` | 连接最大空闲时间，格式同上 |

### 使用 DSN 连接

类似 Laravel 的 `DB_URL` 支持，PrismGo 允许通过 `dsn` 字段直接提供完整的 MySQL 连接串。当 `dsn` 非空时，`host`、`port`、`username`、`password`、`database`、`charset`、`parse_time`、`loc` 等字段将被忽略：

```env
DATABASE_DSN=root:secret@tcp(127.0.0.1:3306)/workorder?charset=utf8mb4&parseTime=true&loc=Local
```

> 当你使用托管数据库服务（如 AWS RDS、阿里云 RDS）时，通常只需要配置一个 DSN 即可。

## 获取数据库连接

### 使用 Facade 解析

业务代码中最常用的方式，从应用容器获取默认 `*gorm.DB` 实例：

```go
import "github.com/prismgo/framework/database"

db := database.Resolve()
```

`Resolve()` 返回的 `*gorm.DB` 是单例，首次调用时由 ServiceProvider 注册的延迟工厂触发连接创建，后续调用直接复用。

### 手动打开连接

在独立程序或测试中，可以绕过容器直接创建连接：

```go
// 打开默认连接（读取 config/database 配置）
db, err := database.OpenDefaultConnection()
if err != nil {
    return err
}

// 打开指定名称的连接
db, err := database.OpenConnection("mysql")
if err != nil {
    return err
}
```

也可以使用底层 `Open` 函数，直接指定驱动和 DSN：

```go
db, err := database.Open("mysql", "root:secret@tcp(127.0.0.1:3306)/app?charset=utf8mb4&parseTime=true&loc=Local")
if err != nil {
    return err
}
```

> `Open` 目前仅支持 `"mysql"` 驱动，传入其他驱动名会立即返回错误。

### 连接池管理

`OpenConnection` 内部自动从配置读取连接池参数并应用。如需手动调整，可以使用 `applyConnectionPoolConfig`（包级私有）或直接操作 `*sql.DB`：

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

#### 时间格式说明

`conn_max_lifetime` 和 `conn_max_idle_time` 支持两种格式：

| 格式 | 示例 | 说明 |
| --- | --- | --- |
| 持续时间文本 | `"1h"`、`"30m"`、`"1h30m"` | Go 标准库 `time.ParseDuration` 格式 |
| 秒数字符串 | `"3600"`、`"600"` | 纯数字表示秒数，支持小数如 `"1.5"` |

空白或无效值会回退到默认值（`conn_max_lifetime` 默认 `1h`，`conn_max_idle_time` 默认 `10m`）。

## 模型定义与使用

PrismGo 使用 GORM 作为 ORM 层，模型通过 Go struct 定义。以下是一个简单的模型示例：

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

获取 `*gorm.DB` 实例后，即可进行 CRUD 操作：

```go
db := database.Resolve()

// 自动迁移（建表）
if err := db.AutoMigrate(&User{}); err != nil {
    return err
}

// 创建记录
user := User{Name: "张三", Email: "zhangsan@example.com", Age: 25}
if err := db.Create(&user).Error; err != nil {
    return err
}

// 查询单条
var u User
if err := db.First(&u, user.ID).Error; err != nil {
    return err
}

// 条件查询
var users []User
if err := db.Where("age > ?", 18).Find(&users).Error; err != nil {
    return err
}

// 更新
if err := db.Model(&u).Update("name", "李四").Error; err != nil {
    return err
}

// 删除
if err := db.Delete(&u).Error; err != nil {
    return err
}
```

> GORM 提供了丰富的功能：模型关联（BelongsTo/HasMany/ManyToMany）、预加载、事务、Scopes、Hooks 等。详见 GORM 官方文档：[https://gorm.io/zh_CN/docs/](https://gorm.io/zh_CN/docs/)

## 迁移

PrismGo 的迁移系统采用 Go 函数注册模式，而非 Laravel 的迁移文件类。业务迁移文件在 `init()` 阶段通过 `RegisterMigration` 注册 up/down 处理器，命令运行时按文件名查找执行。

### 注册迁移

#### 自动推导名称

`RegisterMigration` 自动从 up 函数的源码位置推导迁移名称（取 `.go` 文件名去掉扩展名），与目录扫描结果保持一致：

```go
// 文件：database/migration/202601010000_create_users_table.go
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

注册名自动推导为 `"202601010000_create_users_table"`。

> **命名约定**：up 函数必须定义在对应的迁移文件中，注册名取 up 函数所在文件名（去掉 `.go`）。down 可为匿名函数，注册名仍然只取 up 函数来源。

#### 显式指定名称

在测试、临时工具或非常规文件名场景下，可以使用 `RegisterMigrationAs` 显式指定迁移名：

```go
database.RegisterMigrationAs("custom_migration_name", upFunc, downFunc)
```

迁移名不能为空，否则会 panic。

#### 查询已注册迁移

```go
entry, ok := database.MigrationByName("202601010000_create_users_table")
if ok {
    if err := entry.Up(db); err != nil {
        return err
    }
}
```

### 注册 Seeder

#### 自动推导 Class 名

`RegisterSeeder` 自动从 Seed 函数的源码位置推导 class 名。短 class 名来自文件名去掉时间前缀后的 PascalCase 形式，同时注册包路径命名空间别名，兼容 Laravel 风格的 `--class` 参数：

```go
// 文件：database/seeders/202604280001_database_seeder.go
func init() {
    database.RegisterSeeder(SeedDatabase)
}

func SeedDatabase(db *gorm.DB) error {
    return db.Create(&User{Name: "Admin"}).Error
}
```

自动注册的 class 名：
- 短名：`"DatabaseSeeder"`
- 命名空间别名：`"Prismgo\\Database\\Seeders\\DatabaseSeeder"`

#### 显式指定 Class 名

```go
database.RegisterSeederAs("CustomSeeder", seedFunc)
```

#### 查询与校验

```go
// 查询 seeder 执行函数
fn, ok := database.SeederByClass("DatabaseSeeder")

// 获取所有已注册 class 名
names := database.SeederClassNames()

// 校验 seeder 已注册，未注册时返回错误
if err := database.EnsureSeederRegistered("DatabaseSeeder"); err != nil {
    return err
}
```

### 默认 Seeder

当 `db:seed` 命令未指定 `--class` 参数时，默认使用 `"DatabaseSeeder"` 作为 seeder class：

```go
const DefaultSeederClass = "DatabaseSeeder"
```

## Migrator 辅助工具

GORM 的 `AutoMigrate` 无法处理联合索引创建、引擎切换和废弃索引删除等场景。PrismGo 提供了一组幂等的 Migrator 辅助函数，在迁移后执行这些补充操作。

### 建表选项

`TableOptions` 返回指定 dialect 的建表选项，用于 `AutoMigrate` 前注入：

```go
opts := database.TableOptions("mysql")
// 返回 "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"

db.Set("gorm:table_options", opts).AutoMigrate(&User{})
```

非 MySQL dialect 返回空串。

### 引擎管理

#### EnsureInnoDB

将所有受管 MySQL 表强制切换为 InnoDB 引擎。GORM AutoMigrate 无法改变已有表的 ENGINE，因此需要此辅助完成引擎切换。非 MySQL dialect 直接跳过：

```go
if err := database.EnsureInnoDB(db, []any{&User{}, &Order{}}); err != nil {
    return err
}
```

#### ShouldAlterEngine

判断给定引擎是否需要切换为 InnoDB。空字符串或 InnoDB 以外的引擎均返回 `true`：

```go
if database.ShouldAlterEngine("MyISAM") {
    // 需要切换引擎
}
```

#### ManagedTableNames

通过 GORM 解析给定模型的实际表名列表，用于迁移后的 ALTER 操作：

```go
names, err := database.ManagedTableNames(db, []any{&User{}, &Order{}})
// names = []string{"users", "orders"}
```

### 联合索引

`CompositeIndex` 描述一条普通（非唯一）联合索引声明。GORM AutoMigrate 无法跨嵌入 struct 字段自动建立联合索引，因此需要通过 SQL 显式创建：

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

`EnsureCompositeIndexes` 是幂等操作：
- **MySQL**：先通过 `IndexExists` 检查索引是否已存在，已存在则跳过。
- **SQLite**：使用 `CREATE INDEX IF NOT EXISTS` 语法。
- 其他 dialect 直接忽略。

### 联合唯一索引

`CompositeUniqueIndex` 描述一条联合唯一索引声明：

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

`EnsureCompositeUniqueIndexes` 同样是幂等操作，行为与 `EnsureCompositeIndexes` 一致，区别在于创建的是 `UNIQUE INDEX`。

### 删除废弃索引

`DropIndex` 描述一条需要删除的废弃索引。`DropObsoleteIndexes` 仅在 MySQL 下执行，SQLite 跳过（测试库每次重建无需清理）：

```go
obsoleteIndexes := []database.DropIndex{
    {Table: "users", Name: "idx_users_legacy"},
    {Table: "orders", Name: "idx_orders_legacy"},
}

if err := database.DropObsoleteIndexes(db, obsoleteIndexes); err != nil {
    return err
}
```

操作幂等：索引不存在时跳过。

### 索引存在性检查

`IndexExists` 查询 MySQL `information_schema.statistics`，判断指定表的指定索引是否已存在：

```go
exists, err := database.IndexExists(db, "users", "idx_users_tenant_status")
if err != nil {
    return err
}
if exists {
    // 索引已存在
}
```

### 主键列查询

`PrimaryKeyColumns` 返回指定 MySQL 表当前主键列（按顺序）。表不存在或无主键时返回空切片：

```go
columns, err := database.PrimaryKeyColumns(db, "users")
// columns = []string{"id"}
```

`SameColumns` 判断两组列名是否完全一致且顺序相同，用于识别目标联合主键是否已就绪：

```go
if database.SameColumns(currentPK, targetPK) {
    // 主键结构一致，无需 ALTER
}
```

## 服务提供者

`ServiceProvider` 把默认数据库连接以延迟工厂的形式注册到应用容器。`Register` 阶段只声明工厂，不提前打开 GORM 连接，配置或连接错误由后续严格 Resolve 暴露：

```go
// 在 bootstrap/app.go 中注册
app.Register(&database.ServiceProvider{})
```

`Boot` 阶段无副作用，数据库连接只在严格 Resolve 或真实入口使用时打开。

如果容器中已存在 `"database.default"` 绑定（如测试中注入了自定义 `*gorm.DB`），`Register` 会保留现有绑定不做覆盖。

## 资源生命周期

`ServiceProvider` 在注册时已通过 `container.WithCloser` 绑定了关闭回调。应用正常退出时，框架会调用 `*gorm.DB` 底层 `sql.DB.Close()` 释放连接池，开发者无需手动处理。

独立程序或测试中手动创建连接时，应确保关闭：

```go
db, err := database.Open("mysql", dsn)
if err != nil {
    return err
}
sqlDB, _ := db.DB()
defer sqlDB.Close()
```

或通过 facade 的 `DBCloseOption` 在 bootstrap 注册时绑定关闭行为：

```go
app.Instance("database.default", db, database.DBCloseOption())
```

## 与 Laravel Database 的对应关系

| Laravel 概念 | PrismGo 等价 |
| --- | --- |
| `config/database.php` | `config/database.go` |
| `DB_CONNECTION` 环境变量 | `DATABASE_CONNECTION` 环境变量 |
| `DB::connection('mysql')` | `database.OpenConnection("mysql")` |
| `DB::connection()->getPdo()` | `db.DB()` (返回 `*sql.DB`) |
| 迁移文件类 | `database.RegisterMigration(up, down)` |
| `php artisan migrate` | `go run ./ migrate` |
| `php artisan db:seed` | `go run ./ seed` |
| `php artisan db:seed --class=UserSeeder` | `database.SeederByClass("UserSeeder")` |
| `DatabaseSeeder` 默认类 | `database.DefaultSeederClass` 常量 |
| Schema Builder | `prismgo/database/schema` 子包（独立文档） |
