# NooBaa Non Containerized - Diagnose Metrics

1. [Introduction](#introduction)
2. [Usage](#usage)
3. [Flags](#flags)
4. [How It Works](#how-it-works)
5. [Output Format: System-wide Metrics](#output-format-system-wide-metrics)
6. [Output Format: Bucket Metrics](#output-format-bucket-metrics)
7. [Counter Reference](#counter-reference)
    1. [I/O Counters](#io-counters-nsfs_counters)
    2. [S3 Operation Counters](#s3-operation-counters-op_stats_counters)
    3. [IAM Operation Counters](#iam-operation-counters-iam_op_stats_counters)
    4. [FS Worker Counters](#fs-worker-counters-fs_worker_stats_counters)
    5. [Disk Usage](#disk-usage-disk_usage)
8. [Notes and Behavior](#notes-and-behavior)
9. [Examples](#examples)
    1. [System-wide Metrics Example](#system-wide-metrics-example)
    2. [Bucket Metrics Example](#bucket-metrics-example)

---

## Introduction

The `diagnose metrics` command is a NooBaa CLI tool that queries the running NooBaa metrics server and returns a snapshot of collected operational counters. These counters span S3 operations, IAM operations, native filesystem worker operations, I/O throughput, and (optionally) per-bucket I/O activity.

The command is a diagnostic tool intended for administrators to inspect the activity and performance of a running NooBaa Non Containerized deployment.

For background on the metrics subsystem design, see [NSFS Metrics Design](../design/NSFSMetrics.md).  
For Prometheus endpoint configuration, see [Monitoring](./Monitoring.md).

---

## Usage

```sh
noobaa-cli diagnose metrics [--bucket <bucket_name>] [--config_root <config root path>]
```

Running without flags returns system-wide counters aggregated across all buckets and operations.  
Running with `--bucket` returns I/O counters scoped to a single named bucket.

---

## Flags

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--bucket` | string | No | Print metrics scoped to the specified bucket name instead of system-wide metrics. |
| `--config_root` | string | No | Override the configuration files directory (default: `/etc/noobaa.conf.d`). |

---

## How It Works

The command issues an HTTP GET request to the local NooBaa metrics server:

- **Without `--bucket`**: `GET http://localhost:{EP_METRICS_SERVER_PORT}/metrics/nsfs_stats`
- **With `--bucket <name>`**: `GET http://localhost:{EP_METRICS_SERVER_PORT}/metrics/bucket/<name>`

The default port is `7004` (configurable via `EP_METRICS_SERVER_PORT`). The metrics server must be running for the command to succeed; if it is unreachable, the command exits with `MetricsStatusFailed`.

---

## Output Format: System-wide Metrics

When run without `--bucket`, the output JSON has the following top-level structure:

```json
{
  "response": {
    "code": "MetricsStatus",
    "reply": {
      "nsfs_counters":          { ... },
      "op_stats_counters":      { ... },
      "iam_op_stats_counters":  { ... },
      "fs_worker_stats_counters": { ... },
      "disk_usage":             { ... }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `nsfs_counters` | Aggregate I/O read/write counts and bytes across all NSFS namespaces. |
| `op_stats_counters` | Per-operation timing and error counters for S3 operations. |
| `iam_op_stats_counters` | Per-operation timing and error counters for IAM operations. |
| `fs_worker_stats_counters` | Per-operation timing and error counters for native FS worker calls. |
| `disk_usage` | Optional map of filesystem path → disk usage percentage (only populated when `NSFS_GLACIER_METRICS_STATFS_PATHS` is configured). |

---

## Output Format: Bucket Metrics

When run with `--bucket <name>`, the output JSON contains I/O statistics scoped to a single bucket:

```json
{
  "response": {
    "code": "MetricsStatus",
    "reply": {
      "<content_type>": {
        "read_count":  <number>,
        "write_count": <number>
      },
      "read_bytes":  "<number>",
      "write_bytes": "<number>"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `<content_type>` (e.g. `"application/octet-stream"`) | Per-content-type read and write operation counts for the named bucket. Multiple content-type keys may appear. |
| `read_bytes` | Total bytes read from the bucket (Prometheus hub metric, returned as a string). |
| `write_bytes` | Total bytes written to the bucket (Prometheus hub metric, returned as a string). |

---

## Counter Reference

### I/O Counters (`nsfs_counters`)

Aggregate throughput counters for all NSFS namespace I/O. Sourced from `endpoint_stats_collector` → `stats_aggregator` via `io_stats`.

| Counter Name | Description | Unit |
|---|---|---|
| `noobaa_nsfs_io_read_count` | Total number of successful read operations | operations |
| `noobaa_nsfs_io_write_count` | Total number of successful write operations | operations |
| `noobaa_nsfs_io_read_bytes` | Total bytes successfully read | bytes |
| `noobaa_nsfs_io_write_bytes` | Total bytes successfully written | bytes |
| `noobaa_nsfs_io_error_read_count` | Total number of failed read operations | operations |
| `noobaa_nsfs_io_error_write_count` | Total number of failed write operations | operations |
| `noobaa_nsfs_io_error_read_bytes` | Total bytes in failed read operations | bytes |
| `noobaa_nsfs_io_error_write_bytes` | Total bytes in failed write operations | bytes |

---

### S3 Operation Counters (`op_stats_counters`)

Per-operation timing statistics for S3 API calls. Each S3 operation listed in `stats_collector_utils.op_names` produces five counters:

| Suffix | Description | Unit |
|---|---|---|
| `_min_time_milisec` | Minimum successful operation duration | milliseconds |
| `_max_time_milisec` | Maximum successful operation duration | milliseconds |
| `_avg_time_milisec` | Average successful operation duration | milliseconds |
| `_count` | Total number of operation invocations (success + error) | operations |
| `_error_count` | Total number of failed invocations | errors |

The full set of tracked S3 operations and their counter names:

| Operation | Counter Prefix |
|---|---|
| Upload object | `noobaa_nsfs_op_upload_object_` |
| Delete object | `noobaa_nsfs_op_delete_object_` |
| Create bucket | `noobaa_nsfs_op_create_bucket_` |
| List buckets | `noobaa_nsfs_op_list_buckets_` |
| Delete bucket | `noobaa_nsfs_op_delete_bucket_` |
| List objects | `noobaa_nsfs_op_list_objects_` |
| Head object | `noobaa_nsfs_op_head_object_` |
| Read object | `noobaa_nsfs_op_read_object_` |
| Initiate multipart | `noobaa_nsfs_op_initiate_multipart_` |
| Upload part | `noobaa_nsfs_op_upload_part_` |
| Complete object upload | `noobaa_nsfs_op_complete_object_upload_` |

Expanding all five suffixes for each operation yields the complete counter list:

<details>
<summary>Full S3 operation counter list (click to expand)</summary>

| Counter Name | Description | Unit |
|---|---|---|
| `noobaa_nsfs_op_upload_object_min_time_milisec` | Minimum time to upload an object | ms |
| `noobaa_nsfs_op_upload_object_max_time_milisec` | Maximum time to upload an object | ms |
| `noobaa_nsfs_op_upload_object_avg_time_milisec` | Average time to upload an object | ms |
| `noobaa_nsfs_op_upload_object_count` | Number of upload object invocations | operations |
| `noobaa_nsfs_op_upload_object_error_count` | Number of upload object errors | errors |
| `noobaa_nsfs_op_delete_object_min_time_milisec` | Minimum time to delete an object | ms |
| `noobaa_nsfs_op_delete_object_max_time_milisec` | Maximum time to delete an object | ms |
| `noobaa_nsfs_op_delete_object_avg_time_milisec` | Average time to delete an object | ms |
| `noobaa_nsfs_op_delete_object_count` | Number of delete object invocations | operations |
| `noobaa_nsfs_op_delete_object_error_count` | Number of delete object errors | errors |
| `noobaa_nsfs_op_create_bucket_min_time_milisec` | Minimum time to create a bucket | ms |
| `noobaa_nsfs_op_create_bucket_max_time_milisec` | Maximum time to create a bucket | ms |
| `noobaa_nsfs_op_create_bucket_avg_time_milisec` | Average time to create a bucket | ms |
| `noobaa_nsfs_op_create_bucket_count` | Number of create bucket invocations | operations |
| `noobaa_nsfs_op_create_bucket_error_count` | Number of create bucket errors | errors |
| `noobaa_nsfs_op_list_buckets_min_time_milisec` | Minimum time to list buckets | ms |
| `noobaa_nsfs_op_list_buckets_max_time_milisec` | Maximum time to list buckets | ms |
| `noobaa_nsfs_op_list_buckets_avg_time_milisec` | Average time to list buckets | ms |
| `noobaa_nsfs_op_list_buckets_count` | Number of list buckets invocations | operations |
| `noobaa_nsfs_op_list_buckets_error_count` | Number of list buckets errors | errors |
| `noobaa_nsfs_op_delete_bucket_min_time_milisec` | Minimum time to delete a bucket | ms |
| `noobaa_nsfs_op_delete_bucket_max_time_milisec` | Maximum time to delete a bucket | ms |
| `noobaa_nsfs_op_delete_bucket_avg_time_milisec` | Average time to delete a bucket | ms |
| `noobaa_nsfs_op_delete_bucket_count` | Number of delete bucket invocations | operations |
| `noobaa_nsfs_op_delete_bucket_error_count` | Number of delete bucket errors | errors |
| `noobaa_nsfs_op_list_objects_min_time_milisec` | Minimum time to list objects | ms |
| `noobaa_nsfs_op_list_objects_max_time_milisec` | Maximum time to list objects | ms |
| `noobaa_nsfs_op_list_objects_avg_time_milisec` | Average time to list objects | ms |
| `noobaa_nsfs_op_list_objects_count` | Number of list objects invocations | operations |
| `noobaa_nsfs_op_list_objects_error_count` | Number of list objects errors | errors |
| `noobaa_nsfs_op_head_object_min_time_milisec` | Minimum time to head an object | ms |
| `noobaa_nsfs_op_head_object_max_time_milisec` | Maximum time to head an object | ms |
| `noobaa_nsfs_op_head_object_avg_time_milisec` | Average time to head an object | ms |
| `noobaa_nsfs_op_head_object_count` | Number of head object invocations | operations |
| `noobaa_nsfs_op_head_object_error_count` | Number of head object errors | errors |
| `noobaa_nsfs_op_read_object_min_time_milisec` | Minimum time to read an object | ms |
| `noobaa_nsfs_op_read_object_max_time_milisec` | Maximum time to read an object | ms |
| `noobaa_nsfs_op_read_object_avg_time_milisec` | Average time to read an object | ms |
| `noobaa_nsfs_op_read_object_count` | Number of read object invocations | operations |
| `noobaa_nsfs_op_read_object_error_count` | Number of read object errors | errors |
| `noobaa_nsfs_op_initiate_multipart_min_time_milisec` | Minimum time to initiate multipart upload | ms |
| `noobaa_nsfs_op_initiate_multipart_max_time_milisec` | Maximum time to initiate multipart upload | ms |
| `noobaa_nsfs_op_initiate_multipart_avg_time_milisec` | Average time to initiate multipart upload | ms |
| `noobaa_nsfs_op_initiate_multipart_count` | Number of initiate multipart invocations | operations |
| `noobaa_nsfs_op_initiate_multipart_error_count` | Number of initiate multipart errors | errors |
| `noobaa_nsfs_op_upload_part_min_time_milisec` | Minimum time to upload a multipart part | ms |
| `noobaa_nsfs_op_upload_part_max_time_milisec` | Maximum time to upload a multipart part | ms |
| `noobaa_nsfs_op_upload_part_avg_time_milisec` | Average time to upload a multipart part | ms |
| `noobaa_nsfs_op_upload_part_count` | Number of upload part invocations | operations |
| `noobaa_nsfs_op_upload_part_error_count` | Number of upload part errors | errors |
| `noobaa_nsfs_op_complete_object_upload_min_time_milisec` | Minimum time to complete a multipart upload | ms |
| `noobaa_nsfs_op_complete_object_upload_max_time_milisec` | Maximum time to complete a multipart upload | ms |
| `noobaa_nsfs_op_complete_object_upload_avg_time_milisec` | Average time to complete a multipart upload | ms |
| `noobaa_nsfs_op_complete_object_upload_count` | Number of complete object upload invocations | operations |
| `noobaa_nsfs_op_complete_object_upload_error_count` | Number of complete object upload errors | errors |

</details>

> **Note on `upload_part`:** Upload-part timing is collected but the per-part send to the aggregator is suppressed (`trigger_send = false`) to avoid flooding the collection pipeline. The counters are only flushed when a subsequent triggerable operation occurs.

---

### IAM Operation Counters (`iam_op_stats_counters`)

Per-operation timing statistics for IAM API calls. Each IAM operation listed in `stats_collector_utils.iam_op_names` produces the same five suffixes as S3 operations (`_min_time_milisec`, `_max_time_milisec`, `_avg_time_milisec`, `_count`, `_error_count`).

| Operation | Counter Prefix |
|---|---|
| Create user | `noobaa_nsfs_iam_op_create_user_` |
| Get user | `noobaa_nsfs_iam_op_get_user_` |
| Update user | `noobaa_nsfs_iam_op_update_user_` |
| Delete user | `noobaa_nsfs_iam_op_delete_user_` |
| List users | `noobaa_nsfs_iam_op_list_users_` |
| Create access key | `noobaa_nsfs_iam_op_create_access_key_` |
| Get access key last used | `noobaa_nsfs_iam_op_get_access_key_last_used_` |
| Update access key | `noobaa_nsfs_iam_op_update_access_key_` |
| Delete access key | `noobaa_nsfs_iam_op_delete_access_key_` |
| List access keys | `noobaa_nsfs_iam_op_list_access_keys_` |

<details>
<summary>Full IAM operation counter list (click to expand)</summary>

| Counter Name | Description | Unit |
|---|---|---|
| `noobaa_nsfs_iam_op_create_user_min_time_milisec` | Minimum time to create a user | ms |
| `noobaa_nsfs_iam_op_create_user_max_time_milisec` | Maximum time to create a user | ms |
| `noobaa_nsfs_iam_op_create_user_avg_time_milisec` | Average time to create a user | ms |
| `noobaa_nsfs_iam_op_create_user_count` | Number of create user invocations | operations |
| `noobaa_nsfs_iam_op_create_user_error_count` | Number of create user errors | errors |
| `noobaa_nsfs_iam_op_get_user_min_time_milisec` | Minimum time to get a user | ms |
| `noobaa_nsfs_iam_op_get_user_max_time_milisec` | Maximum time to get a user | ms |
| `noobaa_nsfs_iam_op_get_user_avg_time_milisec` | Average time to get a user | ms |
| `noobaa_nsfs_iam_op_get_user_count` | Number of get user invocations | operations |
| `noobaa_nsfs_iam_op_get_user_error_count` | Number of get user errors | errors |
| `noobaa_nsfs_iam_op_update_user_min_time_milisec` | Minimum time to update a user | ms |
| `noobaa_nsfs_iam_op_update_user_max_time_milisec` | Maximum time to update a user | ms |
| `noobaa_nsfs_iam_op_update_user_avg_time_milisec` | Average time to update a user | ms |
| `noobaa_nsfs_iam_op_update_user_count` | Number of update user invocations | operations |
| `noobaa_nsfs_iam_op_update_user_error_count` | Number of update user errors | errors |
| `noobaa_nsfs_iam_op_delete_user_min_time_milisec` | Minimum time to delete a user | ms |
| `noobaa_nsfs_iam_op_delete_user_max_time_milisec` | Maximum time to delete a user | ms |
| `noobaa_nsfs_iam_op_delete_user_avg_time_milisec` | Average time to delete a user | ms |
| `noobaa_nsfs_iam_op_delete_user_count` | Number of delete user invocations | operations |
| `noobaa_nsfs_iam_op_delete_user_error_count` | Number of delete user errors | errors |
| `noobaa_nsfs_iam_op_list_users_min_time_milisec` | Minimum time to list users | ms |
| `noobaa_nsfs_iam_op_list_users_max_time_milisec` | Maximum time to list users | ms |
| `noobaa_nsfs_iam_op_list_users_avg_time_milisec` | Average time to list users | ms |
| `noobaa_nsfs_iam_op_list_users_count` | Number of list users invocations | operations |
| `noobaa_nsfs_iam_op_list_users_error_count` | Number of list users errors | errors |
| `noobaa_nsfs_iam_op_create_access_key_min_time_milisec` | Minimum time to create an access key | ms |
| `noobaa_nsfs_iam_op_create_access_key_max_time_milisec` | Maximum time to create an access key | ms |
| `noobaa_nsfs_iam_op_create_access_key_avg_time_milisec` | Average time to create an access key | ms |
| `noobaa_nsfs_iam_op_create_access_key_count` | Number of create access key invocations | operations |
| `noobaa_nsfs_iam_op_create_access_key_error_count` | Number of create access key errors | errors |
| `noobaa_nsfs_iam_op_get_access_key_last_used_min_time_milisec` | Minimum time to get access key last-used | ms |
| `noobaa_nsfs_iam_op_get_access_key_last_used_max_time_milisec` | Maximum time to get access key last-used | ms |
| `noobaa_nsfs_iam_op_get_access_key_last_used_avg_time_milisec` | Average time to get access key last-used | ms |
| `noobaa_nsfs_iam_op_get_access_key_last_used_count` | Number of get access key last-used invocations | operations |
| `noobaa_nsfs_iam_op_get_access_key_last_used_error_count` | Number of get access key last-used errors | errors |
| `noobaa_nsfs_iam_op_update_access_key_min_time_milisec` | Minimum time to update an access key | ms |
| `noobaa_nsfs_iam_op_update_access_key_max_time_milisec` | Maximum time to update an access key | ms |
| `noobaa_nsfs_iam_op_update_access_key_avg_time_milisec` | Average time to update an access key | ms |
| `noobaa_nsfs_iam_op_update_access_key_count` | Number of update access key invocations | operations |
| `noobaa_nsfs_iam_op_update_access_key_error_count` | Number of update access key errors | errors |
| `noobaa_nsfs_iam_op_delete_access_key_min_time_milisec` | Minimum time to delete an access key | ms |
| `noobaa_nsfs_iam_op_delete_access_key_max_time_milisec` | Maximum time to delete an access key | ms |
| `noobaa_nsfs_iam_op_delete_access_key_avg_time_milisec` | Average time to delete an access key | ms |
| `noobaa_nsfs_iam_op_delete_access_key_count` | Number of delete access key invocations | operations |
| `noobaa_nsfs_iam_op_delete_access_key_error_count` | Number of delete access key errors | errors |
| `noobaa_nsfs_iam_op_list_access_keys_min_time_milisec` | Minimum time to list access keys | ms |
| `noobaa_nsfs_iam_op_list_access_keys_max_time_milisec` | Maximum time to list access keys | ms |
| `noobaa_nsfs_iam_op_list_access_keys_avg_time_milisec` | Average time to list access keys | ms |
| `noobaa_nsfs_iam_op_list_access_keys_count` | Number of list access keys invocations | operations |
| `noobaa_nsfs_iam_op_list_access_keys_error_count` | Number of list access keys errors | errors |

</details>

---

### FS Worker Counters (`fs_worker_stats_counters`)

Per-operation timing statistics for native filesystem calls made by NSFS FS workers.

| Operation | Counter Prefix | Description |
|---|---|---|
| `stat` | `noobaa_nsfs_fs_worker_stat_` | `stat()` a path |
| `lstat` | `noobaa_nsfs_fs_worker_lstat_` | `lstat()` a path |
| `statfs` | `noobaa_nsfs_fs_worker_statfs_` | Get filesystem statistics |
| `checkaccess` | `noobaa_nsfs_fs_worker_checkaccess_` | Check access permissions |
| `unlink` | `noobaa_nsfs_fs_worker_unlink_` | Unlink (delete) a file |
| `unlinkat` | `noobaa_nsfs_fs_worker_unlinkat_` | `unlinkat()` a file |
| `link` | `noobaa_nsfs_fs_worker_link_` | Create a hard link |
| `linkat` | `noobaa_nsfs_fs_worker_linkat_` | `linkat()` hard link |
| `mkdir` | `noobaa_nsfs_fs_worker_mkdir_` | Create a directory |
| `rmdir` | `noobaa_nsfs_fs_worker_rmdir_` | Remove a directory |
| `rename` | `noobaa_nsfs_fs_worker_rename_` | Rename a file or directory |
| `writefile` | `noobaa_nsfs_fs_worker_writefile_` | Write an entire file atomically |
| `readfile` | `noobaa_nsfs_fs_worker_readfile_` | Read an entire file |
| `readdir` | `noobaa_nsfs_fs_worker_readdir_` | Read directory entries |
| `fsync` | `noobaa_nsfs_fs_worker_fsync_` | `fsync()` a path |
| `fileopen` | `noobaa_nsfs_fs_worker_fileopen_` | Open a file descriptor |
| `fileclose` | `noobaa_nsfs_fs_worker_fileclose_` | Close a file descriptor |
| `fileread` | `noobaa_nsfs_fs_worker_fileread_` | Read from an open file descriptor |
| `filewrite` | `noobaa_nsfs_fs_worker_filewrite_` | Write to an open file descriptor |
| `filewritev` | `noobaa_nsfs_fs_worker_filewritev_` | Vectored write to an open file descriptor |
| `filereplacexattr` | `noobaa_nsfs_fs_worker_filereplacexattr_` | Replace all extended attributes on a file |
| `linkfileat` | `noobaa_nsfs_fs_worker_linkfileat_` | Create a hard link from an open file descriptor |
| `filegetxattr` | `noobaa_nsfs_fs_worker_filegetxattr_` | Get all extended attributes of a file |
| `filestat` | `noobaa_nsfs_fs_worker_filestat_` | `fstat()` an open file descriptor |
| `filefsync` | `noobaa_nsfs_fs_worker_filefsync_` | `fsync()` an open file descriptor |
| `realpath` | `noobaa_nsfs_fs_worker_realpath_` | Resolve a canonical path |
| `getsinglexattr` | `noobaa_nsfs_fs_worker_getsinglexattr_` | Get a single named extended attribute |
| `diropen` | `noobaa_nsfs_fs_worker_diropen_` | Open a directory stream |
| `dirclose` | `noobaa_nsfs_fs_worker_dirclose_` | Close a directory stream |
| `dirreadentry` | `noobaa_nsfs_fs_worker_dirreadentry_` | Read one entry from a directory stream |
| `safelink` | `noobaa_nsfs_fs_worker_safelink_` | Atomic safe hard link (link + verify) |
| `safeunlink` | `noobaa_nsfs_fs_worker_safeunlink_` | Atomic safe unlink |

For each operation above, the five counter suffixes are:

| Suffix | Description | Unit |
|---|---|---|
| `_min_time_milisec` | Minimum successful duration | milliseconds |
| `_max_time_milisec` | Maximum successful duration | milliseconds |
| `_avg_time_milisec` | Average successful duration | milliseconds |
| `_count` | Total invocations (success + error) | operations |
| `_error_count` | Failed invocations | errors |

> **Note:** Timing counters (`min`, `max`, `avg`) are only updated for successful (non-error) calls. An operation where all invocations failed will have `_count > 0` and `_error_count == _count`, but zero timing values.

---

### Disk Usage (`disk_usage`)

An optional map present only when `NSFS_GLACIER_METRICS_STATFS_PATHS` is configured in `config.json`. Each key is an absolute filesystem path and each value is the percentage of disk space used (0–100, three decimal places).

```json
"disk_usage": {
  "/glacier/tape": 42.137,
  "/glacier/cache": 78.500
}
```

If `NSFS_GLACIER_METRICS_STATFS_PATHS` is empty or unset, this field is an empty object `{}`.

---

## Notes and Behavior

- **Only observed operations appear.** A counter group for an operation is absent from the output if that operation has not been performed since the last process start or stat reset.
- **Timing counters require at least one success.** An operation that has only failed invocations will not appear in `op_stats_counters`, `iam_op_stats_counters`, or `fs_worker_stats_counters` until at least one successful call is recorded.
- **Metrics are in-memory and ephemeral.** Restarting the NooBaa service process resets all counters to zero.
- **Requires running metrics server.** The command will fail with `MetricsStatusFailed` if the metrics server is not listening on `EP_METRICS_SERVER_PORT` (default `7004`).
- **Root permissions required.** Like all `noobaa-cli` commands.

---

## Examples

### System-wide Metrics Example

```sh
sudo noobaa-cli diagnose metrics 2>/dev/null
```

Sample output:

```json
{
  "response": {
    "code": "MetricsStatus",
    "reply": {
      "nsfs_counters": {
        "noobaa_nsfs_io_read_count": 1,
        "noobaa_nsfs_io_write_count": 2,
        "noobaa_nsfs_io_read_bytes": 49,
        "noobaa_nsfs_io_write_bytes": 98
      },
      "op_stats_counters": {
        "noobaa_nsfs_op_create_bucket_min_time_milisec": 15,
        "noobaa_nsfs_op_create_bucket_max_time_milisec": 15,
        "noobaa_nsfs_op_create_bucket_avg_time_milisec": 15,
        "noobaa_nsfs_op_create_bucket_count": 1,
        "noobaa_nsfs_op_create_bucket_error_count": 0,
        "noobaa_nsfs_op_upload_object_min_time_milisec": 15,
        "noobaa_nsfs_op_upload_object_max_time_milisec": 20,
        "noobaa_nsfs_op_upload_object_avg_time_milisec": 17,
        "noobaa_nsfs_op_upload_object_count": 2,
        "noobaa_nsfs_op_upload_object_error_count": 0,
        "noobaa_nsfs_op_head_object_min_time_milisec": 2,
        "noobaa_nsfs_op_head_object_max_time_milisec": 3,
        "noobaa_nsfs_op_head_object_avg_time_milisec": 2,
        "noobaa_nsfs_op_head_object_count": 2,
        "noobaa_nsfs_op_head_object_error_count": 0,
        "noobaa_nsfs_op_read_object_min_time_milisec": 12,
        "noobaa_nsfs_op_read_object_max_time_milisec": 12,
        "noobaa_nsfs_op_read_object_avg_time_milisec": 12,
        "noobaa_nsfs_op_read_object_count": 1,
        "noobaa_nsfs_op_read_object_error_count": 0
      },
      "iam_op_stats_counters": {
        "noobaa_nsfs_iam_op_list_users_min_time_milisec": 0,
        "noobaa_nsfs_iam_op_list_users_max_time_milisec": 1,
        "noobaa_nsfs_iam_op_list_users_avg_time_milisec": 0,
        "noobaa_nsfs_iam_op_list_users_count": 2,
        "noobaa_nsfs_iam_op_list_users_error_count": 0
      },
      "fs_worker_stats_counters": {
        "noobaa_nsfs_fs_worker_stat_min_time_milisec": 29,
        "noobaa_nsfs_fs_worker_stat_max_time_milisec": 165,
        "noobaa_nsfs_fs_worker_stat_avg_time_milisec": 79,
        "noobaa_nsfs_fs_worker_stat_count": 24,
        "noobaa_nsfs_fs_worker_stat_error_count": 0,
        "noobaa_nsfs_fs_worker_readfile_min_time_milisec": 45,
        "noobaa_nsfs_fs_worker_readfile_max_time_milisec": 330,
        "noobaa_nsfs_fs_worker_readfile_avg_time_milisec": 225,
        "noobaa_nsfs_fs_worker_readfile_count": 3,
        "noobaa_nsfs_fs_worker_readfile_error_count": 0,
        "noobaa_nsfs_fs_worker_realpath_min_time_milisec": 17,
        "noobaa_nsfs_fs_worker_realpath_max_time_milisec": 20,
        "noobaa_nsfs_fs_worker_realpath_avg_time_milisec": 18,
        "noobaa_nsfs_fs_worker_realpath_count": 3,
        "noobaa_nsfs_fs_worker_realpath_error_count": 0
      },
      "disk_usage": {}
    }
  }
}
```

---

### Bucket Metrics Example

```sh
sudo noobaa-cli diagnose metrics --bucket my-bucket 2>/dev/null
```

Sample output:

```json
{
  "response": {
    "code": "MetricsStatus",
    "reply": {
      "application/octet-stream": {
        "write_count": 5,
        "read_count": 3
      },
      "image/jpeg": {
        "read_count": 1
      },
      "read_bytes": "81920",
      "write_bytes": "512000"
    }
  }
}
```
