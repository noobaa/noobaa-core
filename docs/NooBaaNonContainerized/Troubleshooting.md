# NooBaa Non Containerized - Troubleshooting

1. [Introduction](#introduction)
2. [Logging](#logging)
    1. [Debugging S3 Requests Failures](#debugging-s3-requests-failures)
    2. [Debugging NooBaa CLI Requests Failures](#debugging-noobaa-cli-requests-failures)
3. [Events](#events)
4. [Health CLI](#health-cli)
5. [Monitoring](#monitoring)
6. [Bugs Reporting](#bugs-reporting)

## Introduction

The following guide is designed to help you diagnose and resolve issues within the NooBaa service using logs and monitoring tools. By analyzing log files and monitoring data, you can identify the root causes of problems and implement effective solutions.

## Logging

### Debugging S3 requests failures
When debugging a failing S3 request it's recommended to look into the following -

#### S3 client error response -
Error responses received by the S3 client can add more information about the root cause of the failure.  
* For more info about AWS S3 error responses, see - [Amazon S3 error responses doc](https://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html).  
* For more info about AWS S3 API, see - [Amazon S3 API doc](https://docs.aws.amazon.com/AmazonS3/latest/API/API_Operations_Amazon_Simple_Storage_Service.html).

#### NooBaa service logs -
NooBaa service runs NooBaa S3 endpoints, therefore, examining the NooBaa service logs is a crucial step in identifying the root cause.  
Follow [NooBaa Non Containerized Logging](./Logging.md) guide for displaying NooBaa logs.

**Steps for effective NooBaa service log search:**

1. `Identify the Time Frame` -   
    Determine when the issue occurred to narrow down the log entries to a specific time frame. This helps focus the search on relevant logs.

2. `Use Relevant Keywords` -  
    Search for specific keywords related to the issue, such as error messages, warning codes, or identifiers such as - 
    * The Object name.
    * The Bucket name
    * An S3 client error code.
    * Other S3 request specific parameters.
    * `namespace_fs.` log print prefix.
    * `FS::` native log print prefix.
    * `ERROR`.
    * `WARN`.

3. `Debug level increase` -   
    Follow [NooBaa Non Containerized Logging](./Logging.md) guide for increasing NooBaa log level.

### Debugging NooBaa CLI requests failures
**Steps for effective NooBaa CLI log search:**
- When debugging a failing NooBaa CLI command it's recommended to look into the CLI logs by removing the `2>/dev/null` command suffix.  
- Add `--debug=5` flag for increasing the debug level of the NooBaa CLI command. 
- Error responses received by the NooBaa CLI can add more information about the root cause of the failure.  For the full NooBaa CLI error responses list, see - [NooBaa CLI errors](../../src/manage_nsfs/manage_nsfs_cli_errors.js).  

## Events

NooBaa Non Containerized emits Normal / Error indicating events.

Follow [NooBaa Non Containerized Events](./Events.md) for acquiring more knowledge on NooBaa events.

## Health CLI

The NooBaa Health CLI tool used for analyzing NooBaa service and entities health. Running the health CLI tool results with a report describing the health status of the following components - 
1. NooBaa service.
2. NooBaa endpoints.
3. NooBaa accounts.
4. NooBaa buckets.

Follow [NooBaa Non Containerized Health](./Health.md) guide for running NooBaa Health CLI.

## Monitoring
NooBaa offers NSFS Prometheus metrics to provide detailed information on buckets and I/O operations.  
Follow [NooBaa Non Containerized Monitoring](./Monitoring.md) guide for fetching and analyzing NooBaa NSFS metrics.


## Bugs Reporting
When reporting a NooBaa Non containerized bug, it is essential for efficient debugging that the reporter includes detailed information.   

Below is a list of the minimum information required when reporting a new bug -
1. `Reproduction steps`.
2. `Full NooBaa service logs`, debug level is `nsfs`.
3. Content of `config.json` file.
4. `S3 CLI command` (if the failure originates from S3 flow).
5. `S3 CLI response` (if the failure originates from S3 flow).
6. `NooBaa CLI command` (if the failure originates from NooBaa CLI flow).
    Run the NooBaa CLI command with `--debug=5` for full NooBaa CLI logs.  
7. `NooBaa CLI response` flag (if the failure originates from NooBaa CLI flow).
