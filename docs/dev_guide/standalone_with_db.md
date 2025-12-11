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
make
```

optionally to package everything into a single-executable at build/noobaa-core
```sh
make pkg
```

### 3. Quick test

This tool invokes key functions (e.g erasure coding), and should be able to run to completion without failures:

```sh
node src/tools/coding_speed.js --ec --md5 --encode --erase --decode --size 2000
```

### 4. Build executable inside container

Sometimes it is desireable to build inside a build container in order, for example to avoid having to install prerequisites, or to get a linux x86_64 builds on Mac arm64. To build the executable inside the build container, use the following make command. Notice that the Makefile exposes options to set `CONTAINER_ENGINE` and `CONTAINER_PLATFORM` if needed.

```sh
make executable
```



The created binary is in /tmp/noobaa-core-executable on the container runtime host, e.g for lima use -

```sh
limactl copy 'default:/tmp/noobaa-core-executable/noobaa-core-*' ~/Downloads/
```


---

## DATABASE

Currently noobaa uses postgres 16 from the docker image `postgres:16.11`.
- On Linux - `dnf install postgresql16 postgresql16-server` (might require yum repos)
- On MacOS - `brew install postgresql@16`

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

ENDPOINT_FORKS=4
UV_THREADPOOL_SIZE=64

# replace localhost with the hostname where postgres,web,bg,ha are running
POSTGRES_HOST=localhost
MGMT_ADDR=wss://localhost:5443
BG_ADDR=wss://localhost:5445
HOSTED_AGENTS_ADDR=wss://localhost:5446

EOF
```

```sh
cat >config-local.js <<EOF
/* Copyright (C) 2023 NooBaa */
'use strict';

/** @type {import('./config')} */
const config = exports;

config.DEFAULT_POOL_TYPE = 'HOSTS';
config.AGENT_RPC_PORT = '9999';
config.AGENT_RPC_PROTOCOL = 'tcp';

config.ENDPOINT_HTTP_SERVER_REQUEST_TIMEOUT = 15 * 60 * 1000;
config.ENDPOINT_HTTP_SERVER_KEEPALIVE_TIMEOUT = 1 * 60 * 1000;

// Enable auto tier2 for TMFS buckets
config.BUCKET_AUTOCONF_TIER2_ENABLED = true;
config.BLOCK_STORE_FS_TMFS_ENABLED = true;
config.BLOCK_STORE_FS_MAPPING_INFO_ENABLED = true;

config.DEDUP_ENABLED = false;
config.IO_CALC_MD5_ENABLED = false;
config.IO_CALC_SHA256_ENABLED = false;

config.MAX_OBJECT_PART_SIZE = 1024 * 1024 * 1024;
config.IO_CHUNK_READ_CACHE_SIZE = 1024 * 1024 * 1024;

config.IO_READ_BLOCK_TIMEOUT = 10 * 60 * 1000;
config.IO_WRITE_BLOCK_TIMEOUT = 10 * 60 * 1000;
config.IO_DELETE_BLOCK_TIMEOUT = 10 * 60 * 1000;
config.IO_REPLICATE_BLOCK_TIMEOUT = 10 * 60 * 1000;

config.NODE_IO_DETENTION_DISABLE = true;
config.NODE_IO_DETENTION_THRESHOLD = 0;

config.CHUNK_SPLIT_AVG_CHUNK = 256 * 1024 * 1024;
config.CHUNK_SPLIT_DELTA_CHUNK = 0;

config.CHUNK_CODER_DIGEST_TYPE = 'none';
config.CHUNK_CODER_FRAG_DIGEST_TYPE = 'none';
config.CHUNK_CODER_COMPRESS_TYPE = 'none';
config.CHUNK_CODER_CIPHER_TYPE = 'none';

config.CHUNK_CODER_REPLICAS = 1;
config.CHUNK_CODER_EC_DATA_FRAGS = 2;
config.CHUNK_CODER_EC_PARITY_FRAGS = 2;
config.CHUNK_CODER_EC_PARITY_TYPE = 'cm256';
config.CHUNK_CODER_EC_TOLERANCE_THRESHOLD = 2;
config.CHUNK_CODER_EC_IS_DEFAULT = true;

// bg workers
config.SCRUBBER_ENABLED = false;
config.REBUILD_NODE_ENABLED = false;
config.AGENT_BLOCKS_VERIFIER_ENABLED = false;
config.TIERING_TTL_WORKER_ENABLED = true;
EOF
```

