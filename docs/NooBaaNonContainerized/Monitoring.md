# NooBaa Non Containerized - Monitoring

1. [Introduction](#introduction)
2. [Metrics Endpoint Configuration](#metrics-endpoint-configuration)
3. [Metrics description](#metrics-description) 
4. [Getting Started](#getting-started)
5. [Examples](#examples)

## Introduction

NooBaa offers NSFS Prometheus metrics to provide detailed information on buckets and I/O operations. The following document contains instructions on how to get started with fetching these metrics, understanding the additional information they offer, and includes examples and more.   
Read more about NSFS metrics at - [NSFS metrics design](./../design/NSFSMetrics.md).


## Metrics Endpoint Configuration

This section provides details about the metrics URL and port configuration necessary for accessing and monitoring system metrics.

#### Prometheus Metrics HTTP URL - </br>
- NooBaa exports the system statistics via the following URL - </br> `http://{host}:{http_metrics_port}/metrics/nsfs_stats`

- Default port - 7004

- Prometheus metrics port configuration -  </br> Changing Prometheus metrics port can be done by changing EP_METRICS_SERVER_PORT in config.json.  </br>

- Prometheus metrics HTTP service can be enabled/disabled by changing `ALLOW_HTTP_METRICS` in config.json for Non Containerized Noobaa, for containerized deployments HTTP is always enabled.

#### Prometheus Metrics HTTPS URL - </br>

- NooBaa exports the system statistics via the following SSL URL - </br> `https://{host}:{https_metrics_port}/metrics/nsfs_stats`

- Default port - 9443

- Prometheus metrics port configuration -  </br> Changing Prometheus metrics HTTPS port can be done by changing EP_METRICS_SERVER_SSL_PORT in config.json.  </br>

- Prometheus metrics HTTP service can be enabled/disabled by changing `ALLOW_HTTPS_METRICS` in config.json

- Secure Prometheus metrics will reuse the existing S3 certificates from cert path S3_SERVICE_CERT_PATH (`/etc/s3-secret`) for containerized deployments and  `{nsfs_config_root}/certificates/` for non-containerized NSFS deployments. </br> Prometheus metrics SSL cert dir path can be changed by updating S3_SERVICE_CERT_PATH in config.json. for containerized deployments </br>

For more details about configuring metrics port see - [Non Containerized NooBaa Developer Customization](./ConfigFileCustomizations.md)


## Metrics description

### I/O Metrics

The I/O Metrics table provides a detailed overview of the input/output operations performed by the system. It includes metrics for the total number of read and write operations as well as the total amount of data read and written, measured in bytes. These metrics help in understanding the overall I/O activity and data transfer rates within the system.


| Metric Name                   | Description                              | Unit       |
|-------------------------------|------------------------------------------|------------|
| noobaa_nsfs_io_read_count     | Total number of read operations           | operations |
| noobaa_nsfs_io_write_count    | Total number of write operations          | operations |
| noobaa_nsfs_io_read_bytes     | Total bytes read                          | bytes      |
| noobaa_nsfs_io_write_bytes    | Total bytes written                       | bytes      |
| noobaa_nsfs_io_error_read_count | Total number of read errors              | operations |
| noobaa_nsfs_io_error_write_count | Total number of write errors            | operations |
| noobaa_nsfs_io_error_read_bytes | Total read error bytes                   | bytes      |
| noobaa_nsfs_io_error_write_bytes | Total write error bytes                 | bytes      |


### Per-Operation Metrics

The Per-Operation Metrics table details the performance and count of specific operations related to bucket and object management. It includes metrics such as the minimum, maximum, and average time taken for creating buckets, uploading objects, heading objects, and reading objects. Additionally, it tracks the total number of operations and any errors encountered. These metrics are essential for analyzing the efficiency and reliability of different operations within the system.


| Metric Name                                    | Description                                | Unit          |
|------------------------------------------------|--------------------------------------------|---------------|
| noobaa_nsfs_op_create_bucket_min_time          | Minimum time to create a bucket            | milliseconds  |
| noobaa_nsfs_op_create_bucket_max_time          | Maximum time to create a bucket            | milliseconds  |
| noobaa_nsfs_op_create_bucket_avg_time          | Average time to create a bucket            | milliseconds  |
| noobaa_nsfs_op_create_bucket_count             | Number of create bucket operations         | operations    |
| noobaa_nsfs_op_create_bucket_error_count       | Number of errors in creating buckets       | errors        |
| noobaa_nsfs_op_upload_object_min_time          | Minimum time to upload an object           | milliseconds  |
| noobaa_nsfs_op_upload_object_max_time          | Maximum time to upload an object           | milliseconds  |
| noobaa_nsfs_op_upload_object_avg_time          | Average time to upload an object           | milliseconds  |
| noobaa_nsfs_op_upload_object_count             | Number of upload object operations         | operations    |
| noobaa_nsfs_op_upload_object_error_count       | Number of errors in uploading objects      | errors        |
| noobaa_nsfs_op_head_object_min_time            | Minimum time to head an object             | milliseconds  |
| noobaa_nsfs_op_head_object_max_time            | Maximum time to head an object             | milliseconds  |
| noobaa_nsfs_op_head_object_avg_time            | Average time to head an object             | milliseconds  |
| noobaa_nsfs_op_head_object_count               | Number of head object operations           | operations    |
| noobaa_nsfs_op_head_object_error_count         | Number of errors in heading objects        | errors        |
| noobaa_nsfs_op_read_object_min_time            | Minimum time to read an object             | milliseconds  |
| noobaa_nsfs_op_read_object_max_time            | Maximum time to read an object             | milliseconds  |
| noobaa_nsfs_op_read_object_avg_time            | Average time to read an object             | milliseconds  |
| noobaa_nsfs_op_read_object_count               | Number of read object operations           | operations    |
| noobaa_nsfs_op_read_object_error_count         | Number of errors in reading objects        | errors        |
| noobaa_nsfs_op_delete_object_min_time          | Minimum time to delete an object           | milliseconds  |
| noobaa_nsfs_op_delete_object_max_time          | Maximum time to delete an object           | milliseconds  |
| noobaa_nsfs_op_delete_object_avg_time          | Average time to delete an object           | milliseconds  |
| noobaa_nsfs_op_delete_object_count             | Number of delete object operations         | operations    |
| noobaa_nsfs_op_delete_object_error_count       | Number of errors in deleting objects       | errors        |
| noobaa_nsfs_op_list_buckets_min_time           | Minimum time to list buckets               | milliseconds  |
| noobaa_nsfs_op_list_buckets_max_time           | Maximum time to list buckets               | milliseconds  |
| noobaa_nsfs_op_list_buckets_avg_time           | Average time to list buckets               | milliseconds  |
| noobaa_nsfs_op_list_buckets_count              | Number of list buckets operations          | operations    |
| noobaa_nsfs_op_list_buckets_error_count        | Number of errors in listing buckets        | errors        |
| noobaa_nsfs_op_delete_bucket_min_time          | Minimum time to delete a bucket            | milliseconds  |
| noobaa_nsfs_op_delete_bucket_max_time          | Maximum time to delete a bucket            | milliseconds  |
| noobaa_nsfs_op_delete_bucket_avg_time          | Average time to delete a bucket            | milliseconds  |
| noobaa_nsfs_op_delete_bucket_count             | Number of delete bucket operations         | operations    |
| noobaa_nsfs_op_delete_bucket_error_count       | Number of errors in deleting buckets       | errors        |
| noobaa_nsfs_op_list_objects_min_time           | Minimum time to list objects               | milliseconds  |
| noobaa_nsfs_op_list_objects_max_time           | Maximum time to list objects               | milliseconds  |
| noobaa_nsfs_op_list_objects_avg_time           | Average time to list objects               | milliseconds  |
| noobaa_nsfs_op_list_objects_count              | Number of list objects operations          | operations    |
| noobaa_nsfs_op_list_objects_error_count        | Number of errors in listing objects        | errors        |
| noobaa_nsfs_op_initiate_multipart_min_time     | Minimum time to initiate multipart upload  | milliseconds  |
| noobaa_nsfs_op_initiate_multipart_max_time     | Maximum time to initiate multipart upload  | milliseconds  |
| noobaa_nsfs_op_initiate_multipart_avg_time     | Average time to initiate multipart upload  | milliseconds  |
| noobaa_nsfs_op_initiate_multipart_count        | Number of initiate multipart operations   | operations    |
| noobaa_nsfs_op_initiate_multipart_error_count  | Number of errors in initiating multipart  | errors        |
| noobaa_nsfs_op_upload_part_min_time            | Minimum time to upload a part              | milliseconds  |
| noobaa_nsfs_op_upload_part_max_time            | Maximum time to upload a part              | milliseconds  |
| noobaa_nsfs_op_upload_part_avg_time            | Average time to upload a part              | milliseconds  |
| noobaa_nsfs_op_upload_part_count               | Number of upload part operations          | operations    |
| noobaa_nsfs_op_upload_part_error_count         | Number of errors in uploading parts       | errors        |
| noobaa_nsfs_op_complete_object_upload_min_time | Minimum time to complete object upload    | milliseconds  |
| noobaa_nsfs_op_complete_object_upload_max_time | Maximum time to complete object upload    | milliseconds  |
| noobaa_nsfs_op_complete_object_upload_avg_time | Average time to complete object upload    | milliseconds  |
| noobaa_nsfs_op_complete_object_upload_count    | Number of complete object upload operations | operations |
| noobaa_nsfs_op_complete_object_upload_error_count | Number of errors in completing object upload | errors   |

### IAM Per-Operation Metrics

The Per-Operation Metrics table details the performance and count of specific operations related to IAM management. It includes metrics such as the minimum, maximum, and average time taken for creating, deleting and listing both users and access-keys. Additionally, it tracks the total number of operations and any errors encountered. These metrics are essential for analyzing the efficiency and reliability of different operations within the system.


| Metric Name                                      | Description                              | Unit          |
|--------------------------------------------------|------------------------------------------|---------------|
| noobaa_nsfs_iam_op_create_user_min_time          | Minimum time to create a user            | milliseconds  |
| noobaa_nsfs_iam_op_create_user_max_time          | Maximum time to create a user            | milliseconds  |
| noobaa_nsfs_iam_op_create_user_avg_time          | Average time to create a user            | milliseconds  |
| noobaa_nsfs_iam_op_create_user_count             | Number of create user operations         | operations    |
| noobaa_nsfs_iam_op_create_user_error_count       | Number of errors in creating users       | errors        |
| noobaa_nsfs_iam_op_delete_user_min_time          | Minimum time to delete a user            | milliseconds  |
| noobaa_nsfs_iam_op_delete_user_max_time          | Maximum time to delete a user            | milliseconds  |
| noobaa_nsfs_iam_op_delete_user_avg_time          | Average time to delete a user            | milliseconds  |
| noobaa_nsfs_iam_op_delete_user_count             | Number of delete user operations         | operations    |
| noobaa_nsfs_iam_op_delete_user_error_count       | Number of errors in deleting users       | errors        |
| noobaa_nsfs_iam_op_list_users_min_time           | Minimum time to list users               | milliseconds  |
| noobaa_nsfs_iam_op_list_users_max_time           | Maximum time to list users               | milliseconds  |
| noobaa_nsfs_iam_op_list_users_avg_time           | Average time to list users               | milliseconds  |
| noobaa_nsfs_iam_op_list_users_count              | Number of list users operations          | operations    |
| noobaa_nsfs_iam_op_list_users_error_count        | Number of errors in listing users        | errors        |
| noobaa_nsfs_iam_op_create_access_key_min_time    | Minimum time to create an access key     | milliseconds  |
| noobaa_nsfs_iam_op_create_access_key_max_time    | Maximum time to create an access key     | milliseconds  |
| noobaa_nsfs_iam_op_create_access_key_avg_time    | Average time to create an access key     | milliseconds  |
| noobaa_nsfs_iam_op_create_access_key_count       | Number of create access key operations   | operations    |
| noobaa_nsfs_iam_op_create_access_key_error_count | Number of errors in creating access keys | errors        |
| noobaa_nsfs_iam_op_delete_access_key_min_time    | Minimum time to delete an access key     | milliseconds  |
| noobaa_nsfs_iam_op_delete_access_key_max_time    | Maximum time to delete an access key     | milliseconds  |
| noobaa_nsfs_iam_op_delete_access_key_avg_time    | Average time to delete an access key     | milliseconds  |
| noobaa_nsfs_iam_op_delete_access_key_count       | Number of delete access key operations   | operations    |
| noobaa_nsfs_iam_op_delete_access_key_error_count | Number of errors in deleting access keys | errors        |
| noobaa_nsfs_iam_op_list_access_keys_min_time     | Minimum time to list access keys         | milliseconds  |
| noobaa_nsfs_iam_op_list_access_keys_max_time     | Maximum time to list access keys         | milliseconds  |
| noobaa_nsfs_iam_op_list_access_keys_avg_time     | Average time to list access keys         | milliseconds  |
| noobaa_nsfs_iam_op_list_access_keys_count        | Number of list access keys operations    | operations    |
| noobaa_nsfs_iam_op_list_access_keys_error_count  | Number of errors in listing access keys  | errors        |


## Getting Started

This section will walk you through the initial steps required to enable the NSFS service and subsequently fetch the relevant metrics. By following these instructions, you'll gain access to detailed information about bucket and I/O operations, which can help you monitor and optimize your system performance.

#### 1. Enabling the NSFS Service </br>
To begin collecting metrics, you need to enable the NSFS service. Follow the steps specified in [NooBaa Non Containerized Configuration](./Configuration.md)


#### 2. Running I/O Operations
After enabling the NSFS service, you'll need to perform some I/O operations to generate metrics. Follow these steps:

- Create an account -</br>
Use NooBaa CLI for creating an account

- Create a bucket -</br>
Create a bucket using S3 (S3 bucket) or using NooBaa CLI (exported bucket).

- Upload and Download Objects -</br>
Upload and Download objects to/from the selected bucket (step 2) using the newly created account (step 1).
Ensure that a variety of object sizes and types are uploaded to generate diverse metrics.
Repeat this process multiple times to create significant I/O activity.

For specific command examples, refer to the steps outlined in [NooBaa Non Containerized Configuration](./Configuration.md)

#### 3. Fetching Metrics
Once the NSFS service is enabled, you can fetch the Prometheus metrics to monitor your system. Open a new tab and follow these steps:

```sh
noobaa-cli diagnose metrics
# OR directly fetch
curl -s http://127.0.0.1:7004/metrics/nsfs_stats | jq .
```
 
## Examples

### NooBaa CLI Metrics Command Example

The following is an example of the JSON output containing system metrics -

```shell
> noobaa-cli diagnose metrics
{
    "response": {
    "code": "MetricsStatus",
    "reply": {
        "nsfs_counters": {
            "noobaa_nsfs_io_read_count":1,
            "noobaa_nsfs_io_write_count":2,
            "noobaa_nsfs_io_read_bytes":49,
            "noobaa_nsfs_io_write_bytes":98
        },
        "op_stats_counters": {
            "noobaa_nsfs_op_create_bucket_min_time_milisec":15,
            "noobaa_nsfs_op_create_bucket_max_time_milisec":15,
            "noobaa_nsfs_op_create_bucket_avg_time_milisec":15,
            "noobaa_nsfs_op_create_bucket_count":1,
            "noobaa_nsfs_op_create_bucket_error_count":0,
            "noobaa_nsfs_op_upload_object_min_time_milisec":15,
            "noobaa_nsfs_op_upload_object_max_time_milisec":20,
            "noobaa_nsfs_op_upload_object_avg_time_milisec":17,
            "noobaa_nsfs_op_upload_object_count":2,
            "noobaa_nsfs_op_upload_object_error_count":0,
            "noobaa_nsfs_op_head_object_min_time_milisec":2,
            "noobaa_nsfs_op_head_object_max_time_milisec":3,
            "noobaa_nsfs_op_head_object_avg_time_milisec":2,
            "noobaa_nsfs_op_head_object_count":2,
            "noobaa_nsfs_op_head_object_error_count":0,
            "noobaa_nsfs_op_read_object_min_time_milisec":12,
            "noobaa_nsfs_op_read_object_max_time_milisec":12,
            "noobaa_nsfs_op_read_object_avg_time_milisec":12,
            "noobaa_nsfs_op_read_object_count":1,
            "noobaa_nsfs_op_read_object_error_count":0
        },
        "iam_op_stats_counters": {
            "noobaa_nsfs_iam_op_list_users_min_time_milisec": 0,
            "noobaa_nsfs_iam_op_list_users_max_time_milisec": 1,
            "noobaa_nsfs_iam_op_list_users_avg_time_milisec": 0,
            "noobaa_nsfs_iam_op_list_users_count": 2,
            "noobaa_nsfs_iam_op_list_users_error_count": 0
        }
    }
}
```


### Direct Metrics Fetch Example

The following is an example of the JSON output containing system metrics -

```shell
> curl -s http://127.0.0.1:7004/metrics/nsfs_stats | jq .
{
    "nsfs_counters": {
        "noobaa_nsfs_io_read_count":1,
        "noobaa_nsfs_io_write_count":2,
        "noobaa_nsfs_io_read_bytes":49,
        "noobaa_nsfs_io_write_bytes":98
    },
    "op_stats_counters": {
        "noobaa_nsfs_op_create_bucket_min_time_milisec":15,
        "noobaa_nsfs_op_create_bucket_max_time_milisec":15,
        "noobaa_nsfs_op_create_bucket_avg_time_milisec":15,
        "noobaa_nsfs_op_create_bucket_count":1,
        "noobaa_nsfs_op_create_bucket_error_count":0,
        "noobaa_nsfs_op_upload_object_min_time_milisec":15,
        "noobaa_nsfs_op_upload_object_max_time_milisec":20,
        "noobaa_nsfs_op_upload_object_avg_time_milisec":17,
        "noobaa_nsfs_op_upload_object_count":2,
        "noobaa_nsfs_op_upload_object_error_count":0,
        "noobaa_nsfs_op_head_object_min_time_milisec":2,
        "noobaa_nsfs_op_head_object_max_time_milisec":3,
        "noobaa_nsfs_op_head_object_avg_time_milisec":2,
        "noobaa_nsfs_op_head_object_count":2,
        "noobaa_nsfs_op_head_object_error_count":0,
        "noobaa_nsfs_op_read_object_min_time_milisec":12,
        "noobaa_nsfs_op_read_object_max_time_milisec":12,
        "noobaa_nsfs_op_read_object_avg_time_milisec":12,
        "noobaa_nsfs_op_read_object_count":1,
        "noobaa_nsfs_op_read_object_error_count":0
    },
    "iam_op_stats_counters": {
        "noobaa_nsfs_iam_op_list_users_min_time_milisec": 0,
        "noobaa_nsfs_iam_op_list_users_max_time_milisec": 1,
        "noobaa_nsfs_iam_op_list_users_avg_time_milisec": 0,
        "noobaa_nsfs_iam_op_list_users_count": 2,
        "noobaa_nsfs_iam_op_list_users_error_count": 0
    }
}
```
