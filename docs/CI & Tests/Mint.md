# Mint Github Action, Tests and Tool

1. [Introduction](#introduction)
2. [Mint GitHub actions](#mint-github-actions)
3. [Mint Makefile Targets](#mint-makefile-targets)
4. [Manual Mint Installation](#manual-mint-installation)



## Introduction

[Mint](https://github.com/minio/mint) is a testing framework for S3-compatible object storage systems, NooBaa CI runs Mint as correctness/benchmarking and stress tests for the NooBaa system on both containerized and Non Containerized flavors.
Following are the SDKs/tools used in correctness tests.

- awscli
- aws-sdk-go
- aws-sdk-java
- aws-sdk-java-v2
- aws-sdk-php
- aws-sdk-ruby
- healthcheck
- mc
- minio-go
- minio-java
- minio-js
- minio-py
- s3cmd
- s3select
- versioning

## Mint GitHub actions

NooBaa CI contains 2 Github actions that build, configure and run Mint. These Github actions run automatically on every PR and on every push, and can run by workflow dispatch manually.
* [Mint Tests](../../.github/workflows/mint-tests.yaml) - Based on NooBaa Tester image, runs Mint on standard NooBaa (db configuration).
* [Mint NC Tests](../../.github/workflows/mint-nc-tests.yaml) - Based on NooBaa Tester image, runs Mint on non-containerized NooBaa (ConfigFS configuration).

Our next goal is to add longer Mint runs as part of NooBaa's nightly CI process.

## Mint Makefile Targets

One can run Mint tests on NooBaa using Mint Makefile targets - 
* `make test-mint` - Based on NooBaa Tester image, runs Mint on standard NooBaa (db configuration).
* `make test-nc-mint` - Based on NooBaa Tester image, runs Mint on non-containerized NooBaa (ConfigFS configuration).

The above makefile targets, build NooBaa tester image, and later deploy NooBaa (DB/ConfigFS deployments), create default account and runs the supported sdks on Mint per the deployment type.

Currently, the supported mint test frameworks are:
1. s3cmd
2. minio-go

## Manual Mint Installation

NC deployment - 
1. Tab 1 - Install NooBaa
2. Tab 2 - Create a NooBaa account.
2. Tab 2 - Run Mint pointing to NooBaa endpoint -  
```
docker run -e SERVER_ENDPOINT=<noobaa-endpoint-address>:<noobaa-endpoint-http-port> -e ACCESS_KEY=<pre-existing-account-access-key> -e SECRET_KEY=<pre-existing-account-secret-key> -e ENABLE_HTTPS=0 minio/mint <sdk-or-tool-name>
```

Developer notes -


To manually run a MinIO Mint container that connects to a noobaa-tester container, ensure both containers are on the same Docker network (noobaa-net).


If the noobaa-tester is already connected to noobaa-net, your Mint run command should look like this:
```
docker run -e SERVER_ENDPOINT=<noobaa-tester-container-id-or-name>:<noobaa-http-endpoint-port> -e ACCESS_KEY=<pre-existing-account-access-key> -e SECRET_KEY=<pre-existing-account-secret-key> -e ENABLE_HTTPS=0 --network noobaa-net minio/mint <sdk-or-tool-name>
```

Replace <sdk-or-tool-name> with the specific SDK or tool you want to test (e.g., aws-sdk-java, minio-go, s3cmd, etc.).

## Debugging Mint on NooBaa locally - 
Running `make test-mint` will generate the following debug log files - 

```bash
noobaa-core % tree logs/mint-test-logs
logs/mint-test-logs
├── log.json                     // contains the Mint run results
├── minio-go
│   └── error.log                // contains errors coming from minio-go run
├── mint-test-logs
│   ├── backingstore1.log        // contains noobaa backingstore logs
│   ├── bg.log                   // contains noobaa BG workers logs
│   ├── hosted_agents.log        // contains noobaa hosted agents logs
│   ├── s3.log                   // contains noobaa endpoint logs
│   └── web.log                  // contains noobaa webserver logs
└── s3cmd
    └── error.log                // contains errors coming from s3-cmd run

```

Running `make test-nc-mint` will generate the following debug log files - 

```bash
noobaa-core % tree /mint-nc-test-logs
logs/mint-nc-test-logs
    ├── log.json                 // contains the Mint run results
    ├── minio-go
    │   └── error.log            // contains errors coming from minio-go run
    ├── mint-nc-test-logs
    │   └── nsfs.log             // contains NC noobaa endpoint logs
    └── s3cmd 
        └── error.log            // contains errors coming from s3-cmd run

```