### 2. Various system setting (optional)

You can use the configuration for `rsyslog` and `logrotate` for RHEL8. The logs of the NooBaa shall be stored into `/var/log/noobaa.log` if you make the instruction below. And the log file shall be rotated automatically by the `logrotate`.

```
sudo cp src/deploy/standalone/noobaa_syslog.conf /etc/rsyslog.d/
sudo cp src/deploy/standalone/noobaa-logrotate /etc/logrotate.d/
sudo systemctl restart systemd-journald rsyslog
```

#### 3.1 Additional syslog configuration for RHEL8

Additionally, it would be helpful if you configure to disable the rate limit of the log system.

1. Add the 2 lines below into `/etc/systemd/journald.conf`

```
RateLimitIntervalSec=0s
RateLimitBurst=0
```

2. Add teh 2 lines below into `/etc/rsyslog.conf` (Just after the comment line `#### GLOBAL DIRECTIVES ####`)

```
$imjournalRatelimitInterval 0
$imjournalRatelimitBurst 0
```

3. Restart log system

```
sudo systemctl restart systemd-journald rsyslog
```

### 3. Run core services

These services should run once alongside the database:

```sh
npm run web
npm run bg
```

Hosted agents is a special service needed only for cloud pools:

```sh
npm run hosted_agents
```

### 4. Run endpoints

Running a local endpoint alongside the database and other services is simple:

```sh
npm run s3
```

---

## STORAGE

### Start backingstores

```sh
for i in 1 2 3 4; do mkdir -p storage/backingstores/drive${i}; done
npm -- run backingstore storage/backingstores/drive1 --port 9991
npm -- run backingstore storage/backingstores/drive2 --port 9992
npm -- run backingstore storage/backingstores/drive3 --port 9993
npm -- run backingstore storage/backingstores/drive4 --port 9994
```

### Check storage status

```sh
npm -- run api node sync_monitor_to_store
npm -- run api node aggregate_nodes '{}'
```

### Check local storage

```sh
du -sh storage/backingstores/*
find storage/backingstores -name '*.data' -type f -ls
```

---

## S3 API

### Get access and secret keys

```sh
export AWS_ACCESS_KEY_ID=$(npm -- run api account read_account '{}' --json | tail -1 | jq -r '.access_keys[0].access_key')
export AWS_SECRET_ACCESS_KEY=$(npm -- run api account read_account '{}' --json | tail -1 | jq -r '.access_keys[0].secret_key')
```

### Create bucket

```sh
aws --endpoint http://localhost:6001 s3 mb s3://testbucket
```

### Listing

```sh
node src/tools/s3cat --endpoint http://localhost:6001
node src/tools/s3cat --endpoint http://localhost:6001 --bucket testbucket --ls
aws --endpoint http://localhost:6001 s3 ls
aws --endpoint http://localhost:6001 s3 ls s3://testbucket
```

### Read/Write

```sh
node src/tools/s3cat --endpoint http://localhost:6001 --sig s3 --bucket testbucket --put testobject --size 4096
node src/tools/s3cat --endpoint http://localhost:6001 --sig s3 --bucket testbucket --get testobject
dd if=/dev/zero bs=1M count=1024 | aws --endpoint http://localhost:6001 s3 cp - s3://testbucket/testobject
aws --endpoint http://localhost:6001 s3 cp s3://testbucket/testobject - | xxd -a
aws --endpoint http://localhost:6001 s3 rm s3://testbucket/testobject
```

## Multipart uploads

```sh
node src/tools/s3cat --endpoint http://localhost:6001 --sig s3 --bucket testbucket --upload testobject --size 4096 --part_size 1024 --concur 4
```

### Perf tools

```sh
node src/tools/s3perf --endpoint http://localhost:6001 --sig s3 --bucket testbucket --put s3perf/ --concur 4 --size 128 --size_units MB --time 5
node src/tools/s3perf --endpoint http://localhost:6001 --sig s3 --bucket testbucket --get s3perf/ --concur 4 --size 128 --size_units MB --time 5
```

### Using sigv4 for streaming requires https endpoint 6443 (selfsigned)

```sh
node src/tools/s3cat --endpoint https://localhost:6443 --selfsigned --bucket testbucket --put testobject --size 4096
node src/tools/s3cat --endpoint https://localhost:6443 --selfsigned --bucket testbucket --upload testobject --size 4096 --part_size 1024 --concur 4
```
