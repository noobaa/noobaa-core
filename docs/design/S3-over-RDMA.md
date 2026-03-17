# S3 over RDMA

## Overview

S3 over RDMA is a protocol extension for the AWS S3 HTTP API that enables high-performance, low-latency data transfers using RDMA (Remote Direct Memory Access). Instead of sending object data through the HTTP body, data moves out-of-band via direct memory-to-memory transfers between client and server, while HTTP serves as the control channel for headers, authentication, and metadata.

This approach is based on NVIDIA's RDMA extension to the [aws-c-s3](https://github.com/KiranModukuri/aws-c-s3/tree/nvidia_rdma) client library. The same S3 endpoints can serve both RDMA and non-RDMA clients — a client simply includes an `x-amz-rdma-token` header to propose RDMA, and the server decides per-request whether to accept. Fallback to standard HTTP is automatic and transparent.

NooBaa implements the server side of this protocol, enabling RDMA-capable S3 storage.

## Usage

### Hardware requirements

- RDMA network (100G/200G/400G/800G) — InfiniBand or RoCE
- Compute nodes with optional GPU devices (NVIDIA GPUDirect for GPU memory transfers)
- Storage nodes with NVMe drives (can be same as compute nodes)

### Software requirements

- RHEL9 / Ubuntu22 (or later with RDMA support)
- High performance file system (e.g. GPFS)
- NooBaa with RDMA Support (RPM or Built from source)
- **Client side**: NooBaa `s3perf.js` benchmark tool
- **Client side**: AWS SDK with RDMA support — NVIDIA's fork of [aws-c-s3](https://github.com/KiranModukuri/aws-c-s3/tree/nvidia_rdma)

### Build with RDMA Support

For Server Support - Download and Install `cuobjserver` library from NVIDIA

> https://developer.nvidia.com/cuobjserver-downloads 

For Client Support - Download and Install `cuda-toolkit` from NVIDIA (which includes cuobjclient)

> https://developer.nvidia.com/cuda-downloads

Install common RDMA development libraries and headers

```sh
sudo dnf install -y rdma-core-devel # RHEL/CentOS
sudo apt-get install -y rdma-core # Ubuntu
```

(for RHEL/CentOS check out this install [script](../../src/deploy/RPM_build/install_cuobjserver_rpm.sh))

Build the project as usual. The build will detect cuobjserver, cuobjclient, and CUDA libraries (or some of them) and build S3-RDMA support automatically.

```sh
make
```

RPM build includes RDMA support only for Server side. Since it runs in a container, it does not require installing libraries on the build host.

```
make rpm
```

### Run Server with RDMA Support

Download and Install `cuobjserver` library from NVIDIA (as above).

