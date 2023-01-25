# Standalone noobaa-core

Running noobaa-core standalone is useful for development, testing, or deploying in linux without depending on kubernetes, but requires some steps which are described next.

---

## BUILD

### 1. Build Prerequisites

Refer to [builder.Dockerfile](https://github.com/noobaa/noobaa-core/blob/master/src/deploy/NVA_build/builder.Dockerfile)

- python3
- gcc/make
  - included in `dnf group install "Development Tools"`
- nasm
  - on Linux build from source [nasm-2.15.05.tar.gz](https://github.com/netwide-assembler/nasm/archive/nasm-2.15.05.tar.gz) - match the version that appears in `builder.Dockerfile`.
  - on Mac use yasm - `brew install yasm`
- nodejs
  - node version should match the [.nvmrc](https://github.com/noobaa/noobaa-core/blob/master/.nvmrc)
  - consider using [`src/deploy/NVA_build/install_nodejs.sh $(cat .nvmrc)`](https://github.com/noobaa/noobaa-core/blob/master/src/deploy/NVA_build/install_nodejs.sh)

### 2. Build from source

```sh
git clone https://github.com/noobaa/noobaa-core
cd noobaa-core
npm install
npm run build
```

### 3. Quick test

This tool invokes key functionality and should run to completion and not fail:

```sh
node src/tools/coding_speed.js --ec --md5 --sha256 --encode --erase --decode --size 2000
```

---

## DATABASE

Currently noobaa uses postgres 12 from the docker image centos/postgresql-12-centos7.

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
config.DEDUP_ENABLED = false;

config.AGENT_RPC_PROTOCOL = 'tcp';
config.AGENT_RPC_PORT = 9999;
// config.N2N_OFFER_INTERNAL = true;

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

Run as many endpoints as needed across hosts:

```sh
# TODO set database address when on a remote host
npm run s3
```

---

## CONFIGURE

### 1. Get API token

Save to file `.nbtoken` for next calls:

```sh
curl https://localhost:5443/rpc/ -ksd '{
    "api": "auth_api",
    "method": "create_auth",
    "params": {
        "role": "admin",
        "system": "'$(source .env && echo $CREATE_SYS_NAME)'",
        "email": "'$(source .env && echo $CREATE_SYS_EMAIL)'",
        "password": "'$(source .env && echo $CREATE_SYS_PASSWD)'"
    }
}' | jq -r '.reply.token' > .nbtoken
```

### 2. Check token:

```sh
curl https://localhost:5443/rpc/ -ksd '{
    "auth_token": "'$(cat .nbtoken)'",
    "api": "auth_api",
    "method": "read_auth"
}'
```

### 3. Create pool:

```sh
curl https://localhost:5443/rpc/ -ksd '{
    "auth_token": "'$(cat .nbtoken)'",
    "api": "pool_api",
    "method": "create_hosts_pool",
    "params": {
        "name": "nsstore",
        "host_count": 4,
        "is_managed": false
    }
}'
```

### 4. Get bucket tiering policy name

Tier name is bucket+random-suffix so need to read it:

```sh
TIERING=$(
curl https://localhost:5443/rpc/ -ksd '{
    "auth_token": "'$(cat .nbtoken)'",
    "api": "bucket_api",
    "method": "read_bucket",
    "params": { "name": "first.bucket" }
}' | jq -r '.reply.tiering.name'
)
```

### 5. Update tiering policy

Use to set the chunk size:

```sh
curl https://localhost:5443/rpc/ -ksd '{
    "auth_token": "'$(cat .nbtoken)'",
    "api": "tiering_policy_api",
    "method": "update_policy",
    "params": {
        "name": "'${TIERING}'",
        "tiers": [{
            "tier": "'${TIERING}'",
            "order": 0,
            "disabled": false,
            "spillover": false
        }],
        "chunk_split_config": {
            "avg_chunk": '$((256*1024*1024))',
            "delta_chunk": 0
        }
    }
}'
```

### 6. Update tier configuration

Use to disable encryption/compression/checksum, but enable erasure coding:

```sh
curl https://localhost:5443/rpc/ -ksd '{
    "auth_token": "'$(cat .nbtoken)'",
    "api": "tier_api",
    "method": "update_tier",
    "params": {
        "name": "'${TIERING}'",
        "attached_pools": ["nsstore"],
        "data_placement": "SPREAD",
        "chunk_coder_config": {
            "digest_type": "none",
            "frag_digest_type": "none",
            "compress_type": "none",
            "cipher_type": "none",
            "replicas": 1,
            "data_frags": 2,
            "parity_frags": 2,
            "parity_type": "isa-c1"
        }
    }
}'
```

## STORAGE

### Start backingstores

```sh
T=1
mkdir -p noobaa_storage/tape${T}
npm run backingstore -- noobaa_storage/tape${T} --port $((9990+$T))

T=2
mkdir -p noobaa_storage/tape${T}
npm run backingstore -- noobaa_storage/tape${T} --port $((9990+$T))

T=3
mkdir -p noobaa_storage/tape${T}
npm run backingstore -- noobaa_storage/tape${T} --port $((9990+$T))

T=4
mkdir -p noobaa_storage/tape${T}
npm run backingstore -- noobaa_storage/tape${T} --port $((9990+$T))
```

## STATUS

### 1. System status:

```sh
curl https://localhost:5443/rpc/ -ksd '{
    "auth_token": "'$(cat .nbtoken)'",
    "api": "system_api",
    "method": "read_system"
}' | node -e '
    keys = [ "name", "objects", "nodes", "storage", "pools" ];
    a = JSON.parse(fs.readFileSync("/dev/stdin","utf8")).reply;
    b = Object.fromEntries(keys.map(k => [k, a[k]]));
    c = util.inspect(b, { depth:null, colors:true });
    console.log("read_system:", c);
'
```

### 2. Nodes status

```sh
curl https://localhost:5443/rpc/ -ksd '{
    "auth_token": "'$(cat .nbtoken)'",
    "api": "node_api",
    "method": "list_nodes",
    "params": {}
}' | node -e '
    omit = [ "os_info", "latency_to_server", "latency_of_disk_read", "latency_of_disk_write", "geolocation" ];
    a = JSON.parse(fs.readFileSync("/dev/stdin","utf8")).reply;
    a.nodes.forEach(n => omit.forEach(k => delete n[k]));
    b = util.inspect(a, { depth:null, colors:true });
    console.log("list_nodes:", b);
'
```

### 3. Nodes DB query

```sh
npm run db:connect <<EOF
    SELECT
        data->'name' as name,
        data->'storage' as storage,
        TO_TIMESTAMP((data->>'heartbeat')::numeric / 1000) as heartbeat
    FROM nodes;
EOF
```

---

## S3

### Get access and secret keys

```sh
ACCESS_REQ='{
    "auth_token": "'$(cat .nbtoken)'",
    "api": "account_api",
    "method": "read_account",
    "params": { "email": "'$(source .env && echo $CREATE_SYS_EMAIL)'" }
}'
export AWS_ACCESS_KEY_ID=$(curl https://localhost:5443/rpc/ -ksd $ACCESS_REQ | jq -r '.reply.access_keys[0].access_key')
export AWS_SECRET_ACCESS_KEY=$(curl https://localhost:5443/rpc/ -ksd $ACCESS_REQ | jq -r '.reply.access_keys[0].secret_key')
```

```sh
node src/tools/s3cat --endpoint http://localhost:6001
node src/tools/s3cat --endpoint http://localhost:6001 --bucket first.bucket --ls

# upload a random stream (not from file) requires either sig v3 over http, or sig v4 over https.
node src/tools/s3cat --endpoint http://localhost:6001 --sig s3 --bucket first.bucket --put a --size 4096
node src/tools/s3cat --endpoint http://localhost:6001 --sig s3 --bucket first.bucket --upload a --size 4096 --part_size 1024 --concur 4
node src/tools/s3cat --endpoint https://localhost:6443 --selfsigned --bucket first.bucket --put a --size 4096
node src/tools/s3cat --endpoint https://localhost:6443 --selfsigned --bucket first.bucket --upload a --size 4096 --part_size 1024 --concur 4

# read
node src/tools/s3cat --endpoint http://localhost:6001 --sig s3 --bucket first.bucket --get a

aws --endpoint http://localhost:6001 s3 ls
aws --endpoint http://localhost:6001 s3 rm s3://first.bucket/a

ps aux | grep "node src"
du -sh noobaa_storage/
find noobaa_storage -name '*.data' -type f -ls
```


---

## Known Issues

1. core server panics and after it all the backingstores too -

```
Jan-15 2:02:34.345 [Endpoint/51080] [ERROR] CONSOLE:: PANIC: process uncaughtException [RpcError: connection closed ws://192.168.0.41:9999(6yzh7oe0.wkm) reqid 2@ws://192.168.0.41:9999(6yzh7oe0.wkm)] { rpc_code: 'DISCONNECTED', rpc_data: { retryable: true } }
```

```
Jan-15 2:02:35.376 [noobaa-core/51997] [ERROR] Agent.TAPE~/fs3:: heartbeat failed Error: connect ECONNREFUSED ::1:5443
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1300:16)
node:internal/process/promises:288
            triggerUncaughtException(err, true /* fromPromise */);
            ^

Error: connect ECONNREFUSED ::1:5443
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1300:16) {
  errno: -61,
  code: 'ECONNREFUSED',
  syscall: 'connect',
  address: '::1',
  port: 5443
}

Node.js v18.12.1
(exit)
```

---

1. NSFS (port 6001)

```sh
mkdir 'storage.IGNORE'
node src/core nsfs 'storage.IGNORE'
```

2. NSSTORE (port 6002)

```sh
node src/core nsstore 's3://localhost:6001/backingstore-s3-to-nsfs'
node src/core nsstore 'storage.IGNORE/backingstore-fs'
node src/core nsstore \
    --no-dedupe \
    --no-compression  \
    --no-encryption \
    --chunk-size '64MB' \
    --ec '2+2' \
    'storage.IGNORE/tape1' \
    'storage.IGNORE/tape2' \
    'storage.IGNORE/tape3' \
    'storage.IGNORE/tape4'

# backingstores over network
node src/core backingstore 'storage.IGNORE/tape1' --port 6061
node src/core backingstore 'storage.IGNORE/tape2' --port 6062
node src/core backingstore 'storage.IGNORE/tape3' --port 6063
node src/core backingstore 'storage.IGNORE/tape4' --port 6064

node src/core nsstore \
    --no-dedupe \
    --no-compression  \
    --no-encryption \
    --ec '2+2' \
    --chunk-size '64MB' \
    'bs://localhost:6061' \
    'bs://localhost:6062' \
    'bs://localhost:6063' \
    'bs://localhost:6064'
```

3. NSCACHE (port 6003)

```sh
node src/core nscache \
    --hub 's3://localhost:6001/bucket-1' \
    --cache 'storage.IGNORE/cache' \
    --cache-size '1GB'
```

4. NSMERGE (port 6004)

```sh
node src/core nsmerge \
    'storage.IGNORE/bucket-1' \
    's3://localhost:6001/bucket-2'
```

---

CLIENT

```sh
curl -s 'http://localhost:7001/src?prefix=core/&delimiter=/' | xmllint --format - | bat
```

PERF

```sh
node src/tools/s3perf.js --endpoint 'http://localhost:7001' --bucket build --get Release/nb_native.node
```
