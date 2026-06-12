# Filesystem

- [简介](#简介)
- [配置](#配置)
  - [配置文件](#配置文件)
  - [驱动前置条件](#驱动前置条件)
  - [配置参数说明](#配置参数说明)
  - [符号链接配置](#符号链接配置)
  - [磁盘配置字段说明](#磁盘配置字段说明)
- [获取磁盘实例](#获取磁盘实例)
  - [包级 Facade](#包级-facade)
  - [指定磁盘](#指定磁盘)
  - [云磁盘](#云磁盘)
  - [接口选择建议](#接口选择建议)
- [读取文件](#读取文件)
  - [读取全部内容](#读取全部内容)
  - [读取并反序列化 JSON](#读取并反序列化-json)
  - [流式读取](#流式读取)
  - [下载到 Writer](#下载到-writer)
  - [判断文件存在](#判断文件存在)
  - [判断目录存在](#判断目录存在)
- [写入文件](#写入文件)
  - [基础写入](#基础写入)
  - [流式写入](#流式写入)
  - [前置追加与末尾追加](#前置追加与末尾追加)
  - [PutOptions 说明](#putoptions-说明)
- [上传文件](#上传文件)
  - [PutFile](#putfile)
  - [PutFileAs](#putfileas)
  - [推荐业务字段](#推荐业务字段)
- [文件管理](#文件管理)
  - [复制与移动](#复制与移动)
  - [删除文件](#删除文件)
  - [文件元信息](#文件元信息)
  - [文件校验和](#文件校验和)
  - [物理路径](#物理路径)
- [目录操作](#目录操作)
- [URL 与临时签名 URL](#url-与临时签名-url)
  - [公开 URL](#公开-url)
  - [公开磁盘符号链接](#公开磁盘符号链接)
  - [临时签名 URL](#临时签名-url)
  - [临时上传 URL](#临时上传-url)
  - [校验本地签名 URL](#校验本地签名-url)
- [可见性](#可见性)
- [OSS 驱动](#oss-驱动)
- [自定义 Driver](#自定义-driver)
  - [注册 Driver](#注册-driver)
  - [Driver 接口](#driver-接口)
  - [DriverFactoryContext 字段说明](#driverfactorycontext-字段说明)
- [手动初始化](#手动初始化)
- [错误常量](#错误常量)
- [内置驱动能力矩阵](#内置驱动能力矩阵)
- [与 Laravel Filesystem 的对应关系](#与-laravel-filesystem-的对应关系)
- [使用建议](#使用建议)

---

`github.com/prismgo/framework/filesystem` 提供 Laravel Filesystem / Storage 风格的文件存储抽象。业务代码面向"磁盘名"和"相对路径"编程，不直接依赖本地目录、公开目录或阿里云 OSS 实现。

所有操作都显式接收 `context.Context`，文件路径使用磁盘内相对路径，返回值携带 `error`。

---

## 简介

文件系统以 `Manager` 管理多个磁盘（disk），每个磁盘通过 `Repository` 暴露读写操作。业务代码可以直接使用包级 facade（如 `filesystem.Put`、`filesystem.Get`），也可以通过 `filesystem.Disk("public")` 获取指定磁盘的 `Repository` 实例。

内置磁盘：

| 磁盘 | 默认驱动 | 默认可见性 | 用途 |
| --- | --- | --- | --- |
| `local` | `local` | `private` | 私有附件、导入导出临时文件、需要签名访问的文件 |
| `public` | `local` | `public` | 头像、封面、工单现场图片、公开附件 |
| `oss` | `oss` | `private` | 阿里云 OSS、对象存储、CDN 场景 |

## 配置

### 配置文件

文件系统的配置集中注册在 `config/filesystem.go`。你可以使用环境变量覆盖各项参数：

```go
// config/filesystem.go
func init() {
    config.Add("filesystem", func() map[string]interface{} {
        return map[string]interface{}{
            "default": config.Env("FILESYSTEM_DISK", "local"),
            "cloud":   config.Env("FILESYSTEM_CLOUD", "oss"),
            "temporary_url": map[string]interface{}{
                "signing_key": config.Env("FILESYSTEM_SIGNING_KEY", ""),
            },
            "disks": map[string]interface{}{
                "local": map[string]interface{}{
                    "driver":     "local",
                    "root":       config.Env("FILESYSTEM_LOCAL_ROOT", "storage/app/private"),
                    "url":        config.Env("FILESYSTEM_LOCAL_URL", ""),
                    "visibility": config.Env("FILESYSTEM_LOCAL_VISIBILITY", "private"),
                    "serve":      config.Env("FILESYSTEM_LOCAL_SERVE", true),
                },
                "public": map[string]interface{}{
                    "driver":     "local",
                    "root":       config.Env("FILESYSTEM_PUBLIC_ROOT", "storage/app/public"),
                    "url":        config.Env("FILESYSTEM_PUBLIC_URL", ""),
                    "visibility": config.Env("FILESYSTEM_PUBLIC_VISIBILITY", "public"),
                    "serve":      config.Env("FILESYSTEM_PUBLIC_SERVE", true),
                },
                "oss": map[string]interface{}{
                    "driver":      "oss",
                    "bucket":      config.Env("FILESYSTEM_OSS_BUCKET", ""),
                    "endpoint":    config.Env("FILESYSTEM_OSS_ENDPOINT", ""),
                    "access_key":  config.Env("FILESYSTEM_OSS_ACCESS_KEY_ID", ""),
                    "secret_key":  config.Env("FILESYSTEM_OSS_ACCESS_KEY_SECRET", ""),
                    "prefix":      config.Env("FILESYSTEM_OSS_PREFIX", ""),
                    "url":         config.Env("FILESYSTEM_OSS_URL", ""),
                    "visibility":  config.Env("FILESYSTEM_OSS_VISIBILITY", "private"),
                    "timeout":     config.Env("FILESYSTEM_OSS_TIMEOUT", 30),
                },
            },
            "links": map[string]interface{}{
                "public/storage": "storage/app/public",
                // "public/images": "storage/app/images",
            },
        }
    })
}
```

### 驱动前置条件

#### Local

基于 `gocloud.dev/blob/fileblob` 实现，无需额外依赖。数据存储在本地文件系统，`root` 配置的目录会在启动时自动创建。适合私有附件、导出报表等不需要公开 URL 的场景。

公开文件通过 `GET /storage/*path` 访问；临时签名文件通过 `GET /storage-temp/:disk/*path` 访问。

#### OSS

需要 `github.com/aliyun/aliyun-oss-go-sdk/oss` 依赖。配置 `bucket`、`endpoint`、`access_key`、`secret_key` 后即可使用。OSS 驱动原生支持临时签名 URL 和临时上传 URL。

### 配置参数说明

#### 顶层配置

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `filesystem.default` | `FILESYSTEM_DISK` | `"local"` | 默认磁盘名称。包级 `filesystem.Put/Get/Exists` 都会使用它 |
| `filesystem.cloud` | `FILESYSTEM_CLOUD` | `"oss"` | 云盘别名。用于业务表达"当前云存储" |
| `filesystem.temporary_url.signing_key` | `FILESYSTEM_SIGNING_KEY` | `""`（回退 `app.key`） | 本地临时 URL 签名密钥 |
| `filesystem.links` | — | `{"public/storage": "storage/app/public"}` | `storage:link` 与 `storage:unlink` 使用的符号链接映射 |

#### Local 磁盘

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `filesystem.disks.local.driver` | — | `"local"` | 驱动类型 |
| `filesystem.disks.local.root` | `FILESYSTEM_LOCAL_ROOT` | `"storage/app/private"` | 本地根目录，所有相对路径都会落在这个目录下 |
| `filesystem.disks.local.url` | `FILESYSTEM_LOCAL_URL` | `""`（自动拼接 `APP_URL + "/storage"`） | 公开 URL 前缀 |
| `filesystem.disks.local.visibility` | `FILESYSTEM_LOCAL_VISIBILITY` | `"private"` | 磁盘可见性 |
| `filesystem.disks.local.serve` | `FILESYSTEM_LOCAL_SERVE` | `true` | 是否允许本地磁盘通过签名路由读取 |

#### Public 磁盘

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `filesystem.disks.public.driver` | — | `"local"` | 驱动类型 |
| `filesystem.disks.public.root` | `FILESYSTEM_PUBLIC_ROOT` | `"storage/app/public"` | 公开本地盘根目录 |
| `filesystem.disks.public.url` | `FILESYSTEM_PUBLIC_URL` | `""`（自动拼接 `APP_URL + "/storage"`） | 公开文件 URL 前缀，生产环境通常配置为站点域名或 CDN 域名 |
| `filesystem.disks.public.visibility` | `FILESYSTEM_PUBLIC_VISIBILITY` | `"public"` | 公开盘可见性 |
| `filesystem.disks.public.serve` | `FILESYSTEM_PUBLIC_SERVE` | `true` | 是否允许框架通过 `/storage/*path` 服务本地公开文件 |

#### OSS 磁盘

| 参数路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `filesystem.disks.oss.driver` | — | `"oss"` | 驱动类型 |
| `filesystem.disks.oss.bucket` | `FILESYSTEM_OSS_BUCKET` | `""` | OSS bucket 名称 |
| `filesystem.disks.oss.endpoint` | `FILESYSTEM_OSS_ENDPOINT` | `""` | OSS endpoint，例如 `oss-cn-hangzhou.aliyuncs.com` |
| `filesystem.disks.oss.access_key` | `FILESYSTEM_OSS_ACCESS_KEY_ID` | `""` | OSS AccessKey ID |
| `filesystem.disks.oss.secret_key` | `FILESYSTEM_OSS_ACCESS_KEY_SECRET` | `""` | OSS AccessKey Secret |
| `filesystem.disks.oss.prefix` | `FILESYSTEM_OSS_PREFIX` | `""` | 给所有对象 key 加统一前缀，适合多环境共用 bucket |
| `filesystem.disks.oss.url` | `FILESYSTEM_OSS_URL` | `""` | OSS 公开 URL 或 CDN 前缀；不配置时 URL 由驱动按 bucket/endpoint 生成 |
| `filesystem.disks.oss.visibility` | `FILESYSTEM_OSS_VISIBILITY` | `"private"` | OSS 默认可见性 |
| `filesystem.disks.oss.timeout` | `FILESYSTEM_OSS_TIMEOUT` | `30` | OSS 客户端超时秒数 |

### 符号链接配置

`filesystem.links` 配置公开目录中的符号链接。键是要创建的链接位置，值是链接指向的目标目录：

```go
"links": map[string]interface{}{
    "public/storage": "storage/app/public",
    "public/images":  "storage/app/images",
},
```

相对路径会按应用根目录解析。上面的默认链接会让 `storage/app/public` 下的文件可以通过 `public/storage` 暴露给 Web 服务器。

如果没有配置 `filesystem.links`，`storage:link` 会使用默认映射：`public/storage` 指向 `storage/app/public`。

### 磁盘配置字段说明

`DiskConfig` 结构体字段：

| 字段 | 适用驱动 | 用途 |
| --- | --- | --- |
| `Driver` | 所有驱动 | 选择底层实现，内置 `local`、`oss`，也可以使用 `Extend` 注册名 |
| `Root` | `local` | 本地根目录，业务传入的路径只能在该目录内解析 |
| `URL` | `local` / `oss` | 生成公开 URL 或本地签名 URL 的前缀 |
| `Prefix` | 自定义 / 对象存储 | 给磁盘内路径追加统一前缀 |
| `Visibility` | 所有驱动 | 磁盘默认访问语义：`public` 或 `private` |
| `Serve` | `local` | 是否允许框架 HTTP 路由服务该本地磁盘 |
| `OSS` | `oss` | OSS bucket、endpoint、密钥、超时等连接参数 |
| `Options` | 自定义 driver | 透传给自定义 driver 的扩展参数 |

## 获取磁盘实例

### 包级 Facade

不指定磁盘时，包级 facade 使用默认磁盘：

```go
ctx := context.Background()

err := filesystem.Put(ctx, "notes/hello.txt", "hello")
body, err := filesystem.Get(ctx, "notes/hello.txt")
exists, err := filesystem.Exists(ctx, "notes/hello.txt")

_ = body
_ = exists
_ = err
```

### 指定磁盘

```go
publicDisk := filesystem.Disk("public")
privateDisk := filesystem.Disk("local")

err := publicDisk.Put(ctx, "avatars/u1.jpg", imageData)
```

### 云磁盘

`Cloud` 返回配置中 `filesystem.cloud` 指向的磁盘，便于业务代码统一表达"当前云存储"：

```go
cloudDisk := filesystem.Resolve().Cloud()
url, err := cloudDisk.URL("reports/summary.pdf")
```

### 接口选择建议

| 场景 | 推荐接口 | 原因 |
| --- | --- | --- |
| 业务只关心默认存储 | `filesystem.Put/Get/Exists` | 与 Laravel `Storage::put()` 类似，默认磁盘可通过配置切换 |
| 文件类型明确，例如头像必须公开 | `filesystem.Disk("public")` | 避免默认磁盘切换导致公开资源落到私有盘 |
| 私有附件、导出报表 | `filesystem.Disk("local")` + `TemporaryURL` | 文件不暴露永久 URL，只在授权后短期访问 |
| 上传表单文件 | `PutFile` / `PutFileAs` | 自动处理 `multipart.FileHeader`，返回可保存的相对路径 |
| 大文件读取或下载 | `OpenStream` / `Download` | 避免把完整内容一次性读入内存 |
| 需要新存储后端 | `Extend` | 保留业务层 `Disk` API 不变 |

## 读取文件

### 读取全部内容

`Get` 读取文件全部内容到内存，适合小文件：

```go
body, err := filesystem.Disk("local").Get(ctx, "reports/monthly.pdf")
if err != nil {
    return err
}
_ = body
```

### 读取并反序列化 JSON

`JSON` 读取文件内容并反序列化到目标结构体：

```go
var config AppConfig
if err := filesystem.Disk("local").JSON(ctx, "config/app.json", &config); err != nil {
    return err
}
```

### 流式读取

大文件建议使用 `OpenStream`，返回 `io.ReadCloser` 和 `FileInfo`：

```go
reader, info, err := filesystem.Disk("local").OpenStream(ctx, "reports/monthly.pdf")
if err != nil {
    return err
}
defer reader.Close()

// 在 Gin 中直接流式响应
c.DataFromReader(http.StatusOK, info.Size, info.ContentType, reader, nil)
```

如果不需要 `FileInfo`，可以使用 `ReadStream`：

```go
reader, err := filesystem.Disk("local").ReadStream(ctx, "reports/monthly.pdf")
if err != nil {
    return err
}
defer reader.Close()
```

### 下载到 Writer

`Download` 把文件内容复制到任意 `io.Writer`：

```go
var buf bytes.Buffer
err := filesystem.Disk("local").Download(ctx, "reports/monthly.pdf", &buf)
```

### 判断文件存在

`Exists` 判断文件是否存在，`Missing` 判断文件是否不存在：

```go
exists, err := filesystem.Disk("public").Exists(ctx, "avatars/u1.jpg")
missing, err := filesystem.Disk("public").Missing(ctx, "avatars/u1.jpg")
```

`FileExists` 是 `Exists` 的别名。

### 判断目录存在

```go
exists, err := filesystem.Disk("public").DirectoryExists(ctx, "uploads/images")
```

## 写入文件

### 基础写入

`Put` 支持 `string`、`[]byte` 和 `io.Reader`。写入路径始终是磁盘内相对路径：

```go
err := filesystem.Disk("public").Put(ctx, "notices/readme.txt", "hello", filesystem.PutOptions{
    Visibility:  filesystem.VisibilityPublic,
    ContentType: "text/plain; charset=utf-8",
})
```

### 流式写入

已有流使用 `PutReader`：

```go
err := filesystem.Disk("local").PutReader(ctx, "reports/monthly.csv", reader, filesystem.PutOptions{
    Visibility:  filesystem.VisibilityPrivate,
    ContentType: "text/csv",
})
```

`WriteStream` 是 `PutReader` 的别名。

### 前置追加与末尾追加

`Prepend` 在文件开头插入文本，`Append` 在文件末尾追加文本。已有内容与新内容之间以换行符分隔。文件不存在时等同于 `Put`：

```go
// 在文件开头插入内容
err := filesystem.Disk("local").Prepend(ctx, "logs/events.log", "2024-01-01 started", filesystem.PutOptions{
    Visibility: filesystem.VisibilityPrivate,
})

// 在文件末尾追加内容
err = filesystem.Disk("local").Append(ctx, "logs/events.log", "2024-01-01 completed", filesystem.PutOptions{
    Visibility: filesystem.VisibilityPrivate,
})
```

### PutOptions 说明

| 字段 | 用途 |
| --- | --- |
| `Visibility` | 指定本次写入的可见性。内置本地驱动采用磁盘级可见性，因此应与磁盘配置一致 |
| `ContentType` | 写入对象的 MIME 类型。OSS 会用于对象元数据；本地流式下载会回传给 HTTP 响应 |

路径参数必须是磁盘内相对路径，例如 `avatars/u1.jpg`。不要传入本地绝对路径，也不要在业务层拼接 `storage/app/...`，否则会破坏驱动切换能力。

## 上传文件

### PutFile

`PutFile` 使用上传文件原名保存，返回最终相对路径：

```go
func UploadAttachment(c *gin.Context) error {
    file, err := c.FormFile("image")
    if err != nil {
        return err
    }

    path, err := filesystem.Disk("public").PutFile(
        c.Request.Context(),
        "workorders/100/attachments",
        file,
        filesystem.PutOptions{
            Visibility:  filesystem.VisibilityPublic,
            ContentType: file.Header.Get("Content-Type"),
        },
    )
    if err != nil {
        return err
    }

    return nil
}
```

### PutFileAs

`PutFileAs` 使用指定文件名保存：

```go
path, err := filesystem.Disk("public").PutFileAs(
    ctx,
    "workorders/100/attachments",
    file,
    "scene.jpg",
    filesystem.PutOptions{
        Visibility:  filesystem.VisibilityPublic,
        ContentType: "image/jpeg",
    },
)

url, err := filesystem.Disk("public").URL(path)
```

### 推荐业务字段

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `disk` | `public` | 文件所在磁盘 |
| `file_path` | `workorders/100/attachments/scene.jpg` | 磁盘内相对路径 |
| `visibility` | `public` | 访问语义 |
| `original_name` | `现场图.jpg` | 上传原名 |
| `mime_type` | `image/jpeg` | 内容类型 |
| `file_size` | `245760` | 文件大小 |

## 文件管理

### 复制与移动

```go
disk := filesystem.Disk("public")

err := disk.Copy(ctx, "avatars/u1.jpg", "avatars/u1-copy.jpg")
err = disk.Move(ctx, "avatars/u1-copy.jpg", "archive/u1.jpg")
```

> `Copy` 和 `Move` 只能在同一磁盘内操作，跨磁盘操作会返回 `ErrCrossDiskOperation`。

### 删除文件

`Delete` 支持一次删除多个文件：

```go
err := filesystem.Disk("public").Delete(ctx, "avatars/u1.jpg", "avatars/u2.jpg")
```

### 文件元信息

```go
disk := filesystem.Disk("public")

size, err := disk.Size(ctx, "avatars/u1.jpg")
modifiedAt, err := disk.LastModified(ctx, "avatars/u1.jpg")
info, err := disk.LastModifiedInfo(ctx, "avatars/u1.jpg")
mimeType, err := disk.MimeType(ctx, "avatars/u1.jpg")
```

| 接口 | 返回内容 | 使用场景 |
| --- | --- | --- |
| `Size` | 字节数 (`int64`) | 展示附件大小、校验上传结果 |
| `LastModified` | `time.Time` | 缓存控制、排序 |
| `LastModifiedInfo` | `FileInfo` | 同时需要路径、大小、修改时间、Content-Type |
| `MimeType` | MIME 类型字符串 | 判断文件类型；优先从 FileInfo 读取，否则通过内容嗅探 |

`FileInfo` 结构体字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Path` | `string` | 磁盘内相对路径 |
| `Size` | `int64` | 文件大小（字节） |
| `LastModified` | `time.Time` | 最后修改时间 |
| `ContentType` | `string` | MIME 类型 |
| `IsDir` | `bool` | 是否为目录 |

### 文件校验和

`Checksum` 以流式方式计算文件校验和，当前仅支持 SHA-256：

```go
checksum, err := filesystem.Disk("local").Checksum(ctx, "reports/monthly.pdf")
```

通过 `ChecksumOptions` 指定算法（当前仅支持 `sha256`）：

```go
checksum, err := disk.Checksum(ctx, "reports/monthly.pdf", filesystem.ChecksumOptions{
    Algorithm: "sha256",
})
```

### 物理路径

`Path` 返回文件在底层驱动上的物理路径或逻辑定位。本地磁盘返回本地绝对路径，OSS 返回 `oss://bucket/key` 格式：

```go
absolutePath := filesystem.Disk("public").Path("avatars/u1.jpg")
// 本地磁盘: /var/www/storage/app/public/avatars/u1.jpg
// OSS 磁盘: oss://my-bucket/avatars/u1.jpg
```

## 目录操作

```go
disk := filesystem.Disk("public")

// 创建目录
err := disk.MakeDirectory(ctx, "uploads/images")

// 列出当前层文件
files, err := disk.Files(ctx, "uploads")

// 递归列出所有文件
allFiles, err := disk.AllFiles(ctx, "uploads")

// 列出当前层子目录
dirs, err := disk.Directories(ctx, "uploads")

// 递归列出所有子目录
allDirs, err := disk.AllDirectories(ctx, "uploads")

// 删除目录及其下所有文件
err = disk.DeleteDirectory(ctx, "uploads/images")
```

列表返回的都是磁盘内相对路径，不包含本地绝对路径。`DeleteDirectory` 传入空字符串会返回 `ErrEmptyDirectory`，防止误删根目录。

## URL 与临时签名 URL

### 公开 URL

`URL` 为公开文件生成访问地址。仅 `visibility=public` 的磁盘可用：

```go
url, err := filesystem.Disk("public").URL("avatars/u1.jpg")
// https://example.com/storage/avatars/u1.jpg
```

私有磁盘调用 `URL` 会返回 `ErrPublicURLUnavailable`。

### 公开磁盘符号链接

和 Laravel 的 public disk 用法一致，`public` 磁盘通常写入 `storage/app/public`。如果 Web 服务器只暴露 `public` 目录，需要创建一个从 `public/storage` 指向 `storage/app/public` 的符号链接：

```bash
go run . storage:link
```

命令会读取 `config/filesystem.go` 中的 `filesystem.links` 配置。默认骨架配置会创建：

```text
public/storage -> storage/app/public
```

创建后，写入 `public` 磁盘的文件可以通过 `/storage` 访问：

```go
path, err := filesystem.Disk("public").PutFile(ctx, "avatars", file)
url, err := filesystem.Disk("public").URL(path)
// https://example.com/storage/avatars/filename.jpg
```

如果需要公开多个本地目录，可以在 `links` 中增加映射：

```go
"links": map[string]interface{}{
    "public/storage": "storage/app/public",
    "public/images":  "storage/app/images",
},
```

`storage:link` 支持两个选项：

```bash
# 使用相对路径创建符号链接，适合项目目录可能整体迁移的部署环境
go run . storage:link --relative

# 重新创建已经存在的符号链接
go run . storage:link --force
```

`--force` 只会替换已经存在的符号链接。如果链接位置是普通文件或目录，命令会返回错误并保留原路径，避免覆盖用户文件。

删除这些配置过的符号链接：

```bash
go run . storage:unlink
```

`storage:unlink` 会忽略不存在的链接，也只会删除符号链接；普通文件或目录不会被删除。

### 临时签名 URL

`TemporaryURL` 生成短期签名访问地址，适合私有文件下载、导出报表、一次性附件查看：

```go
url, err := filesystem.Disk("local").TemporaryURL(
    ctx,
    "reports/monthly.pdf",
    time.Now().Add(5*time.Minute),
)
```

判断磁盘是否支持临时 URL：

```go
supports := filesystem.Disk("local").ProvidesTemporaryURLs()
```

`TemporaryURL` 的过期时间是绝对时间。过短会导致用户点击下载时已经失效，过长会扩大泄露后的访问窗口。常见取值是 5 到 30 分钟。

本地磁盘需要 `serve=true` 且 `signing_key` 已配置才能生成临时 URL。OSS 驱动始终支持。

### 临时上传 URL

`TemporaryUploadURL` 生成客户端直传的签名上传地址，当前仅 OSS 驱动支持：

```go
result, err := filesystem.Disk("oss").TemporaryUploadURL(
    ctx,
    "uploads/report.pdf",
    time.Now().Add(30*time.Minute),
    filesystem.TemporaryUploadURLOptions{
        ContentType: "application/pdf",
        Visibility:  filesystem.VisibilityPrivate,
        Headers:     map[string]string{"x-custom-header": "value"},
    },
)
// result.URL     — 签名上传地址
// result.Method  — "PUT"
// result.Headers — 需要携带的请求头
// result.Expires — 过期时间
```

判断磁盘是否支持临时上传 URL：

```go
supports := filesystem.Disk("oss").ProvidesTemporaryUploadURLs()
```

`TemporaryUploadURLOptions` 字段说明：

| 字段 | 用途 |
| --- | --- |
| `ContentType` | 上传对象的 MIME 类型 |
| `Visibility` | 上传对象的可见性 |
| `Headers` | 额外需要携带的请求头 |

`TemporaryUploadURLResult` 字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `URL` | `string` | 签名上传地址 |
| `Method` | `string` | HTTP 方法（如 `"PUT"`） |
| `Headers` | `map[string]string` | 客户端上传时需携带的请求头 |
| `Fields` | `map[string]string` | 表单字段（OSS PUT 方式下通常为空） |
| `Expires` | `time.Time` | 链接过期时间 |

### 校验本地签名 URL

框架路由使用 `VerifyTemporaryURL` 校验签名和过期时间，业务自定义下载路由时也可复用：

```go
expires, err := time.Parse(time.RFC3339, c.Query("expires"))
if err != nil {
    return err
}

err = filesystem.VerifyTemporaryURL("local", "reports/monthly.pdf", expires, c.Query("signature"))
```

## 可见性

```go
disk := filesystem.Disk("public")

err := disk.SetVisibility(ctx, "avatars/u1.jpg", filesystem.VisibilityPublic)
visibility, err := disk.GetVisibility(ctx, "avatars/u1.jpg")
```

可见性常量：

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `filesystem.VisibilityPublic` | `"public"` | 文件可直接生成公开访问地址 |
| `filesystem.VisibilityPrivate` | `"private"` | 文件只能通过内部读取或临时签名地址访问 |

注意：

- 本地驱动采用"磁盘级可见性"，不支持单文件级别的可见性切换。
- `public` 磁盘只接受 `public` 语义，`local` 磁盘只接受 `private` 语义。
- OSS 驱动支持单文件级别的可见性切换，通过 ACL 实现。
- 如果同一业务同时需要公开和私有文件，优先拆成两个磁盘，不要在一个本地磁盘里混用语义。

## OSS 驱动

OSS 驱动使用 `github.com/aliyun/aliyun-oss-go-sdk/oss`。配置完整后，业务代码仍然使用同一套 `Disk` API。

常见切换方式：

```dotenv
FILESYSTEM_DISK=oss
FILESYSTEM_CLOUD=oss
```

如果业务代码显式写了 `filesystem.Disk("public")`，则需要把 `public` 磁盘改成 OSS 配置，或把目标磁盘抽成业务配置项。

OSS 驱动的 ACL 映射：

| 可见性 | OSS ACL |
| --- | --- |
| `public` | `oss.ACLPublicRead` |
| 其他 | `oss.ACLPrivate` |

## 自定义 Driver

### 注册 Driver

`github.com/prismgo/framework/filesystem` 支持 Laravel 13 `Storage::extend` 风格的自定义 driver。业务侧需要在 filesystem manager 首次解析前注册 driver 工厂，然后在磁盘配置中使用注册名：

```go
package providers

import "github.com/prismgo/framework/filesystem"

func RegisterFilesystemDrivers() {
    filesystem.Extend("custom", func(ctx filesystem.DriverFactoryContext) (filesystem.Driver, error) {
        return newCustomDriver(ctx.Config.Options)
    })
}
```

配置示例：

```go
cfg := filesystem.Config{
    Default: "custom",
    Disks: map[string]filesystem.DiskConfig{
        "custom": {
            Driver:     "custom",
            Visibility: filesystem.VisibilityPrivate,
            Options: map[string]any{
                "endpoint": "https://storage.example.test",
                "token":    "secret",
            },
        },
    },
}
```

说明：

- 空 driver 名或 nil factory 会被忽略；同名注册会覆盖先前 factory。
- 配置了未注册 driver 时，实际访问磁盘会返回 `ErrUnsupportedDriver`。
- 自定义 driver 和内置 driver 一样按磁盘惰性初始化并缓存；`Manager.Close()` 会调用已创建 driver 的 `Close()`。

### Driver 接口

自定义 driver 必须实现 `filesystem.Driver` 的完整接口：

```go
type Driver interface {
    Close() error
    Write(ctx context.Context, key string, reader io.Reader, opts PutOptions) error
    ReadAll(ctx context.Context, key string) ([]byte, error)
    Open(ctx context.Context, key string) (io.ReadCloser, FileInfo, error)
    Exists(ctx context.Context, key string) (bool, error)
    Delete(ctx context.Context, key string) error
    Copy(ctx context.Context, src, dst string) error
    Move(ctx context.Context, src, dst string) error
    Stat(ctx context.Context, key string) (FileInfo, error)
    List(ctx context.Context, prefix string, recursive bool) ([]FileInfo, error)
    MakeDirectory(ctx context.Context, dir string) error
    DeleteDirectory(ctx context.Context, dir string) error
    Path(key string) string
    URL(key string) (string, error)
    TemporaryURL(ctx context.Context, key string, expiry time.Time) (string, error)
    SetVisibility(ctx context.Context, key, visibility string) error
    GetVisibility(ctx context.Context, key string) (string, error)
}
```

可选扩展接口（通过类型断言自动检测）：

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `directoryExistser` | `DirectoryExists(ctx, dir) (bool, error)` | 高效判断目录存在；未实现时 Repository 会用 `List` 回退 |
| `temporaryURLProvider` | `ProvidesTemporaryURLs() bool` | 声明是否支持临时 URL |
| `temporaryUploadURLDriver` | `ProvidesTemporaryUploadURLs() bool` + `TemporaryUploadURL(...)` | 支持临时上传 URL |

### DriverFactoryContext 字段说明

| 字段 | 说明 |
| --- | --- |
| `Name` | 当前 disk 的配置名称，例如 `"public"`、`"local"` 或业务自定义名称 |
| `Driver` | 标准化后的 driver 名称，例如 `"custom"` |
| `Config` | 当前 disk 的完整配置副本，包含 `Options` 扩展参数 |

## 手动初始化

测试或独立程序可以手动创建 manager：

```go
registry := container.NewContainer()
container.SetProvider(func() *container.Container { return registry })
defer container.SetProvider(nil)

cfg := filesystem.Config{
    Default: "local",
    Cloud:   "oss",
    Disks: map[string]filesystem.DiskConfig{
        "local": {
            Driver:     "local",
            Root:       "storage/app/private",
            URL:        "http://localhost:8051/storage",
            Visibility: filesystem.VisibilityPrivate,
            Serve:      true,
        },
        "public": {
            Driver:     "local",
            Root:       "storage/app/public",
            URL:        "http://localhost:8051/storage",
            Visibility: filesystem.VisibilityPublic,
            Serve:      true,
        },
    },
    TemporaryURL: filesystem.TemporaryURLConfig{
        SigningKey: "local-secret",
    },
}

manager, err := filesystem.NewManager(cfg)
if err != nil {
    return err
}

if err := registry.Instance("filesystem.manager", manager, container.WithCloser(func(m *filesystem.Manager) error {
    return m.Close()
})); err != nil {
    return err
}
defer registry.Close()
```

也可以使用 `NewManagerFromConfig` 从应用配置自动构建：

```go
closeFunc, manager, err := filesystem.NewManagerFromConfig()
if err != nil {
    return err
}
defer closeFunc()
```

## 错误常量

| 错误常量 | 说明 |
| --- | --- |
| `filesystem.ErrDiskNotFound` | 请求的磁盘未注册或管理器未初始化 |
| `filesystem.ErrUnsupportedDriver` | 当前驱动类型尚未实现或未通过 `Extend` 注册 |
| `filesystem.ErrUnsupportedVisibility` | 当前磁盘不支持目标可见性（如本地磁盘尝试切换可见性） |
| `filesystem.ErrPublicURLUnavailable` | 目标文件无法生成公开地址（私有磁盘调用 `URL`） |
| `filesystem.ErrTemporaryURLDisabled` | 当前磁盘未开启临时链接能力（`serve=false` 或未配置签名密钥） |
| `filesystem.ErrTemporaryURLInvalid` | 临时链接参数不合法或已过期 |
| `filesystem.ErrTemporaryUploadURLUnavailable` | 当前磁盘不能生成临时上传链接 |
| `filesystem.ErrCrossDiskOperation` | 跨磁盘复制/移动操作不支持 |
| `filesystem.ErrEmptyDirectory` | 破坏性目录删除收到空目录参数，防止误删根目录 |
| `filesystem.ErrInvalidUploadFile` | 上传文件参数为空，或无法作为 multipart 文件打开 |

## 内置驱动能力矩阵

| 能力 | local | oss |
| --- | --- | --- |
| 读取 (`Get` / `OpenStream`) | 支持 | 支持 |
| 写入 (`Put` / `PutReader`) | 支持 | 支持 |
| 上传 (`PutFile` / `PutFileAs`) | 支持 | 支持 |
| 删除 (`Delete`) | 支持 | 支持 |
| 复制 (`Copy`) | 支持 | 支持（同桶） |
| 移动 (`Move`) | 支持（先复制后删除） | 支持（先复制后删除） |
| 前置/末尾追加 (`Prepend` / `Append`) | 支持 | 支持 |
| 目录判断 (`DirectoryExists`) | 支持（os.Stat） | 支持（前缀对象 + List） |
| 目录列表 (`Files` / `Directories`) | 支持 | 支持 |
| 递归列表 (`AllFiles` / `AllDirectories`) | 支持 | 支持 |
| 公开 URL (`URL`) | 支持（visibility=public 时） | 支持（visibility=public 时） |
| 临时签名 URL (`TemporaryURL`) | 支持（需 serve=true + 签名密钥） | 支持（始终可用） |
| 临时上传 URL (`TemporaryUploadURL`) | 不支持 | 支持（始终可用） |
| 可见性切换 (`SetVisibility` / `GetVisibility`) | 磁盘级固定 | 支持（单文件 ACL） |
| 文件校验和 (`Checksum`) | 支持（SHA-256） | 支持（SHA-256） |
| MIME 类型 (`MimeType`) | 支持 | 支持 |
| JSON 读取 (`JSON`) | 支持 | 支持 |
| 关闭 (`Close`) | 支持（关闭 bucket） | 无操作（SDK 无需显式关闭） |

## 与 Laravel Filesystem 的对应关系

| Laravel 方法 | PrismGo 等价 |
| --- | --- |
| `Storage::disk('public')` | `filesystem.Disk("public")` |
| `Storage::get($path)` | `filesystem.Get(ctx, path)` |
| `Storage::json($path)` | `disk.JSON(ctx, path, &out)` |
| `Storage::put($path, $content)` | `filesystem.Put(ctx, path, content)` |
| `Storage::putFile($dir, $file)` | `disk.PutFile(ctx, dir, file)` |
| `Storage::putFileAs($dir, $file, $name)` | `disk.PutFileAs(ctx, dir, file, name)` |
| `Storage::exists($path)` | `filesystem.Exists(ctx, path)` |
| `Storage::missing($path)` | `disk.Missing(ctx, path)` |
| `Storage::delete($path)` | `filesystem.Delete(ctx, path)` |
| `Storage::copy($from, $to)` | `filesystem.Copy(ctx, from, to)` |
| `Storage::move($from, $to)` | `filesystem.Move(ctx, from, to)` |
| `Storage::prepend($path, $data)` | `disk.Prepend(ctx, path, data)` |
| `Storage::append($path, $data)` | `disk.Append(ctx, path, data)` |
| `Storage::size($path)` | `filesystem.Size(ctx, path)` |
| `Storage::lastModified($path)` | `filesystem.LastModified(ctx, path)` |
| `Storage::mimeType($path)` | `disk.MimeType(ctx, path)` |
| `Storage::checksum($path)` | `disk.Checksum(ctx, path)` |
| `Storage::path($path)` | `filesystem.Path(path)` |
| `Storage::url($path)` | `disk.URL(path)` |
| `Storage::temporaryUrl($path, $ttl)` | `disk.TemporaryURL(ctx, path, expiry)` |
| `Storage::temporaryUploadUrl($path, $ttl)` | `disk.TemporaryUploadURL(ctx, path, expiry)` |
| `Storage::files($dir)` | `disk.Files(ctx, dir)` |
| `Storage::allFiles($dir)` | `disk.AllFiles(ctx, dir)` |
| `Storage::directories($dir)` | `disk.Directories(ctx, dir)` |
| `Storage::allDirectories($dir)` | `disk.AllDirectories(ctx, dir)` |
| `Storage::makeDirectory($dir)` | `disk.MakeDirectory(ctx, dir)` |
| `Storage::deleteDirectory($dir)` | `disk.DeleteDirectory(ctx, dir)` |
| `Storage::setVisibility($path, $vis)` | `disk.SetVisibility(ctx, path, vis)` |
| `Storage::getVisibility($path)` | `disk.GetVisibility(ctx, path)` |
| `Storage::extend($name, $factory)` | `filesystem.Extend(name, factory)` |
| `Storage::build($config)` | `filesystem.NewManager(cfg)` |

## 使用建议

- 公开资源用 `public` 磁盘，私有资源用 `local` 磁盘。
- 业务表保存 `disk + file_path`，接口响应时动态生成 URL。不要把运行时 URL 当成唯一存储字段，因为域名、CDN、OSS 驱动以后都可能变化。
- 大文件下载使用 `OpenStream` 或 `Download`，避免把完整内容一次性读入内存。
- 写入时尽量传 `ContentType`，便于浏览器和对象存储正确识别文件。
- OSS/CDN 切换优先改配置，业务层不要拼接物理路径。
- 临时签名 URL 的过期时间建议 5~30 分钟，过短用户可能来不及访问，过长会扩大泄露风险。
- `DeleteDirectory` 传入空字符串会返回 `ErrEmptyDirectory`，这是有意为之的安全保护。