Create the configuration directory as described in [Getting Started](https://github.com/noobaa/noobaa-core/blob/master/docs/NooBaaNonContainerized/GettingStarted.md#configuration).

Enable and configure RDMA options in `config.json`:

```json
{
  "S3_RDMA_ENABLED": true,
  "S3_RDMA_SERVER_IPS": ["172.16.0.61"],
  "S3_RDMA_LOG_LEVEL": "DEBUG",
  "ALLOW_HTTP": true,
  "ENDPOINT_FORKS": 16
}
```

Start the server:

```bash
node src/cmd/nsfs
```

### Set up Client with RDMA Support

Create a `cuobj.json` file, typically in `/etc/cuobj.json`, and configure the client side IP adresses of the RDMA-capable interfaces to use:

```json
{
  // NOTE : Application can override custom configuration via export CUFILE_ENV_PATH_JSON=<filepath>
  // e.g : export CUFILE_ENV_PATH_JSON="$HOME/cuobj.json"
  "logging": {
    // log directory, if not enabled will create log file under current working directory
    // "dir": "/home/<xxxx>",
    // NOTICE|ERROR|WARN|INFO|DEBUG|TRACE (in decreasing order of severity)
    "level": "ERROR"
  },
  "execution": {
    "parallel_io": false
  },
  "properties": {
    "allow_compat_mode": true,
    "use_pci_p2pdma": true,
    "rdma_peer_type": "dmabuf",
    // client-side rdma addr list for user-space file-systems(e.g ["10.0.1.0", "10.0.2.0"])
    "rdma_dev_addr_list": [ "10.0.0.2" ]
    //32-bit dc key value in hex
    //"rdma_dc_key": "0xffeeddcc",
    //To enable/disable different rdma OPs use the below bit map
    //Bit 0 - If set enables Local RDMA WRITE
    //Bit 1 - If set enables Remote RDMA WRITE
    //Bit 2 - If set enables Remote RDMA READ
    //Bit 3 - If set enables REMOTE RDMA Atomics
    //Bit 4 - If set enables Relaxed ordering.
    //"rdma_access_mask": "0x1f",
  }
}
```

### `s3perf` Benchmark Tool

Use the `s3perf` tool to benchmark RDMA vs HTTP performance. Include the `--rdma` flag to enable RDMA mode and `--cuda` if using GPU buffers.

```bash
# recommended for testing to set a function or alias to avoid repeating
# edit the following example parameters
s3perf() {
  CONFIG_JS_S3_RDMA_ENABLED=true \
  CUFILE_ENV_PATH_JSON="/etc/cuobj.json" \
  CUDA_VISIBLE_DEVICES=0 \
  UV_THREADPOOL_SIZE=128 \
  node src/tools/s3perf.js \
  --local_ip "10.0.0.2" \
  --endpoint http://10.0.0.1:6001 \
  --access_key "AAAAAA" \
  --secret_key "SSSSSS" \
  --bucket bucket1 \
   --time 10 \
  $@
}

# s3-http
s3perf --put --size 8 --concur 64
s3perf --get --size 8 --concur 64

# s3-rdma (CPU buffers)
s3perf --put --size 8 --concur 64 --rdma
s3perf --get --size 8 --concur 64 --rdma

# s3-gpudirect (GPU buffers)
s3perf --put --size 8 --concur 64 --rdma --cuda
s3perf --get --size 8 --concur 64 --rdma --cuda

# grep Final for one line results summary
for size in 1 8 64 512; do
  s3perf --put --size $size --concur 64 --rdma --cuda | grep Final
  s3perf --get --size $size --concur 64 --rdma --cuda | grep Final
done
```


### Configuration options for RDMA

The following options can be set in `config.json` (see [Config File Customizations](../../docs/NooBaaNonContainerized/ConfigFileCustomizations.md)). All require a service restart.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `S3_RDMA_ENABLED` | Boolean | `false` | Enable RDMA support on the S3 endpoint. Must be `true` for the server to accept `x-amz-rdma-token` requests. |
| `S3_RDMA_GPFS_ZERO_COPY_ENABLED` | Boolean | `false` | Enable direct RDMA-to-GPFS zero-copy data path. Requires RDMA to be enabled and a GPFS library with zero-copy support (auto-detected). |
| `S3_RDMA_SERVER_IPS` | Array of strings | `[]` | List of server IP addresses to bind for RDMA transport. Must be IPs on RDMA-capable interfaces. Env variable `S3_RDMA_SERVER_IP` takes precedence over this config key. When empty, RDMA will use the server IP that received the S3 request. |
| `S3_RDMA_LOG_LEVEL` | String | `"INFO"` | RDMA subsystem log level. One of `"ERROR"`, `"INFO"`, or `"DEBUG"`. |
| `S3_RDMA_USE_TELEMETRY` | Boolean | `true` | Enable telemetry/metrics collection for RDMA transfers. |
| `S3_RDMA_DC_KEY` | Number | `0xffeeddcc` | Dynamic Connection (DC) key for RDMA secure communication. Must match between client and server. |
| `S3_RDMA_NUM_DCIS` | Number | `128` | Number of Dynamic Connection Interfaces (DCIs). Controls max concurrent RDMA connections. Increase for higher concurrency workloads. |
| `S3_RDMA_USE_ASYNC_EVENTS` | Boolean | `false` | Use async events instead of thread pool for RDMA operations. Default is `false` because thread pool provides better performance. |
| `S3_RDMA_VALIDATE_TOKEN_HDR` | Boolean | `true` | Enable validation of the `x-amz-rdma-token` header contents before processing RDMA requests. |

### Configuration for RDMA headers compatibility (not needed for standard protocol use)

The following header name configs are provided for troubleshoot interoperability with a specific client implementation and not needed for standard protocol use - as the default values match the headers used by NVIDIA's aws-c-s3 RDMA extension:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `S3_RDMA_AGENT_HDR` | String | `"x-amz-rdma-agent"` | Request header name that identifies the RDMA agent/library type. |
| `S3_RDMA_AGENT_CUOBJ` | String | `"cuobj"` | Expected value in the agent header for cuObject-based clients. |
| `S3_RDMA_TOKEN_HDR` | String | `"x-amz-rdma-token"` | Request header name for the RDMA token. |
| `S3_RDMA_REPLY_HDR` | String | `"x-amz-rdma-reply"` | Response header name for the RDMA reply status code. |
| `S3_RDMA_BYTES_HDR` | String | `"x-amz-rdma-bytes-transferred"` | Response header name for the number of bytes transferred via RDMA. |


## Protocol Design

The protocol is a hybrid HTTP/RDMA scheme. Full details are in the [RDMA Protocol Specification](https://github.com/KiranModukuri/aws-c-s3/blob/nvidia_rdma/RDMA_PROTOCOL_SPEC.md).

### How It Works

1. **Client Proposal** — Client includes `x-amz-rdma-token` in the HTTP request, sets `Content-Length: 0`, and sends an empty HTTP body. Checksums are calculated on the raw buffer data.
2. **Server Decision** — Server may accept RDMA (parse token, perform RDMA read/write) or decline (ignore token, serve via HTTP body).
3. **Data Transfer** — If accepted, data flows out-of-band via RDMA. If declined, data flows through HTTP body as usual.
4. **Response** — Server includes `x-amz-rdma-reply` header indicating result. For GET success, `x-amz-rdma-bytes-transferred` reports byte count.

### Key Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `x-amz-rdma-token` | Request | Opaque, provider-specific token encoding buffer location, size, and access keys for RDMA |
| `x-amz-rdma-reply` | Response | RDMA result code: `200`/`204`/`206` = success, `501` = declined/not supported |
| `x-amz-rdma-bytes-transferred` | Response (GET) | Actual bytes transferred via RDMA |

### Negotiation and Fallback

RDMA is optional and per-request — each request is independently negotiated:

- **RDMA Success** (`x-amz-rdma-reply: 200/204/206`): Data transferred via RDMA. `Content-Length` MUST be `0`.
- **RDMA Declined** (`x-amz-rdma-reply: 501`):
  - **GET**: Server sends data via HTTP body. Client processes normally — no retry needed.
  - **PUT**: Server received no data. Client must retry with data in HTTP body.
- **No RDMA header in response**: Server doesn't support protocol. Client processes HTTP body normally.
- **HTTP 4xx/5xx**: Standard S3 error, handle normally.

### Authentication and Signing

- Client signs the request with an empty HTTP body
- `x-amz-content-sha256` MUST be `UNSIGNED-PAYLOAD`
- `x-amz-rdma-token` MUST be included in the signed headers list
- Payload hash is SHA256 of empty string
- RDMA data is NOT included in the signature (transferred out-of-band)
- `STREAMING-UNSIGNED-PAYLOAD-TRAILER` is NOT used (incompatible with RDMA — no chunked encoding)

### Wire Protocol Details

#### PUT with RDMA

**Request:**
```
PUT /bucket/object HTTP/1.1
Host: s3.example.com
x-amz-rdma-token: <opaque-token>
Content-Length: 0
Content-Type: application/octet-stream
x-amz-checksum-crc32c: i9aeUg==
x-amz-content-sha256: UNSIGNED-PAYLOAD
Authorization: AWS4-HMAC-SHA256 ...

[Empty HTTP body — data read by server via RDMA]
```

Compared to standard HTTP PUT:
- **Added**: `x-amz-rdma-token`
- **Modified**: `Content-Length` set to `0`
- **Removed**: `Content-MD5`, `Transfer-Encoding`, `Content-Encoding: aws-chunked`, `x-amz-decoded-content-length`
- **Preserved**: `x-amz-checksum-*` (calculated on raw buffer, not chunked stream), `Content-Type`, user `Content-Encoding` (e.g. `gzip`)

**Success Response:**
```
HTTP/1.1 200 OK
x-amz-rdma-reply: 200
ETag: "abc123def456"
Content-Length: 0
```

**Declined Response (501):**
```
HTTP/1.1 200 OK
x-amz-rdma-reply: 501
Content-Length: 87
Content-Type: application/xml

<Error>
  <Code>RDMANotSupported</Code>
  <Message>RDMA not available</Message>
</Error>
```
Client must retry with data in HTTP body.

#### GET with RDMA

**Request:**
```
GET /bucket/object HTTP/1.1
Host: s3.example.com
x-amz-rdma-token: <opaque-token>
x-amz-checksum-mode: ENABLED
```

**Success Response:**
```
HTTP/1.1 200 OK
x-amz-rdma-reply: 200
x-amz-rdma-bytes-transferred: 10485760
Content-Length: 0
Content-Type: application/octet-stream
ETag: "abc123"
x-amz-checksum-crc32c: i9aeUg==

[Empty HTTP body — data written to client buffer via RDMA]
```

**Declined Response (501):**
```
HTTP/1.1 200 OK
x-amz-rdma-reply: 501
Content-Length: 10485760
ETag: "abc123"

[HTTP body contains object data]
```
Client processes HTTP body normally — no retry needed.

#### Ranged GET with RDMA

Each range part independently negotiates RDMA with its own token:

```
GET /bucket/object HTTP/1.1
Range: bytes=0-10485759
x-amz-rdma-token: <opaque-token-part1>
```

```
HTTP/1.1 206 Partial Content
x-amz-rdma-reply: 206
x-amz-rdma-bytes-transferred: 10485760
Content-Range: bytes 0-10485759/104857600
Content-Length: 0
```

#### Multipart Upload with RDMA

Each UploadPart independently negotiates RDMA:

```
PUT /bucket/object?partNumber=1&uploadId=xyz HTTP/1.1
x-amz-rdma-token: <opaque-token-for-part1>
Content-Length: 0
x-amz-checksum-crc32c: <part-checksum>
```

```
HTTP/1.1 200 OK
x-amz-rdma-reply: 200
ETag: "part1-etag"
Content-Length: 0
```

Parts can mix RDMA and HTTP within the same multipart upload. `CompleteMultipartUpload` is unchanged.



## References

- [NVIDIA cuObject Library Documentation](https://docs.nvidia.com/gpudirect-storage/cuobject/index.html)
- [RDMA README (aws-c-s3 NVIDIA fork)](https://github.com/KiranModukuri/aws-c-s3/blob/nvidia_rdma/RDMA_README.md) — Implementation architecture and details
- [RDMA Protocol Specification](https://github.com/KiranModukuri/aws-c-s3/blob/nvidia_rdma/RDMA_PROTOCOL_SPEC.md) — Formal wire protocol spec for server implementers
- [aws-c-s3 NVIDIA RDMA branch](https://github.com/KiranModukuri/aws-c-s3/tree/nvidia_rdma) — Source code
- [NooBaa Getting Started (Non-Containerized)](https://github.com/noobaa/noobaa-core/blob/master/docs/NooBaaNonContainerized/GettingStarted.md)
