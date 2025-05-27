# Warp Github Action, Tests and Tool

1. [Introduction](#introduction)
2. [Warp GitHub actions](#warp-github-actions)
3. [Warp Makefile Targets](#warp-makefile-targets)
4. [run_warp.js Tool](#run_warpjs-tool)
5. [Manual Warp Installation](#manual-warp-installation)



## Introduction

[Warp](https://github.com/minio/warp) is a benchmarking tool for S3-compatible object storage systems, NooBaa CI runs Warp as performance/burst/scale tests for the NooBaa system on both containerized and Non Containerized flavors.
Currently, Warp runs as part of our PR tests and in the future we will add long Warp runs as part of our nightly CI process. 

## Warp GitHub actions

NooBaa CI contains 2 Github actions that build, configure and run Warp. These Github actions run automatically on every PR and on every push, and can run by workflow dispatch manually.
* [Warp Tests](../../.github/workflows/warp-tests.yaml) - Based on NooBaa Tester image, runs Warp on standard NooBaa (db configuration).
* [Warp NC Tests](../../.github/workflows/warp-nc-tests.yaml) - Based on NooBaa Tester image, runs Warp on non-containerized NooBaa (ConfigFS configuration).

Our next goal is to add longer Warp runs as part of NooBaa's nightly CI process.

## Warp Makefile Targets

One can run Warp tests on NooBaa using Warp Makefile targets - 
* `make run-warp` - Based on NooBaa Tester image, runs Warp on standard NooBaa (db configuration).
* `make run-nc-warp` - Based on NooBaa Tester image, runs Warp on non-containerized NooBaa (ConfigFS configuration).

The above makefile targets, build NooBaa tester image, and later deploy NooBaa (DB/ConfigFS deployments), install warp, create default account and bucket and runs the run_warp.js tool.

## `run_warp.js` Tool

The `run_warp.js` script is designed to execute Warp performance tests for the NooBaa system. This script provides a streamlined way to configure and run Warp tests with various parameters.


#### Usage

The script can be executed using Node.js. Below is the usage syntax:

```bash
node run_warp.js [options]
```

#### Command-Line Arguments

The following arguments are supported by the script:

| Argument            | Description                                                                 | Default Value            |
|---------------------|-----------------------------------------------------------------------------|--------------------------|
| `--op`              | Warp operation to run (`mix`, `put`, `get`, etc.).                         | `mixed`                 |
| `--concurrency`     | Number of workers to run the tests.                                         | `5` (default workers)    |
| `--bucket`          | Bucket name to run the tests on.                                            | `warp-benchmark-bucket` |
| `--duration`        | Duration of the tests (e.g., `30s`, `1m`, `1h`).                           | `10m`                   |
| `--disable-multipart` | Disable multipart upload (`true` or `false`).                              | `true`                  |
| `--access-key`      | Access key for the tests.                                                   | Derived from account.   |
| `--secret-key`      | Secret key for the tests.                                                   | Derived from account.   |
| `--obj-size`        | Object size for the tests (e.g., `1k`, `1m`, `1g`).                        | `1k`                    |
| `--account-name`    | Account name to use for the tests.                                          | `warp_account`          |
| `--help`            | Display usage information.                                                 | N/A                     |


#### Warp Command Construction

The Warp command is constructed dynamically based on the provided arguments. Below is an example of the command:

```bash
warp mixed --host=localhost:443 --access-key=<access_key> --secret-key=<secret_key> --bucket=<bucket> --obj.size=1k --duration=10m --disable-multipart=true --tls --insecure --concurrent 5
```

#### Future Improvements

1. **Support for Additional Warp Features**:
   - Add support for more Warp operations and configurations.
   - Implement logging of test results in CSV format.

2. **Nightly CI Automation**:
   - Integrate the Warp tests into nightly CI/CD pipelines for automated performance testing.

---


## Manual Warp Installation

Linux latest warp release - https://github.com/minio/warp/releases/download/v1.1.4/warp_Linux_x86_64.tar.gz

Darwin latest warp release - https://github.com/minio/warp/releases/download/v1.1.4/warp_Darwin_x86_64.tar.gz

```
curl -L <warp_release_link> -o warp.tar.gz
tar -xzf warp.tar.gz
chmod +x warp
mv warp /usr/local/bin/warp
warp --version
```
