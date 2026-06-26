---
title: "Encryption"
---

# Encryption

- [Introduction](#introduction)
- [Application Key](#application-key)
- [Generating a Key](#generating-a-key)
- [Key Format](#key-format)
- [Rotating Keys](#rotating-keys)
- [Configuration Reference](#configuration-reference)

## Introduction

PrismGo's encryption component provides application-level symmetric encryption. Encrypted queue payloads, encrypted sessions, and signing features that need an application key depend on `app.key`.

The currently supported cipher is `AES-256-GCM`.

## Application Key

New projects include this in `.env`:

```dotenv
APP_KEY=
```

Set `APP_KEY` before deploying to production. If `app.key` is empty, the encrypter cannot be created and features that depend on encryption will fail.

## Generating a Key

Run:

```bash
go run . key:generate
```

This command generates 32 random bytes, encodes them in Laravel-style `base64:` format, and writes the value to the `APP_KEY=` line in `.env`.

Print a new key without editing files:

```bash
go run . key:generate --show
```

Overwrite an existing key:

```bash
go run . key:generate --force
```

Do not casually overwrite `APP_KEY` in production. Old ciphertext requires the old key to decrypt.

## Key Format

PrismGo requires this format:

```dotenv
APP_KEY=base64:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
```

Rules:

| Item | Requirement |
| --- | --- |
| Prefix | Must be `base64:` |
| Raw key length | Must decode to exactly 32 bytes |
| Whitespace | No leading, trailing, or embedded whitespace |
| Cipher | Default and currently supported value is `AES-256-GCM` |

## Rotating Keys

When rotating keys, put old keys in `APP_PREVIOUS_KEYS` and set the new `APP_KEY`:

```dotenv
APP_KEY=base64:new-current-key
APP_PREVIOUS_KEYS=base64:old-key-one,base64:old-key-two
```

PrismGo encrypts new data with the current `APP_KEY` and tries `APP_PREVIOUS_KEYS` when decrypting old data. Keep old keys only as long as old ciphertext must remain readable.

## Configuration Reference

| Config Path | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `app.key` | `APP_KEY` | `""` | Current application key |
| `app.cipher` | `APP_CIPHER` | `AES-256-GCM` | Encryption algorithm |
| `app.previous_keys` | `APP_PREVIOUS_KEYS` | `""` | Comma-separated old application keys |

See [Commands: Key and Stub Commands](commands.md#key-and-stub-commands).

