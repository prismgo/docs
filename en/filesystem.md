# Filesystem

- [Introduction](#introduction)
- [Configuration](#configuration)
  - [Configuration File](#configuration-file)
  - [Driver Prerequisites](#driver-prerequisites)
  - [Configuration Parameters](#configuration-parameters)
  - [Symbolic Link Configuration](#symbolic-link-configuration)
  - [Disk Configuration Fields](#disk-configuration-fields)
- [Obtaining Disk Instances](#obtaining-disk-instances)
  - [Package-Level Facade](#package-level-facade)
  - [Named Disks](#named-disks)
  - [Cloud Disk](#cloud-disk)
  - [Interface Selection Guide](#interface-selection-guide)
- [Retrieving Files](#retrieving-files)
  - [Reading File Contents](#reading-file-contents)
  - [Reading and Deserializing JSON](#reading-and-deserializing-json)
  - [Streaming Reads](#streaming-reads)
  - [Downloading to a Writer](#downloading-to-a-writer)
  - [Determining File Existence](#determining-file-existence)
  - [Determining Directory Existence](#determining-directory-existence)
- [Storing Files](#storing-files)
  - [Basic Writes](#basic-writes)
  - [Streaming Writes](#streaming-writes)
  - [Prepending and Appending](#prepending-and-appending)
  - [PutOptions Reference](#putoptions-reference)
- [File Uploads](#file-uploads)
  - [PutFile](#putfile)
  - [PutFileAs](#putfileas)
  - [Recommended Database Fields](#recommended-database-fields)
- [File Management](#file-management)
  - [Copying and Moving](#copying-and-moving)
  - [Deleting Files](#deleting-files)
  - [File Metadata](#file-metadata)
  - [File Checksums](#file-checksums)
  - [Physical Paths](#physical-paths)
- [Directories](#directories)
- [URLs and Temporary Signed URLs](#urls-and-temporary-signed-urls)
  - [Public URLs](#public-urls)
  - [Public Disk Symbolic Links](#public-disk-symbolic-links)
  - [Temporary Signed URLs](#temporary-signed-urls)
  - [Temporary Upload URLs](#temporary-upload-urls)
  - [Verifying Local Signed URLs](#verifying-local-signed-urls)
- [Visibility](#visibility)
- [OSS Driver](#oss-driver)
- [Custom Drivers](#custom-drivers)
  - [Registering a Driver](#registering-a-driver)
  - [Driver Interface](#driver-interface)
  - [DriverFactoryContext Fields](#driverfactorycontext-fields)
- [Manual Initialization](#manual-initialization)
- [Error Constants](#error-constants)
- [Built-in Driver Capability Matrix](#built-in-driver-capability-matrix)
- [Laravel Filesystem Mapping](#laravel-filesystem-mapping)
- [Best Practices](#best-practices)

---

`github.com/prismgo/framework/filesystem` provides a Laravel Filesystem / Storage style file storage abstraction. Business code programs against "disk names" and "relative paths" without directly depending on local directories, public directories, or Alibaba Cloud OSS implementations.

All operations explicitly accept `context.Context`, file paths use disk-relative paths, and return values carry `error`.

---

## Introduction

The filesystem uses a `Manager` to manage multiple disks, each exposing read/write operations through a `Repository`. Business code can use package-level facades (e.g., `filesystem.Put`, `filesystem.Get`) directly, or obtain a specific disk's `Repository` instance via `filesystem.Disk("public")`.

Built-in disks:

| Disk | Default Driver | Default Visibility | Use Case |
| --- | --- | --- | --- |
| `local` | `local` | `private` | Private attachments, import/export temp files, files requiring signed access |
| `public` | `local` | `public` | Avatars, covers, work order scene images, public attachments |
| `oss` | `oss` | `private` | Alibaba Cloud OSS, object storage, CDN scenarios |

## Configuration

### Configuration File

The filesystem configuration is centrally registered in `config/filesystem.go`. You can override parameters using environment variables:

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

### Driver Prerequisites

#### Local

Based on `gocloud.dev/blob/fileblob`. No additional dependencies required. Data is stored on the local filesystem; the `root` directory is created automatically at startup. Suitable for private attachments, export reports, and other scenarios that don't require public URLs.

Public files are served via `GET /storage/*path`; temporary signed files are served via `GET /storage-temp/:disk/*path`.

#### OSS

Requires the `github.com/aliyun/aliyun-oss-go-sdk/oss` dependency. Configure `bucket`, `endpoint`, `access_key`, and `secret_key` to get started. The OSS driver natively supports temporary signed URLs and temporary upload URLs.

### Configuration Parameters

#### Top-Level Configuration

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `filesystem.default` | `FILESYSTEM_DISK` | `"local"` | Default disk name. Package-level `filesystem.Put/Get/Exists` use this disk |
| `filesystem.cloud` | `FILESYSTEM_CLOUD` | `"oss"` | Cloud disk alias. Used to express "current cloud storage" in business code |
| `filesystem.temporary_url.signing_key` | `FILESYSTEM_SIGNING_KEY` | `""` (falls back to `app.key`) | Signing key for local temporary URLs |
| `filesystem.links` | — | `{"public/storage": "storage/app/public"}` | Symbolic link mappings used by `storage:link` and `storage:unlink` |

#### Local Disk

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `filesystem.disks.local.driver` | — | `"local"` | Driver type |
| `filesystem.disks.local.root` | `FILESYSTEM_LOCAL_ROOT` | `"storage/app/private"` | Local root directory; all relative paths resolve within this directory |
| `filesystem.disks.local.url` | `FILESYSTEM_LOCAL_URL` | `""` (auto-generated as `APP_URL + "/storage"`) | Public URL prefix |
| `filesystem.disks.local.visibility` | `FILESYSTEM_LOCAL_VISIBILITY` | `"private"` | Disk visibility |
| `filesystem.disks.local.serve` | `FILESYSTEM_LOCAL_SERVE` | `true` | Whether to allow the local disk to be read via signed routes |

#### Public Disk

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `filesystem.disks.public.driver` | — | `"local"` | Driver type |
| `filesystem.disks.public.root` | `FILESYSTEM_PUBLIC_ROOT` | `"storage/app/public"` | Public local disk root directory |
| `filesystem.disks.public.url` | `FILESYSTEM_PUBLIC_URL` | `""` (auto-generated as `APP_URL + "/storage"`) | Public file URL prefix; in production, typically configured as site domain or CDN domain |
| `filesystem.disks.public.visibility` | `FILESYSTEM_PUBLIC_VISIBILITY` | `"public"` | Public disk visibility |
| `filesystem.disks.public.serve` | `FILESYSTEM_PUBLIC_SERVE` | `true` | Whether to allow the framework to serve local public files via `/storage/*path` |

#### OSS Disk

| Parameter Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `filesystem.disks.oss.driver` | — | `"oss"` | Driver type |
| `filesystem.disks.oss.bucket` | `FILESYSTEM_OSS_BUCKET` | `""` | OSS bucket name |
| `filesystem.disks.oss.endpoint` | `FILESYSTEM_OSS_ENDPOINT` | `""` | OSS endpoint, e.g., `oss-cn-hangzhou.aliyuncs.com` |
| `filesystem.disks.oss.access_key` | `FILESYSTEM_OSS_ACCESS_KEY_ID` | `""` | OSS AccessKey ID |
| `filesystem.disks.oss.secret_key` | `FILESYSTEM_OSS_ACCESS_KEY_SECRET` | `""` | OSS AccessKey Secret |
| `filesystem.disks.oss.prefix` | `FILESYSTEM_OSS_PREFIX` | `""` | Unified prefix for all object keys; useful for sharing a bucket across environments |
| `filesystem.disks.oss.url` | `FILESYSTEM_OSS_URL` | `""` | OSS public URL or CDN prefix; if not configured, the URL is generated from bucket/endpoint |
| `filesystem.disks.oss.visibility` | `FILESYSTEM_OSS_VISIBILITY` | `"private"` | OSS default visibility |
| `filesystem.disks.oss.timeout` | `FILESYSTEM_OSS_TIMEOUT` | `30` | OSS client timeout in seconds |

### Symbolic Link Configuration

`filesystem.links` configures symbolic links in the public directory. Each map key is the link path to create, and each value is the target directory:

```go
"links": map[string]interface{}{
    "public/storage": "storage/app/public",
    "public/images":  "storage/app/images",
},
```

Relative paths are resolved from the application base path. The default link exposes files stored in `storage/app/public` through `public/storage` for your web server.

If `filesystem.links` is not configured, `storage:link` uses the default mapping: `public/storage` points to `storage/app/public`.

### Disk Configuration Fields

`DiskConfig` struct fields:

| Field | Applicable Drivers | Description |
| --- | --- | --- |
| `Driver` | All drivers | Selects the underlying implementation; built-in values are `local`, `oss`, or a name registered via `Extend` |
| `Root` | `local` | Local root directory; paths passed by business code resolve within this directory |
| `URL` | `local` / `oss` | Prefix for generating public URLs or local signed URLs |
| `Prefix` | Custom / Object storage | Appends a unified prefix to paths within the disk |
| `Visibility` | All drivers | Default access semantics for the disk: `public` or `private` |
| `Serve` | `local` | Whether to allow the framework's HTTP routes to serve this local disk |
| `OSS` | `oss` | OSS bucket, endpoint, credentials, timeout, and other connection parameters |
| `Options` | Custom driver | Extension parameters passed through to custom drivers |

## Obtaining Disk Instances

### Package-Level Facade

Without specifying a disk, package-level facades use the default disk:

```go
ctx := context.Background()

err := filesystem.Put(ctx, "notes/hello.txt", "hello")
body, err := filesystem.Get(ctx, "notes/hello.txt")
exists, err := filesystem.Exists(ctx, "notes/hello.txt")

_ = body
_ = exists
_ = err
```

### Named Disks

```go
publicDisk := filesystem.Disk("public")
privateDisk := filesystem.Disk("local")

err := publicDisk.Put(ctx, "avatars/u1.jpg", imageData)
```

### Cloud Disk

`Cloud` returns the disk pointed to by `filesystem.cloud` in the configuration, providing a unified way for business code to express "current cloud storage":

```go
cloudDisk := filesystem.Resolve().Cloud()
url, err := cloudDisk.URL("reports/summary.pdf")
```

### Interface Selection Guide

| Scenario | Recommended Interface | Reason |
| --- | --- | --- |
| Business only cares about default storage | `filesystem.Put/Get/Exists` | Similar to Laravel `Storage::put()`; default disk can be switched via configuration |
| File type is explicit, e.g., avatars must be public | `filesystem.Disk("public")` | Prevents public resources from landing on a private disk if the default disk changes |
| Private attachments, export reports | `filesystem.Disk("local")` + `TemporaryURL` | Files don't expose permanent URLs; only short-term access after authorization |
| Uploading form files | `PutFile` / `PutFileAs` | Automatically handles `multipart.FileHeader`, returns a saveable relative path |
| Large file reads or downloads | `OpenStream` / `Download` | Avoids loading entire contents into memory at once |
| Need a new storage backend | `Extend` | Preserves the business-layer `Disk` API unchanged |

## Retrieving Files

### Reading File Contents

`Get` reads the entire file contents into memory, suitable for small files:

```go
body, err := filesystem.Disk("local").Get(ctx, "reports/monthly.pdf")
if err != nil {
    return err
}
_ = body
```

### Reading and Deserializing JSON

`JSON` reads file contents and deserializes into the target struct:

```go
var config AppConfig
if err := filesystem.Disk("local").JSON(ctx, "config/app.json", &config); err != nil {
    return err
}
```

### Streaming Reads

For large files, use `OpenStream`, which returns an `io.ReadCloser` and `FileInfo`:

```go
reader, info, err := filesystem.Disk("local").OpenStream(ctx, "reports/monthly.pdf")
if err != nil {
    return err
}
defer reader.Close()

// Stream directly in Gin response
c.DataFromReader(http.StatusOK, info.Size, info.ContentType, reader, nil)
```

If you don't need `FileInfo`, use `ReadStream`:

```go
reader, err := filesystem.Disk("local").ReadStream(ctx, "reports/monthly.pdf")
if err != nil {
    return err
}
defer reader.Close()
```

### Downloading to a Writer

`Download` copies file contents to any `io.Writer`:

```go
var buf bytes.Buffer
err := filesystem.Disk("local").Download(ctx, "reports/monthly.pdf", &buf)
```

### Determining File Existence

`Exists` checks if a file exists; `Missing` checks if a file does not exist:

```go
exists, err := filesystem.Disk("public").Exists(ctx, "avatars/u1.jpg")
missing, err := filesystem.Disk("public").Missing(ctx, "avatars/u1.jpg")
```

`FileExists` is an alias for `Exists`.

### Determining Directory Existence

```go
exists, err := filesystem.Disk("public").DirectoryExists(ctx, "uploads/images")
```

## Storing Files

### Basic Writes

`Put` supports `string`, `[]byte`, and `io.Reader`. The write path is always a disk-relative path:

```go
err := filesystem.Disk("public").Put(ctx, "notices/readme.txt", "hello", filesystem.PutOptions{
    Visibility:  filesystem.VisibilityPublic,
    ContentType: "text/plain; charset=utf-8",
})
```

### Streaming Writes

For existing streams, use `PutReader`:

```go
err := filesystem.Disk("local").PutReader(ctx, "reports/monthly.csv", reader, filesystem.PutOptions{
    Visibility:  filesystem.VisibilityPrivate,
    ContentType: "text/csv",
})
```

`WriteStream` is an alias for `PutReader`.

### Prepending and Appending

`Prepend` inserts text at the beginning of a file; `Append` adds text at the end. Existing content is separated from new content by a newline. When the file doesn't exist, both behave like `Put`:

```go
// Insert content at the beginning of the file
err := filesystem.Disk("local").Prepend(ctx, "logs/events.log", "2024-01-01 started", filesystem.PutOptions{
    Visibility: filesystem.VisibilityPrivate,
})

// Append content to the end of the file
err = filesystem.Disk("local").Append(ctx, "logs/events.log", "2024-01-01 completed", filesystem.PutOptions{
    Visibility: filesystem.VisibilityPrivate,
})
```

### PutOptions Reference

| Field | Description |
| --- | --- |
| `Visibility` | Specifies the visibility for this write. Built-in local drivers use disk-level visibility, so this should match the disk configuration |
| `ContentType` | MIME type of the written object. OSS uses this for object metadata; local streaming downloads pass it to HTTP responses |

Path parameters must be disk-relative paths, e.g., `avatars/u1.jpg`. Do not pass local absolute paths or concatenate `storage/app/...` in business code, as this breaks driver switchability.

## File Uploads

### PutFile

`PutFile` saves an uploaded file using its original filename and returns the final relative path:

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

`PutFileAs` saves an uploaded file with a specified filename:

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

### Recommended Database Fields

| Field | Example | Description |
| --- | --- | --- |
| `disk` | `public` | Disk where the file is stored |
| `file_path` | `workorders/100/attachments/scene.jpg` | Disk-relative path |
| `visibility` | `public` | Access semantics |
| `original_name` | `scene.jpg` | Original upload filename |
| `mime_type` | `image/jpeg` | Content type |
| `file_size` | `245760` | File size in bytes |

## File Management

### Copying and Moving

```go
disk := filesystem.Disk("public")

err := disk.Copy(ctx, "avatars/u1.jpg", "avatars/u1-copy.jpg")
err = disk.Move(ctx, "avatars/u1-copy.jpg", "archive/u1.jpg")
```

> `Copy` and `Move` only work within the same disk. Cross-disk operations return `ErrCrossDiskOperation`.

### Deleting Files

`Delete` supports deleting multiple files at once:

```go
err := filesystem.Disk("public").Delete(ctx, "avatars/u1.jpg", "avatars/u2.jpg")
```

### File Metadata

```go
disk := filesystem.Disk("public")

size, err := disk.Size(ctx, "avatars/u1.jpg")
modifiedAt, err := disk.LastModified(ctx, "avatars/u1.jpg")
info, err := disk.LastModifiedInfo(ctx, "avatars/u1.jpg")
mimeType, err := disk.MimeType(ctx, "avatars/u1.jpg")
```

| Method | Returns | Use Case |
| --- | --- | --- |
| `Size` | Bytes (`int64`) | Display attachment size, verify upload results |
| `LastModified` | `time.Time` | Cache control, sorting |
| `LastModifiedInfo` | `FileInfo` | When you need path, size, modification time, and Content-Type together |
| `MimeType` | MIME type string | Determine file type; reads from FileInfo first, then falls back to content sniffing |

`FileInfo` struct fields:

| Field | Type | Description |
| --- | --- | --- |
| `Path` | `string` | Disk-relative path |
| `Size` | `int64` | File size in bytes |
| `LastModified` | `time.Time` | Last modification time |
| `ContentType` | `string` | MIME type |
| `IsDir` | `bool` | Whether the entry is a directory |

### File Checksums

`Checksum` computes a file checksum in a streaming manner. Currently only SHA-256 is supported:

```go
checksum, err := filesystem.Disk("local").Checksum(ctx, "reports/monthly.pdf")
```

Specify the algorithm via `ChecksumOptions` (currently only `sha256` is supported):

```go
checksum, err := disk.Checksum(ctx, "reports/monthly.pdf", filesystem.ChecksumOptions{
    Algorithm: "sha256",
})
```

### Physical Paths

`Path` returns the physical path or logical location of a file on the underlying driver. Local disks return local absolute paths; OSS returns the `oss://bucket/key` format:

```go
absolutePath := filesystem.Disk("public").Path("avatars/u1.jpg")
// Local disk: /var/www/storage/app/public/avatars/u1.jpg
// OSS disk: oss://my-bucket/avatars/u1.jpg
```

## Directories

```go
disk := filesystem.Disk("public")

// Create a directory
err := disk.MakeDirectory(ctx, "uploads/images")

// List files in the current level
files, err := disk.Files(ctx, "uploads")

// Recursively list all files
allFiles, err := disk.AllFiles(ctx, "uploads")

// List subdirectories in the current level
dirs, err := disk.Directories(ctx, "uploads")

// Recursively list all subdirectories
allDirs, err := disk.AllDirectories(ctx, "uploads")

// Delete a directory and all files within it
err = disk.DeleteDirectory(ctx, "uploads/images")
```

List methods return disk-relative paths, not local absolute paths. Passing an empty string to `DeleteDirectory` returns `ErrEmptyDirectory` to prevent accidental deletion of the root directory.

## URLs and Temporary Signed URLs

### Public URLs

`URL` generates a public access address for a file. Only available for disks with `visibility=public`:

```go
url, err := filesystem.Disk("public").URL("avatars/u1.jpg")
// https://example.com/storage/avatars/u1.jpg
```

Calling `URL` on a private disk returns `ErrPublicURLUnavailable`.

### Public Disk Symbolic Links

Like Laravel's public disk workflow, PrismGo's `public` disk typically writes files to `storage/app/public`. If your web server only serves the `public` directory, create a symbolic link from `public/storage` to `storage/app/public`:

```bash
go run . storage:link
```

The command reads the `filesystem.links` configuration in `config/filesystem.go`. The default application skeleton creates:

```text
public/storage -> storage/app/public
```

After the link exists, files written to the `public` disk can be accessed through `/storage`:

```go
path, err := filesystem.Disk("public").PutFile(ctx, "avatars", file)
url, err := filesystem.Disk("public").URL(path)
// https://example.com/storage/avatars/filename.jpg
```

To expose additional local directories, add them to `links`:

```go
"links": map[string]interface{}{
    "public/storage": "storage/app/public",
    "public/images":  "storage/app/images",
},
```

`storage:link` supports two options:

```bash
# Create the symbolic link using relative paths, useful when the whole project directory may move
go run . storage:link --relative

# Recreate existing symbolic links
go run . storage:link --force
```

`--force` only replaces existing symbolic links. If the link path is a regular file or directory, the command returns an error and leaves that path untouched.

To delete the configured symbolic links:

```bash
go run . storage:unlink
```

`storage:unlink` ignores missing links and only removes symbolic links; regular files and directories are not deleted.

### Temporary Signed URLs

`TemporaryURL` generates a short-lived signed access address, suitable for private file downloads, export reports, and one-time attachment viewing:

```go
url, err := filesystem.Disk("local").TemporaryURL(
    ctx,
    "reports/monthly.pdf",
    time.Now().Add(5*time.Minute),
)
```

Check if a disk supports temporary URLs:

```go
supports := filesystem.Disk("local").ProvidesTemporaryURLs()
```

The expiry time for `TemporaryURL` is an absolute time. Too short and the URL may expire before the user clicks it; too long and the access window after a leak widens. Common values are 5 to 30 minutes.

Local disks require `serve=true` and a configured signing key to generate temporary URLs. The OSS driver always supports them.

### Temporary Upload URLs

`TemporaryUploadURL` generates a signed upload address for client-side direct uploads. Currently only the OSS driver supports this:

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
// result.URL     — Signed upload URL
// result.Method  — "PUT"
// result.Headers — Required request headers
// result.Expires — Expiration time
```

Check if a disk supports temporary upload URLs:

```go
supports := filesystem.Disk("oss").ProvidesTemporaryUploadURLs()
```

`TemporaryUploadURLOptions` fields:

| Field | Description |
| --- | --- |
| `ContentType` | MIME type of the uploaded object |
| `Visibility` | Visibility of the uploaded object |
| `Headers` | Additional request headers to include |

`TemporaryUploadURLResult` fields:

| Field | Type | Description |
| --- | --- | --- |
| `URL` | `string` | Signed upload URL |
| `Method` | `string` | HTTP method (e.g., `"PUT"`) |
| `Headers` | `map[string]string` | Request headers the client must include when uploading |
| `Fields` | `map[string]string` | Form fields (typically empty for OSS PUT-style uploads) |
| `Expires` | `time.Time` | URL expiration time |

### Verifying Local Signed URLs

The framework's routes use `VerifyTemporaryURL` to verify signatures and expiration. You can also reuse it in custom download routes:

```go
expires, err := time.Parse(time.RFC3339, c.Query("expires"))
if err != nil {
    return err
}

err = filesystem.VerifyTemporaryURL("local", "reports/monthly.pdf", expires, c.Query("signature"))
```

## Visibility

```go
disk := filesystem.Disk("public")

err := disk.SetVisibility(ctx, "avatars/u1.jpg", filesystem.VisibilityPublic)
visibility, err := disk.GetVisibility(ctx, "avatars/u1.jpg")
```

Visibility constants:

| Constant | Value | Description |
| --- | --- | --- |
| `filesystem.VisibilityPublic` | `"public"` | Files can directly generate public access URLs |
| `filesystem.VisibilityPrivate` | `"private"` | Files can only be accessed via internal reads or temporary signed URLs |

Notes:

- Local drivers use "disk-level visibility" and do not support per-file visibility switching.
- The `public` disk only accepts `public` semantics; the `local` disk only accepts `private` semantics.
- The OSS driver supports per-file visibility switching via ACL.
- If the same business needs both public and private files, prefer splitting them into two disks rather than mixing semantics within a single local disk.

## OSS Driver

The OSS driver uses `github.com/aliyun/aliyun-oss-go-sdk/oss`. Once configured, business code still uses the same `Disk` API.

Common switching approach:

```dotenv
FILESYSTEM_DISK=oss
FILESYSTEM_CLOUD=oss
```

If business code explicitly uses `filesystem.Disk("public")`, you need to change the `public` disk to an OSS configuration, or make the target disk a business configuration item.

OSS driver ACL mapping:

| Visibility | OSS ACL |
| --- | --- |
| `public` | `oss.ACLPublicRead` |
| Other | `oss.ACLPrivate` |

## Custom Drivers

### Registering a Driver

`github.com/prismgo/framework/filesystem` supports Laravel 13 `Storage::extend` style custom drivers. Register the driver factory before the filesystem manager is first resolved, then use the registered name in disk configuration:

```go
package providers

import "github.com/prismgo/framework/filesystem"

func RegisterFilesystemDrivers() {
    filesystem.Extend("custom", func(ctx filesystem.DriverFactoryContext) (filesystem.Driver, error) {
        return newCustomDriver(ctx.Config.Options)
    })
}
```

Configuration example:

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

Notes:

- Empty driver names or nil factories are ignored; re-registering with the same name overwrites the previous factory.
- Configuring an unregistered driver returns `ErrUnsupportedDriver` when the disk is actually accessed.
- Custom drivers are lazily initialized and cached per disk, just like built-in drivers; `Manager.Close()` calls `Close()` on all created drivers.

### Driver Interface

Custom drivers must implement the complete `filesystem.Driver` interface:

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

Optional extension interfaces (auto-detected via type assertion):

| Interface | Method | Description |
| --- | --- | --- |
| `directoryExistser` | `DirectoryExists(ctx, dir) (bool, error)` | Efficiently check directory existence; if not implemented, Repository falls back to `List` |
| `temporaryURLProvider` | `ProvidesTemporaryURLs() bool` | Declares whether temporary URLs are supported |
| `temporaryUploadURLDriver` | `ProvidesTemporaryUploadURLs() bool` + `TemporaryUploadURL(...)` | Supports temporary upload URLs |

### DriverFactoryContext Fields

| Field | Description |
| --- | --- |
| `Name` | Configuration name of the current disk, e.g., `"public"`, `"local"`, or a custom name |
| `Driver` | Normalized driver name, e.g., `"custom"` |
| `Config` | Complete configuration copy of the current disk, including `Options` extension parameters |

## Manual Initialization

For tests or standalone programs, you can manually create a manager:

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

You can also use `NewManagerFromConfig` to build from application configuration automatically:

```go
closeFunc, manager, err := filesystem.NewManagerFromConfig()
if err != nil {
    return err
}
defer closeFunc()
```

## Error Constants

| Error Constant | Description |
| --- | --- |
| `filesystem.ErrDiskNotFound` | The requested disk is not registered or the manager is not initialized |
| `filesystem.ErrUnsupportedDriver` | The driver type is not implemented or not registered via `Extend` |
| `filesystem.ErrUnsupportedVisibility` | The current disk does not support the target visibility (e.g., local disk attempting to switch visibility) |
| `filesystem.ErrPublicURLUnavailable` | The target file cannot generate a public URL (private disk calling `URL`) |
| `filesystem.ErrTemporaryURLDisabled` | The current disk has temporary URL capability disabled (`serve=false` or signing key not configured) |
| `filesystem.ErrTemporaryURLInvalid` | Temporary URL parameters are invalid or expired |
| `filesystem.ErrTemporaryUploadURLUnavailable` | The current disk cannot generate temporary upload URLs |
| `filesystem.ErrCrossDiskOperation` | Cross-disk copy/move operations are not supported |
| `filesystem.ErrEmptyDirectory` | Destructive directory deletion received an empty directory argument, preventing accidental root deletion |
| `filesystem.ErrInvalidUploadFile` | Upload file parameter is nil or cannot be opened as a multipart file |

## Built-in Driver Capability Matrix

| Capability | local | oss |
| --- | --- | --- |
| Read (`Get` / `OpenStream`) | Yes | Yes |
| Write (`Put` / `PutReader`) | Yes | Yes |
| Upload (`PutFile` / `PutFileAs`) | Yes | Yes |
| Delete (`Delete`) | Yes | Yes |
| Copy (`Copy`) | Yes (same bucket) | Yes (same bucket) |
| Move (`Move`) | Yes (copy then delete) | Yes (copy then delete) |
| Prepend/Append (`Prepend` / `Append`) | Yes | Yes |
| Directory check (`DirectoryExists`) | Yes (os.Stat) | Yes (prefix object + List) |
| Directory listing (`Files` / `Directories`) | Yes | Yes |
| Recursive listing (`AllFiles` / `AllDirectories`) | Yes | Yes |
| Public URL (`URL`) | Yes (when visibility=public) | Yes (when visibility=public) |
| Temporary signed URL (`TemporaryURL`) | Yes (requires serve=true + signing key) | Yes (always available) |
| Temporary upload URL (`TemporaryUploadURL`) | No | Yes (always available) |
| Visibility switching (`SetVisibility` / `GetVisibility`) | Disk-level fixed | Yes (per-file ACL) |
| File checksum (`Checksum`) | Yes (SHA-256) | Yes (SHA-256) |
| MIME type (`MimeType`) | Yes | Yes |
| JSON read (`JSON`) | Yes | Yes |
| Close (`Close`) | Yes (closes bucket) | No-op (SDK doesn't require explicit close) |

## Laravel Filesystem Mapping

| Laravel Method | PrismGo Equivalent |
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

## Best Practices

- Use the `public` disk for public resources and the `local` disk for private resources.
- Store `disk + file_path` in database tables; generate URLs dynamically in API responses. Don't store runtime URLs as the sole field, as domains, CDN, and OSS drivers may change over time.
- Use `OpenStream` or `Download` for large file downloads to avoid loading entire contents into memory.
- Always pass `ContentType` when writing to help browsers and object storage correctly identify files.
- Prefer changing configuration when switching between OSS/CDN; don't concatenate physical paths in business code.
- Set temporary signed URL expiration to 5–30 minutes; too short and users may not access in time, too long and the risk window after a leak increases.
- Passing an empty string to `DeleteDirectory` returns `ErrEmptyDirectory` — this is an intentional safety protection.
