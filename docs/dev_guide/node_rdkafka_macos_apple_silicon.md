# Installing `node-rdkafka` on macOS (Apple Silicon)

`node-rdkafka` builds native code (librdkafka via `node-gyp`). On Apple Silicon (M1/M2/M3), the build can fail if **OpenSSL** is resolved from the **wrong Homebrew prefix** (Intel `/usr/local` vs ARM64 `/opt/homebrew`), which mixes **x86_64** libraries with an **arm64** link.

## Symptoms

- Link step fails with `required architecture 'arm64'` while OpenSSL paths point at `/usr/local/Cellar/openssl@3/...`
- Warnings such as: `ignoring file '.../libssl.dylib': found architecture 'x86_64', required architecture 'arm64'`
- Followed by many **undefined symbols** for OpenSSL (`_SSL_*`, `_X509_*`, `_EVP_*`, etc.)

## Root cause

The linker builds **arm64** objects but picks up **Intel** `libssl` / `libcrypto` from legacy Homebrew under `/usr/local`. Those `.dylib` files are ignored, so OpenSSL symbols are never resolved.

Common reasons `pkg-config` or the build still sees Intel OpenSSL:

- `PKG_CONFIG_PATH` lists `/usr/local/...` before `/opt/homebrew/...`
- Shell exports (`LDFLAGS`, `CPPFLAGS`, `OPENSSL_*`) pointing at `/usr/local`

## Prerequisites

- [Homebrew](https://brew.sh/) for **Apple Silicon** (install path should be `/opt/homebrew`, not `/usr/local` for the main ARM prefix)
- OpenSSL 3: `brew install openssl@3`
- Build tools: Xcode Command Line Tools (and whatever we already needs for `node-gyp`)

## Verify your toolchain

Run in the same terminal you use for `npm install`:

```bash
which pkg-config
# Expect: /opt/homebrew/bin/pkg-config

file "$(brew --prefix openssl@3)/lib/libssl.dylib"
# Expect: Mach-O ... arm64

pkg-config --cflags --libs openssl
# Expect paths under /opt/homebrew, not /usr/local
```

If `pkg-config --cflags --libs openssl` mentions `/usr/local`, fix `PKG_CONFIG_PATH` or remove Intel entries before installing (see below).

## Fix: point the build at ARM64 OpenSSL

In the shell where you run `npm`, force Homebrew’s ARM64 OpenSSL:

```bash
export CPPFLAGS="-I/opt/homebrew/opt/openssl@3/include"
export LDFLAGS="-L/opt/homebrew/opt/openssl@3/lib"
```

Optionally pin `pkg-config` to the same prefix if needed:

```bash
export PKG_CONFIG_PATH="/opt/homebrew/opt/openssl@3/lib/pkgconfig:${PKG_CONFIG_PATH}"
```

Then reinstall the native module (from the repo root):

```bash
rm -rf node_modules/node-rdkafka
npm install node-rdkafka
```

Or a full reinstall: `rm -rf node_modules ; npm install`) as appropriate for your workflow.

## Optional checks

```bash
echo "$PKG_CONFIG_PATH"
env | grep -i openssl
```

Clear or override any variable that still references `/usr/local/Cellar/openssl` before building.

## References

- [node-rdkafka](https://www.npmjs.com/package/node-rdkafka) (native addon, uses bundled librdkafka build)
- Homebrew [openssl@3](https://formulae.brew.sh/formula/openssl@3)
