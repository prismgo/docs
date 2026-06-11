# 加密

- [简介](#简介)
- [应用密钥](#应用密钥)
- [生成密钥](#生成密钥)
- [密钥格式](#密钥格式)
- [轮换密钥](#轮换密钥)
- [配置参考](#配置参考)

## 简介

PrismGo 的加密组件提供应用级对称加密能力。框架中的加密队列 Payload、加密 Session，以及需要应用密钥的签名能力，都依赖 `app.key`。

当前支持的 cipher 是 `AES-256-GCM`。

## 应用密钥

新项目的 `.env` 默认包含：

```dotenv
APP_KEY=
```

部署生产环境前必须设置 `APP_KEY`。如果 `app.key` 为空，加密器无法创建；依赖加密器的功能会失败。

## 生成密钥

运行：

```bash
go run . key:generate
```

该命令会生成 32 字节随机 key，编码为 Laravel 风格的 `base64:` 格式，并写入 `.env` 的 `APP_KEY=` 行。

只查看新 key，不修改文件：

```bash
go run . key:generate --show
```

覆盖已有 key：

```bash
go run . key:generate --force
```

不要在生产环境随意覆盖 `APP_KEY`。旧密文需要旧 key 才能解密。

## 密钥格式

PrismGo 要求 key 使用以下格式：

```dotenv
APP_KEY=base64:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
```

规则：

| 项 | 要求 |
| --- | --- |
| 前缀 | 必须是 `base64:` |
| 原始 key 长度 | base64 解码后必须是 32 字节 |
| 空白字符 | key 前后或中间不能有空白 |
| cipher | 默认和当前支持值为 `AES-256-GCM` |

## 轮换密钥

轮换密钥时，把旧 key 放入 `APP_PREVIOUS_KEYS`，再设置新的 `APP_KEY`：

```dotenv
APP_KEY=base64:new-current-key
APP_PREVIOUS_KEYS=base64:old-key-one,base64:old-key-two
```

PrismGo 使用当前 `APP_KEY` 加密新数据，并使用 `APP_PREVIOUS_KEYS` 尝试解密旧数据。旧 key 应只保留到旧密文不再需要读取为止。

## 配置参考

| 配置路径 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `app.key` | `APP_KEY` | `""` | 当前应用密钥 |
| `app.cipher` | `APP_CIPHER` | `AES-256-GCM` | 加密算法 |
| `app.previous_keys` | `APP_PREVIOUS_KEYS` | `""` | 逗号分隔的旧应用密钥 |

相关命令见 [命令行：密钥与 Stub 命令](commands.md#密钥与-stub-命令)。

