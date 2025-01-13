# S3 over RDMA (EXPERIMENTAL)

## Overview

S3 over RDMA is a new technology that enhances I/O performance directly to the applications memory, or directly to GPU memory! RDMA is extremely efficient, it bypasses the operating system, TCP stack, and much of the networking CPU overhead. Layering S3 on top of RDMA fits like a glove for modern applications. And the same endpoints can serve both RDMA and non-RDMA clients with a simple HTTP header.

This feature is still EXPERIMENTAL and is not yet available for production use. This document outlines the usage and design of this feature.

## What is needed to use S3 over RDMA?

Hardware:
- High performance RDMA network 100G/.../800G
- Infiniband or RoCE (must support DC transport)
- Compute Nodes with optional GPU devices and NVIDIA CUDA toolkit
- Storage Nodes with NVMe drives, can be same as compute nodes

Software:
- RHEL / UBUNTU
- High performance file system (e.g GPFS)
- NooBaa RPM / build from source with RDMA support.
- NVIDIA's cuObject (beta) and cuFile RDMA libraries.


## Which applications can benefit from S3 over RDMA?

- boto3 - S3 sdk for python applications
- s3-connector-for-pytorch - library for AI/ML applications (data loaders, checkpoints, etc.)
- rclone - a standalone CLI that can copy data between files/dirs and S3
- nodejs - using aws-sdk-js-v3 to store data collected from web services
- (share with us your use case and we will add to the list...)

## Lets dig right in

- Clone the noobaa-core repository
- Install the required dependencies (nodejs, nasm, etc. - see the noobaa-core README)
- Standard build - simple `make` should succeed.

Build the project with RDMA support:

```bash
$ make RDMA=1
```

or with RDMA and CUDA support:

```bash
$ make RDMA=1 CUDA=1
```

Define the following runtime variables:

```bash
CUDA_PATH="$(realpath /usr/local/cuda)"
CUOBJ_PATH="$(realpath ../cuObject-0.8.1-Linux_x86_64/src)"
CUFILE_ENV_PATH_JSON="$(realpath ../cuobj.json)"
CUOBJ_LIBS="$CUOBJ_PATH/lib/libcuobjserver.so $CUOBJ_PATH/lib/libcuobjclient.so $CUOBJ_PATH/lib/libcufile.so.1.13.0 $CUOBJ_PATH/lib/libcufile_rdma.so.1.13.0"
```

**NOTE**: If compilation fails to find cuda_runtime.h use: `touch $CUOBJ_PATH/include/cuda_runtime.h`

Create the configuration directory as described in [this doc](https://github.com/noobaa/noobaa-core/blob/master/docs/NooBaaNonContainerized/GettingStarted.md#configuration) (no need to build and install RPM because we build from source), and finally start the noobaa server with RDMA support:

```bash
$ LD_PRELOAD=$CUOBJ_LIBS node src/cmd/nsfs
```

## Getting Started

First we use the s3perf tool in the noobaa repo to test the RDMA performance. Here is a basic example that reads the same 8MB file 10 continuously and reports the speed:

```bash
$ LD_PRELOAD="$CUOBJ_LIBS" \
  CUFILE_ENV_PATH_JSON="$CUFILE_ENV_PATH_JSON" \
  UV_THREADPOOL_SIZE=16 \
  DISABLE_INIT_RANDOM_SEED=true \
  node src/tools/s3perf.js \
  --endpoint http://172.16.0.61:6001 \
  --access_key "AK" --secret_key "SK" \
  --bucket bucket1 --get file8M --samekey \
  --time 120 --size_units MB --size 8 --concur 8 --forks 6 --rdma
```

Will output something like:

```sh
Feb-20 5:50:05.386 [/3039076]   [LOG] CONSOLE:: S3: 11240.0 MB/sec (average 9650.2) | OPS: 1405 min:20.7ms max:50.8ms avg:34.2ms
Feb-20 5:50:06.386 [/3039076]   [LOG] CONSOLE:: S3: 11216.0 MB/sec (average 9685.5) | OPS: 1402 min:20.3ms max:54.2ms avg:34.3ms
Feb-20 5:50:07.386 [/3039076]   [LOG] CONSOLE:: S3: 11040.0 MB/sec (average 9715.4) | OPS: 1380 min:17.1ms max:55.8ms avg:34.7ms
Feb-20 5:50:08.387 [/3039076]   [LOG] CONSOLE:: S3: 11024.0 MB/sec (average 9743.7) | OPS: 1378 min:17.4ms max:58.3ms avg:34.9ms
```

Remove the --rdma flag to compare the performance with and without RDMA.

```bash
Feb-20 5:53:16.867 [/3040865]   [LOG] CONSOLE:: S3: 3931.9 MB/sec (average 3785.4) | OPS: 495 min:53.1ms max:169.3ms avg:98.0ms
Feb-20 5:53:17.869 [/3040865]   [LOG] CONSOLE:: S3: 3918.4 MB/sec (average 3788.3) | OPS: 490 min:58.0ms max:161.3ms avg:98.0ms
Feb-20 5:53:18.869 [/3040865]   [LOG] CONSOLE:: S3: 3978.2 MB/sec (average 3792.3) | OPS: 497 min:50.9ms max:157.1ms avg:97.2ms
Feb-20 5:53:19.871 [/3040865]   [LOG] CONSOLE:: S3: 3949.0 MB/sec (average 3795.5) | OPS: 489 min:52.5ms max:159.1ms avg:96.6ms
```

The --cuda flag tests the performance using the GPU memory. It can be used with or without the --rdma flag. Currently this is failing. Stay tuned.

```bash

## Next steps

- Integrate S3 over RDMA to python applications
- Support multiple Server IP's
- Optimization for GPFS
