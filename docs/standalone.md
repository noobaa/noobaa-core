# Standalone noobaa-core

Running noobaa-core standalone is useful for development, testing, or deploying in linux without depending on kubernetes, but requires some steps which are described next.

---

## BUILD

### 1. Build Prerequisites

In general, the build prereqs for Linux are maintained in the builder container image - see [builder.Dockerfile](https://github.com/noobaa/noobaa-core/blob/master/src/deploy/NVA_build/builder.Dockerfile)

- [nodejs](https://nodejs.org)
  - `node --version` should match the version in [cat .nvmrc](https://github.com/noobaa/noobaa-core/blob/master/.nvmrc)
  - consider using `src/deploy/NVA_build/install_nodejs.sh $(cat .nvmrc)` [see](https://github.com/noobaa/noobaa-core/blob/master/src/deploy/NVA_build/install_nodejs.sh)
- [node-gyp](https://github.com/nodejs/node-gyp) prereqs
  - On [Linux](https://github.com/nodejs/node-gyp#on-unix) - python3, make, gcc (e.g `dnf group install "Development Tools"`)
  - On [MacOS](https://github.com/nodejs/node-gyp#on-macos) - python3, make, clang (from `XCode Command Line Tools`)
- assembler
  - nasm on Linux - build from source [nasm-2.15.05.tar.gz](https://github.com/netwide-assembler/nasm/archive/nasm-2.15.05.tar.gz) (match the version and steps in latest `builder.Dockerfile`).
  - yasm on MacOS - `brew install yasm`

### 2. Build from source

```sh
git clone https://github.com/noobaa/noobaa-core
cd noobaa-core
npm install
npm run build
```

### 3. Quick test

This tool invokes key functions (e.g erasure coding), and should be able to run to completion without failures:

```sh
node src/tools/coding_speed.js --ec --md5 --encode --erase --decode --size 2000
```

---

## DATABASE

Currently noobaa uses postgres 12 from the docker image `centos/postgresql-12-centos7`.
- On Linux - `dnf install postgresql12 postgresql12-server` (might require yum repos)
- On MacOS - `brew install postgresql@12`

### 1. Init database directory

```sh
npm run db:init
```

### 2. Run foreground database

```sh
npm run db
```

### 3. Create database, user, and permissions

```sh
npm run db:create
```

### 4. Test connection

```sh
echo '\l+ nbcore' | npm run db:connect
```

---

## SERVICES

### 1. Environment

```sh
cat >.env <<EOF
CREATE_SYS_NAME=noobaa
CREATE_SYS_EMAIL=admin@noobaa.io
CREATE_SYS_PASSWD=123456789
JWT_SECRET=123456789
NOOBAA_ROOT_SECRET='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
LOCAL_MD_SERVER=true
EOF
```

```sh
cat >config-local.js <<EOF
/* Copyright (C) 2023 NooBaa */
'use strict';
const config = require('./config');

config.MAX_OBJECT_PART_SIZE = 1024 * 1024 * 1024;
config.IO_CHUNK_READ_CACHE_SIZE = 4 * 1024 * 1024 * 1024;
config.CHUNK_SPLIT_AVG_CHUNK = 256 * 1024 * 1024;
config.CHUNK_SPLIT_DELTA_CHUNK = 0;
config.CHUNK_CODER_DIGEST_TYPE = 'none';
config.CHUNK_CODER_FRAG_DIGEST_TYPE = 'none';
config.CHUNK_CODER_COMPRESS_TYPE = 'none';
config.CHUNK_CODER_CIPHER_TYPE = 'none';
config.CHUNK_CODER_REPLICAS = 1;
config.CHUNK_CODER_EC_DATA_FRAGS = 2;
config.CHUNK_CODER_EC_PARITY_FRAGS = 2;
config.CHUNK_CODER_EC_PARITY_TYPE = 'isa-c1';
config.CHUNK_CODER_EC_TOLERANCE_THRESHOLD = 2;
config.CHUNK_CODER_EC_IS_DEFAULT = true;
config.DEDUP_ENABLED = false;
config.IO_CALC_MD5_ENABLED = false;
config.IO_CALC_SHA256_ENABLED = false;

config.AGENT_RPC_PROTOCOL = 'tcp';
config.AGENT_RPC_PORT = '9999';

// bg workers
config.SCRUBBER_ENABLED = false;
config.REBUILD_NODE_ENABLED = false;
config.AWS_METERING_ENABLED = false;
config.AGENT_BLOCKS_VERIFIER_ENABLED = false;
EOF
```

### 2. Run core services

These services should run once alongside the database:

```sh
npm run web
npm run bg
```

Hosted agents is a special service needed only for cloud pools:

```sh
npm run hosted_agents
```

### 2. Run endpoints

Running a local endpoint alongside the database and other services is simple:

```sh
npm run s3
```

In order to enable multiple forks of the endpoint serving on the same port use:

```sh
ENDPOINT_FORKS=4 npm run s3
```

For remote hosts, need to specify the addresses:

```sh
POSTGRES_HOST=ip \
  MGMT_ADDR=wss://ip:5443 \
  BG_ADDR=wss://ip:5445 \
  HOSTED_AGENTS_ADDR=wss://ip:5446 \
  npm run s3
```

---

## STORAGE

### Start backingstores

```sh
for i in 1 2 3 4; do mkdir -p noobaa_storage/drive${i}; done
npm run backingstore -- noobaa_storage/drive1 --port 9991
npm run backingstore -- noobaa_storage/drive2 --port 9992
npm run backingstore -- noobaa_storage/drive3 --port 9993
npm run backingstore -- noobaa_storage/drive4 --port 9994
```

### Check storage status

```sh
node src/bin/api node_api sync_monitor_to_store
node src/bin/api node_api aggregate_nodes '{}'
```

### Check local storage

```sh
du -sh noobaa_storage/
find noobaa_storage -name '*.data' -type f -ls
```

---

## S3 API

### Get access and secret keys

```sh
export AWS_ACCESS_KEY_ID=$(node src/bin/api account_api read_account '{}' --json | jq -r '.access_keys[0].access_key')
export AWS_SECRET_ACCESS_KEY=$(node src/bin/api account_api read_account '{}' --json | jq -r '.access_keys[0].secret_key')
```

### Listing

```sh
node src/tools/s3cat --endpoint http://localhost:6001
node src/tools/s3cat --endpoint http://localhost:6001 --bucket first.bucket --ls
aws --endpoint http://localhost:6001 s3 ls
aws --endpoint http://localhost:6001 s3 ls s3://first.bucket
```

### Create bucket

```sh
aws --endpoint http://localhost:6001 s3 mb s3://lala
```

### Read/Write

```sh
node src/tools/s3cat --endpoint http://localhost:6001 --sig s3 --bucket first.bucket --put ggg --size 4096
node src/tools/s3cat --endpoint http://localhost:6001 --sig s3 --bucket first.bucket --get ggg
dd if=/dev/zero bs=1M count=1024 | aws --endpoint http://localhost:6001 s3 cp - s3://first.bucket/ggg
aws --endpoint http://localhost:6001 s3 cp s3://first.bucket/ggg - | xxd -a
aws --endpoint http://localhost:6001 s3 rm s3://first.bucket/ggg
```

## Multipart uploads

```sh
node src/tools/s3cat --endpoint http://localhost:6001 --sig s3 --bucket first.bucket --upload ggg --size 4096 --part_size 1024 --concur 4 
```

### Perf tools

```sh
node src/tools/s3perf --endpoint http://localhost:6001 --sig s3 --bucket first.bucket --put s3perf/ --concur 4 --size 128 --size_units MB --time 5
node src/tools/s3perf --endpoint http://localhost:6001 --sig s3 --bucket first.bucket --get s3perf/ --concur 4 --size 128 --size_units MB --time 5
```

### Using sigv4 for streaming requires https endpoint 6443 (selfsigned)

```sh
node src/tools/s3cat --endpoint https://localhost:6443 --selfsigned --bucket first.bucket --put ggg --size 4096
node src/tools/s3cat --endpoint https://localhost:6443 --selfsigned --bucket first.bucket --upload ggg --size 4096 --part_size 1024 --concur 4
```
