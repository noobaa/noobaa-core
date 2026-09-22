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

The Per-Operation Metrics table details the performance and count of specific operations related to IAM management. It includes metrics such as the minimum, maximum, and average time taken for creating, getting, updating, deleting and listing both users and access-keys. Additionally, it tracks the total number of operations and any errors encountered. These metrics are essential for analyzing the efficiency and reliability of different operations within the system.


| Metric Name                                                    | Description                                    | Unit          |
|----------------------------------------------------------------|------------------------------------------------|---------------|
| noobaa_nsfs_iam_op_create_user_min_time_milisec                | Minimum time to create a user                  | milliseconds  |
| noobaa_nsfs_iam_op_create_user_max_time_milisec                | Maximum time to create a user                  | milliseconds  |
| noobaa_nsfs_iam_op_create_user_avg_time_milisec                | Average time to create a user                  | milliseconds  |
| noobaa_nsfs_iam_op_create_user_count                           | Number of create user operations               | operations    |
| noobaa_nsfs_iam_op_create_user_error_count                     | Number of errors in creating users             | errors        |
| noobaa_nsfs_iam_op_get_user_min_time_milisec                   | Minimum time to get a user                     | milliseconds  |
| noobaa_nsfs_iam_op_get_user_max_time_milisec                   | Maximum time to get a user                     | milliseconds  |
| noobaa_nsfs_iam_op_get_user_avg_time_milisec                   | Average time to get a user                     | milliseconds  |
| noobaa_nsfs_iam_op_get_user_count                              | Number of get user operations                  | operations    |
| noobaa_nsfs_iam_op_get_user_error_count                        | Number of errors in getting users              | errors        |
| noobaa_nsfs_iam_op_update_user_min_time_milisec                | Minimum time to update a user                  | milliseconds  |
| noobaa_nsfs_iam_op_update_user_max_time_milisec                | Maximum time to update a user                  | milliseconds  |
| noobaa_nsfs_iam_op_update_user_avg_time_milisec                | Average time to update a user                  | milliseconds  |
| noobaa_nsfs_iam_op_update_user_count                           | Number of update user operations               | operations    |
| noobaa_nsfs_iam_op_update_user_error_count                     | Number of errors in updating users             | errors        |
| noobaa_nsfs_iam_op_delete_user_min_time_milisec                | Minimum time to delete a user                  | milliseconds  |
| noobaa_nsfs_iam_op_delete_user_max_time_milisec                | Maximum time to delete a user                  | milliseconds  |
| noobaa_nsfs_iam_op_delete_user_avg_time_milisec                | Average time to delete a user                  | milliseconds  |
| noobaa_nsfs_iam_op_delete_user_count                           | Number of delete user operations               | operations    |
| noobaa_nsfs_iam_op_delete_user_error_count                     | Number of errors in deleting users             | errors        |
| noobaa_nsfs_iam_op_list_users_min_time_milisec                 | Minimum time to list users                     | milliseconds  |
| noobaa_nsfs_iam_op_list_users_max_time_milisec                 | Maximum time to list users                     | milliseconds  |
| noobaa_nsfs_iam_op_list_users_avg_time_milisec                 | Average time to list users                     | milliseconds  |
| noobaa_nsfs_iam_op_list_users_count                            | Number of list users operations                | operations    |
| noobaa_nsfs_iam_op_list_users_error_count                      | Number of errors in listing users              | errors        |
| noobaa_nsfs_iam_op_create_access_key_min_time_milisec          | Minimum time to create an access key           | milliseconds  |
| noobaa_nsfs_iam_op_create_access_key_max_time_milisec          | Maximum time to create an access key           | milliseconds  |
| noobaa_nsfs_iam_op_create_access_key_avg_time_milisec          | Average time to create an access key           | milliseconds  |
| noobaa_nsfs_iam_op_create_access_key_count                     | Number of create access key operations         | operations    |
| noobaa_nsfs_iam_op_create_access_key_error_count               | Number of errors in creating access keys       | errors        |
| noobaa_nsfs_iam_op_get_access_key_last_used_min_time_milisec   | Minimum time to get access key last used       | milliseconds  |
| noobaa_nsfs_iam_op_get_access_key_last_used_max_time_milisec   | Maximum time to get access key last used       | milliseconds  |
| noobaa_nsfs_iam_op_get_access_key_last_used_avg_time_milisec   | Average time to get access key last used       | milliseconds  |
| noobaa_nsfs_iam_op_get_access_key_last_used_count              | Number of get access key last used operations  | operations    |
| noobaa_nsfs_iam_op_get_access_key_last_used_error_count        | Number of errors in getting access key         | errors        |
| noobaa_nsfs_iam_op_update_access_key_min_time_milisec          | Minimum time to update an access key           | milliseconds  |
| noobaa_nsfs_iam_op_update_access_key_max_time_milisec          | Maximum time to update an access key           | milliseconds  |
| noobaa_nsfs_iam_op_update_access_key_avg_time_milisec          | Average time to update an access key           | milliseconds  |
| noobaa_nsfs_iam_op_update_access_key_count                     | Number of update access key operations         | operations    |
| noobaa_nsfs_iam_op_update_access_key_error_count               | Number of errors in updating access keys       | errors        |
| noobaa_nsfs_iam_op_delete_access_key_min_time_milisec          | Minimum time to delete an access key           | milliseconds  |
| noobaa_nsfs_iam_op_delete_access_key_max_time_milisec          | Maximum time to delete an access key           | milliseconds  |
| noobaa_nsfs_iam_op_delete_access_key_avg_time_milisec          | Average time to delete an access key           | milliseconds  |
| noobaa_nsfs_iam_op_delete_access_key_count                     | Number of delete access key operations         | operations    |
| noobaa_nsfs_iam_op_delete_access_key_error_count               | Number of errors in deleting access keys       | errors        |
| noobaa_nsfs_iam_op_list_access_keys_min_time_milisec           | Minimum time to list access keys               | milliseconds  |
| noobaa_nsfs_iam_op_list_access_keys_max_time_milisec           | Maximum time to list access keys               | milliseconds  |
| noobaa_nsfs_iam_op_list_access_keys_avg_time_milisec           | Average time to list access keys               | milliseconds  |
| noobaa_nsfs_iam_op_list_access_keys_count                      | Number of list access keys operations          | operations    |
| noobaa_nsfs_iam_op_list_access_keys_error_count                | Number of errors in listing access keys        | errors        |


### FS Worker Metrics

The FS Worker Metrics table details the performance and count of native filesystem operations performed by NSFS FS workers. It includes metrics such as the minimum, maximum, and average time taken for operations like stat, readfile, writefile, fileopen, and realpath. Additionally, it tracks the total number of operations and any errors encountered. These metrics are essential for analyzing filesystem-level latency and reliability.


| Metric Name                                          | Description                                         | Unit          |
|------------------------------------------------------|-----------------------------------------------------|---------------|
| noobaa_nsfs_fs_worker_stat_min_time_milisec                 | Minimum time to stat a path                         | milliseconds  |
| noobaa_nsfs_fs_worker_stat_max_time_milisec                 | Maximum time to stat a path                         | milliseconds  |
| noobaa_nsfs_fs_worker_stat_avg_time_milisec                 | Average time to stat a path                         | milliseconds  |
| noobaa_nsfs_fs_worker_stat_count                            | Number of stat operations                           | operations    |
| noobaa_nsfs_fs_worker_stat_error_count                      | Number of errors in stat operations                 | errors        |
| noobaa_nsfs_fs_worker_lstat_min_time_milisec                | Minimum time to lstat a path                        | milliseconds  |
| noobaa_nsfs_fs_worker_lstat_max_time_milisec                | Maximum time to lstat a path                        | milliseconds  |
| noobaa_nsfs_fs_worker_lstat_avg_time_milisec                | Average time to lstat a path                        | milliseconds  |
| noobaa_nsfs_fs_worker_lstat_count                           | Number of lstat operations                          | operations    |
| noobaa_nsfs_fs_worker_lstat_error_count                     | Number of errors in lstat operations                | errors        |
| noobaa_nsfs_fs_worker_statfs_min_time_milisec               | Minimum time to get filesystem statistics           | milliseconds  |
| noobaa_nsfs_fs_worker_statfs_max_time_milisec               | Maximum time to get filesystem statistics           | milliseconds  |
| noobaa_nsfs_fs_worker_statfs_avg_time_milisec               | Average time to get filesystem statistics           | milliseconds  |
| noobaa_nsfs_fs_worker_statfs_count                          | Number of statfs operations                         | operations    |
| noobaa_nsfs_fs_worker_statfs_error_count                    | Number of errors in statfs operations               | errors        |
| noobaa_nsfs_fs_worker_checkaccess_min_time_milisec          | Minimum time to check path access                   | milliseconds  |
| noobaa_nsfs_fs_worker_checkaccess_max_time_milisec          | Maximum time to check path access                   | milliseconds  |
| noobaa_nsfs_fs_worker_checkaccess_avg_time_milisec          | Average time to check path access                   | milliseconds  |
| noobaa_nsfs_fs_worker_checkaccess_count                     | Number of checkaccess operations                    | operations    |
| noobaa_nsfs_fs_worker_checkaccess_error_count               | Number of errors in checkaccess operations          | errors        |
| noobaa_nsfs_fs_worker_unlink_min_time_milisec               | Minimum time to unlink a file                       | milliseconds  |
| noobaa_nsfs_fs_worker_unlink_max_time_milisec               | Maximum time to unlink a file                       | milliseconds  |
| noobaa_nsfs_fs_worker_unlink_avg_time_milisec               | Average time to unlink a file                       | milliseconds  |
| noobaa_nsfs_fs_worker_unlink_count                          | Number of unlink operations                         | operations    |
| noobaa_nsfs_fs_worker_unlink_error_count                    | Number of errors in unlink operations               | errors        |
| noobaa_nsfs_fs_worker_unlinkat_min_time_milisec             | Minimum time to unlinkat a file                     | milliseconds  |
| noobaa_nsfs_fs_worker_unlinkat_max_time_milisec             | Maximum time to unlinkat a file                     | milliseconds  |
| noobaa_nsfs_fs_worker_unlinkat_avg_time_milisec             | Average time to unlinkat a file                     | milliseconds  |
| noobaa_nsfs_fs_worker_unlinkat_count                        | Number of unlinkat operations                       | operations    |
| noobaa_nsfs_fs_worker_unlinkat_error_count                  | Number of errors in unlinkat operations             | errors        |
| noobaa_nsfs_fs_worker_link_min_time_milisec                 | Minimum time to create a hard link                  | milliseconds  |
| noobaa_nsfs_fs_worker_link_max_time_milisec                 | Maximum time to create a hard link                  | milliseconds  |
| noobaa_nsfs_fs_worker_link_avg_time_milisec                 | Average time to create a hard link                  | milliseconds  |
| noobaa_nsfs_fs_worker_link_count                            | Number of link operations                           | operations    |
| noobaa_nsfs_fs_worker_link_error_count                      | Number of errors in link operations                 | errors        |
| noobaa_nsfs_fs_worker_linkat_min_time_milisec               | Minimum time to create a hard link with linkat      | milliseconds  |
| noobaa_nsfs_fs_worker_linkat_max_time_milisec               | Maximum time to create a hard link with linkat      | milliseconds  |
| noobaa_nsfs_fs_worker_linkat_avg_time_milisec               | Average time to create a hard link with linkat      | milliseconds  |
| noobaa_nsfs_fs_worker_linkat_count                          | Number of linkat operations                         | operations    |
| noobaa_nsfs_fs_worker_linkat_error_count                    | Number of errors in linkat operations               | errors        |
| noobaa_nsfs_fs_worker_mkdir_min_time_milisec                | Minimum time to create a directory                  | milliseconds  |
| noobaa_nsfs_fs_worker_mkdir_max_time_milisec                | Maximum time to create a directory                  | milliseconds  |
| noobaa_nsfs_fs_worker_mkdir_avg_time_milisec                | Average time to create a directory                  | milliseconds  |
| noobaa_nsfs_fs_worker_mkdir_count                           | Number of mkdir operations                          | operations    |
| noobaa_nsfs_fs_worker_mkdir_error_count                     | Number of errors in mkdir operations                | errors        |
| noobaa_nsfs_fs_worker_rmdir_min_time_milisec                | Minimum time to remove a directory                  | milliseconds  |
| noobaa_nsfs_fs_worker_rmdir_max_time_milisec                | Maximum time to remove a directory                  | milliseconds  |
| noobaa_nsfs_fs_worker_rmdir_avg_time_milisec                | Average time to remove a directory                  | milliseconds  |
| noobaa_nsfs_fs_worker_rmdir_count                           | Number of rmdir operations                          | operations    |
| noobaa_nsfs_fs_worker_rmdir_error_count                     | Number of errors in rmdir operations                | errors        |
| noobaa_nsfs_fs_worker_rename_min_time_milisec               | Minimum time to rename a file or directory          | milliseconds  |
| noobaa_nsfs_fs_worker_rename_max_time_milisec               | Maximum time to rename a file or directory          | milliseconds  |
| noobaa_nsfs_fs_worker_rename_avg_time_milisec               | Average time to rename a file or directory          | milliseconds  |
| noobaa_nsfs_fs_worker_rename_count                          | Number of rename operations                         | operations    |
| noobaa_nsfs_fs_worker_rename_error_count                    | Number of errors in rename operations               | errors        |
| noobaa_nsfs_fs_worker_writefile_min_time_milisec            | Minimum time to write a file                        | milliseconds  |
| noobaa_nsfs_fs_worker_writefile_max_time_milisec            | Maximum time to write a file                        | milliseconds  |
| noobaa_nsfs_fs_worker_writefile_avg_time_milisec            | Average time to write a file                        | milliseconds  |
| noobaa_nsfs_fs_worker_writefile_count                       | Number of writefile operations                      | operations    |
| noobaa_nsfs_fs_worker_writefile_error_count                 | Number of errors in writefile operations            | errors        |
| noobaa_nsfs_fs_worker_readfile_min_time_milisec             | Minimum time to read a file                         | milliseconds  |
| noobaa_nsfs_fs_worker_readfile_max_time_milisec             | Maximum time to read a file                         | milliseconds  |
| noobaa_nsfs_fs_worker_readfile_avg_time_milisec             | Average time to read a file                         | milliseconds  |
| noobaa_nsfs_fs_worker_readfile_count                        | Number of readfile operations                       | operations    |
| noobaa_nsfs_fs_worker_readfile_error_count                  | Number of errors in readfile operations             | errors        |
| noobaa_nsfs_fs_worker_readdir_min_time_milisec              | Minimum time to read a directory                    | milliseconds  |
| noobaa_nsfs_fs_worker_readdir_max_time_milisec              | Maximum time to read a directory                    | milliseconds  |
| noobaa_nsfs_fs_worker_readdir_avg_time_milisec              | Average time to read a directory                    | milliseconds  |
| noobaa_nsfs_fs_worker_readdir_count                         | Number of readdir operations                        | operations    |
| noobaa_nsfs_fs_worker_readdir_error_count                   | Number of errors in readdir operations              | errors        |
| noobaa_nsfs_fs_worker_fsync_min_time_milisec                | Minimum time to fsync a path                        | milliseconds  |
| noobaa_nsfs_fs_worker_fsync_max_time_milisec                | Maximum time to fsync a path                        | milliseconds  |
| noobaa_nsfs_fs_worker_fsync_avg_time_milisec                | Average time to fsync a path                        | milliseconds  |
| noobaa_nsfs_fs_worker_fsync_count                           | Number of fsync operations                          | operations    |
| noobaa_nsfs_fs_worker_fsync_error_count                     | Number of errors in fsync operations                | errors        |
| noobaa_nsfs_fs_worker_fileopen_min_time_milisec             | Minimum time to open a file                         | milliseconds  |
| noobaa_nsfs_fs_worker_fileopen_max_time_milisec             | Maximum time to open a file                         | milliseconds  |
| noobaa_nsfs_fs_worker_fileopen_avg_time_milisec             | Average time to open a file                         | milliseconds  |
| noobaa_nsfs_fs_worker_fileopen_count                        | Number of fileopen operations                       | operations    |
| noobaa_nsfs_fs_worker_fileopen_error_count                  | Number of errors in fileopen operations             | errors        |
| noobaa_nsfs_fs_worker_fileclose_min_time_milisec            | Minimum time to close a file                        | milliseconds  |
| noobaa_nsfs_fs_worker_fileclose_max_time_milisec            | Maximum time to close a file                        | milliseconds  |
| noobaa_nsfs_fs_worker_fileclose_avg_time_milisec            | Average time to close a file                        | milliseconds  |
| noobaa_nsfs_fs_worker_fileclose_count                       | Number of fileclose operations                      | operations    |
| noobaa_nsfs_fs_worker_fileclose_error_count                 | Number of errors in fileclose operations            | errors        |
| noobaa_nsfs_fs_worker_fileread_min_time_milisec             | Minimum time to read from an open file              | milliseconds  |
| noobaa_nsfs_fs_worker_fileread_max_time_milisec             | Maximum time to read from an open file              | milliseconds  |
| noobaa_nsfs_fs_worker_fileread_avg_time_milisec             | Average time to read from an open file              | milliseconds  |
| noobaa_nsfs_fs_worker_fileread_count                        | Number of fileread operations                       | operations    |
| noobaa_nsfs_fs_worker_fileread_error_count                  | Number of errors in fileread operations             | errors        |
| noobaa_nsfs_fs_worker_filewrite_min_time_milisec            | Minimum time to write to an open file               | milliseconds  |
| noobaa_nsfs_fs_worker_filewrite_max_time_milisec            | Maximum time to write to an open file               | milliseconds  |
| noobaa_nsfs_fs_worker_filewrite_avg_time_milisec            | Average time to write to an open file               | milliseconds  |
| noobaa_nsfs_fs_worker_filewrite_count                       | Number of filewrite operations                      | operations    |
| noobaa_nsfs_fs_worker_filewrite_error_count                 | Number of errors in filewrite operations            | errors        |
| noobaa_nsfs_fs_worker_filewritev_min_time_milisec           | Minimum time to vectored-write to an open file      | milliseconds  |
| noobaa_nsfs_fs_worker_filewritev_max_time_milisec           | Maximum time to vectored-write to an open file      | milliseconds  |
| noobaa_nsfs_fs_worker_filewritev_avg_time_milisec           | Average time to vectored-write to an open file      | milliseconds  |
| noobaa_nsfs_fs_worker_filewritev_count                      | Number of filewritev operations                     | operations    |
| noobaa_nsfs_fs_worker_filewritev_error_count                | Number of errors in filewritev operations           | errors        |
| noobaa_nsfs_fs_worker_filereplacexattr_min_time_milisec     | Minimum time to replace file extended attributes    | milliseconds  |
| noobaa_nsfs_fs_worker_filereplacexattr_max_time_milisec     | Maximum time to replace file extended attributes    | milliseconds  |
| noobaa_nsfs_fs_worker_filereplacexattr_avg_time_milisec     | Average time to replace file extended attributes    | milliseconds  |
| noobaa_nsfs_fs_worker_filereplacexattr_count                | Number of filereplacexattr operations               | operations    |
| noobaa_nsfs_fs_worker_filereplacexattr_error_count          | Number of errors in filereplacexattr operations     | errors        |
| noobaa_nsfs_fs_worker_linkfileat_min_time_milisec           | Minimum time to create a hard link from an open file | milliseconds |
| noobaa_nsfs_fs_worker_linkfileat_max_time_milisec           | Maximum time to create a hard link from an open file | milliseconds |
| noobaa_nsfs_fs_worker_linkfileat_avg_time_milisec           | Average time to create a hard link from an open file | milliseconds |
| noobaa_nsfs_fs_worker_linkfileat_count                      | Number of linkfileat operations                     | operations    |
| noobaa_nsfs_fs_worker_linkfileat_error_count                | Number of errors in linkfileat operations           | errors        |
| noobaa_nsfs_fs_worker_filegetxattr_min_time_milisec         | Minimum time to get file extended attributes        | milliseconds  |
| noobaa_nsfs_fs_worker_filegetxattr_max_time_milisec         | Maximum time to get file extended attributes        | milliseconds  |
| noobaa_nsfs_fs_worker_filegetxattr_avg_time_milisec         | Average time to get file extended attributes        | milliseconds  |
| noobaa_nsfs_fs_worker_filegetxattr_count                    | Number of filegetxattr operations                   | operations    |
| noobaa_nsfs_fs_worker_filegetxattr_error_count              | Number of errors in filegetxattr operations         | errors        |
| noobaa_nsfs_fs_worker_filestat_min_time_milisec             | Minimum time to stat an open file                   | milliseconds  |
| noobaa_nsfs_fs_worker_filestat_max_time_milisec             | Maximum time to stat an open file                   | milliseconds  |
| noobaa_nsfs_fs_worker_filestat_avg_time_milisec             | Average time to stat an open file                   | milliseconds  |
| noobaa_nsfs_fs_worker_filestat_count                        | Number of filestat operations                       | operations    |
| noobaa_nsfs_fs_worker_filestat_error_count                  | Number of errors in filestat operations             | errors        |
| noobaa_nsfs_fs_worker_filefsync_min_time_milisec            | Minimum time to fsync an open file                  | milliseconds  |
| noobaa_nsfs_fs_worker_filefsync_max_time_milisec            | Maximum time to fsync an open file                  | milliseconds  |
| noobaa_nsfs_fs_worker_filefsync_avg_time_milisec            | Average time to fsync an open file                  | milliseconds  |
| noobaa_nsfs_fs_worker_filefsync_count                       | Number of filefsync operations                      | operations    |
| noobaa_nsfs_fs_worker_filefsync_error_count                 | Number of errors in filefsync operations            | errors        |
| noobaa_nsfs_fs_worker_realpath_min_time_milisec             | Minimum time to resolve a path                      | milliseconds  |
| noobaa_nsfs_fs_worker_realpath_max_time_milisec             | Maximum time to resolve a path                      | milliseconds  |
| noobaa_nsfs_fs_worker_realpath_avg_time_milisec             | Average time to resolve a path                      | milliseconds  |
| noobaa_nsfs_fs_worker_realpath_count                        | Number of realpath operations                       | operations    |
| noobaa_nsfs_fs_worker_realpath_error_count                  | Number of errors in realpath operations             | errors        |
| noobaa_nsfs_fs_worker_getsinglexattr_min_time_milisec       | Minimum time to get a single extended attribute     | milliseconds  |
| noobaa_nsfs_fs_worker_getsinglexattr_max_time_milisec       | Maximum time to get a single extended attribute     | milliseconds  |
| noobaa_nsfs_fs_worker_getsinglexattr_avg_time_milisec       | Average time to get a single extended attribute     | milliseconds  |
| noobaa_nsfs_fs_worker_getsinglexattr_count                  | Number of getsinglexattr operations                 | operations    |
| noobaa_nsfs_fs_worker_getsinglexattr_error_count            | Number of errors in getsinglexattr operations       | errors        |
| noobaa_nsfs_fs_worker_diropen_min_time_milisec              | Minimum time to open a directory                    | milliseconds  |
| noobaa_nsfs_fs_worker_diropen_max_time_milisec              | Maximum time to open a directory                    | milliseconds  |
| noobaa_nsfs_fs_worker_diropen_avg_time_milisec              | Average time to open a directory                    | milliseconds  |
| noobaa_nsfs_fs_worker_diropen_count                         | Number of diropen operations                        | operations    |
| noobaa_nsfs_fs_worker_diropen_error_count                   | Number of errors in diropen operations              | errors        |
| noobaa_nsfs_fs_worker_dirclose_min_time_milisec             | Minimum time to close a directory                   | milliseconds  |
| noobaa_nsfs_fs_worker_dirclose_max_time_milisec             | Maximum time to close a directory                   | milliseconds  |
| noobaa_nsfs_fs_worker_dirclose_avg_time_milisec             | Average time to close a directory                   | milliseconds  |
| noobaa_nsfs_fs_worker_dirclose_count                        | Number of dirclose operations                       | operations    |
| noobaa_nsfs_fs_worker_dirclose_error_count                  | Number of errors in dirclose operations             | errors        |
| noobaa_nsfs_fs_worker_dirreadentry_min_time_milisec         | Minimum time to read a directory entry              | milliseconds  |
| noobaa_nsfs_fs_worker_dirreadentry_max_time_milisec         | Maximum time to read a directory entry              | milliseconds  |
| noobaa_nsfs_fs_worker_dirreadentry_avg_time_milisec         | Average time to read a directory entry              | milliseconds  |
| noobaa_nsfs_fs_worker_dirreadentry_count                    | Number of dirreadentry operations                   | operations    |
| noobaa_nsfs_fs_worker_dirreadentry_error_count              | Number of errors in dirreadentry operations         | errors        |
| noobaa_nsfs_fs_worker_safelink_min_time_milisec             | Minimum time to create a safe hard link             | milliseconds  |
| noobaa_nsfs_fs_worker_safelink_max_time_milisec             | Maximum time to create a safe hard link             | milliseconds  |
| noobaa_nsfs_fs_worker_safelink_avg_time_milisec             | Average time to create a safe hard link             | milliseconds  |
| noobaa_nsfs_fs_worker_safelink_count                        | Number of safelink operations                       | operations    |
| noobaa_nsfs_fs_worker_safelink_error_count                  | Number of errors in safelink operations             | errors        |
| noobaa_nsfs_fs_worker_safeunlink_min_time_milisec           | Minimum time to safely unlink a file                | milliseconds  |
| noobaa_nsfs_fs_worker_safeunlink_max_time_milisec           | Maximum time to safely unlink a file                | milliseconds  |
| noobaa_nsfs_fs_worker_safeunlink_avg_time_milisec           | Average time to safely unlink a file                | milliseconds  |
| noobaa_nsfs_fs_worker_safeunlink_count                      | Number of safeunlink operations                     | operations    |
| noobaa_nsfs_fs_worker_safeunlink_error_count                | Number of errors in safeunlink operations           | errors        |


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
        },
        "fs_worker_stats_counters": {
            "noobaa_nsfs_fs_worker_readfile_min_time_milisec": 45,
            "noobaa_nsfs_fs_worker_readfile_max_time_milisec": 330,
            "noobaa_nsfs_fs_worker_readfile_avg_time_milisec": 225,
            "noobaa_nsfs_fs_worker_readfile_count": 3,
            "noobaa_nsfs_fs_worker_readfile_error_count": 0,
            "noobaa_nsfs_fs_worker_stat_min_time_milisec": 29,
            "noobaa_nsfs_fs_worker_stat_max_time_milisec": 165,
            "noobaa_nsfs_fs_worker_stat_avg_time_milisec": 79,
            "noobaa_nsfs_fs_worker_stat_count": 24,
            "noobaa_nsfs_fs_worker_stat_error_count": 0,
            "noobaa_nsfs_fs_worker_realpath_min_time_milisec": 17,
            "noobaa_nsfs_fs_worker_realpath_max_time_milisec": 20,
            "noobaa_nsfs_fs_worker_realpath_avg_time_milisec": 18,
            "noobaa_nsfs_fs_worker_realpath_count": 3,
            "noobaa_nsfs_fs_worker_realpath_error_count": 0,
            "noobaa_nsfs_fs_worker_fileopen_min_time_milisec": 31,
            "noobaa_nsfs_fs_worker_fileopen_max_time_milisec": 31,
            "noobaa_nsfs_fs_worker_fileopen_avg_time_milisec": 31,
            "noobaa_nsfs_fs_worker_fileopen_count": 1,
            "noobaa_nsfs_fs_worker_fileopen_error_count": 0,
            "noobaa_nsfs_fs_worker_filestat_min_time_milisec": 137,
            "noobaa_nsfs_fs_worker_filestat_max_time_milisec": 137,
            "noobaa_nsfs_fs_worker_filestat_avg_time_milisec": 137,
            "noobaa_nsfs_fs_worker_filestat_count": 1,
            "noobaa_nsfs_fs_worker_filestat_error_count": 0,
            "noobaa_nsfs_fs_worker_fileread_min_time_milisec": 190,
            "noobaa_nsfs_fs_worker_fileread_max_time_milisec": 190,
            "noobaa_nsfs_fs_worker_fileread_avg_time_milisec": 190,
            "noobaa_nsfs_fs_worker_fileread_count": 1,
            "noobaa_nsfs_fs_worker_fileread_error_count": 0,
            "noobaa_nsfs_fs_worker_fileclose_min_time_milisec": 13,
            "noobaa_nsfs_fs_worker_fileclose_max_time_milisec": 13,
            "noobaa_nsfs_fs_worker_fileclose_avg_time_milisec": 13,
            "noobaa_nsfs_fs_worker_fileclose_count": 1,
            "noobaa_nsfs_fs_worker_fileclose_error_count": 0
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
    },
    "fs_worker_stats_counters": {
        "noobaa_nsfs_fs_worker_readfile_min_time_milisec": 45,
            "noobaa_nsfs_fs_worker_readfile_max_time_milisec": 330,
            "noobaa_nsfs_fs_worker_readfile_avg_time_milisec": 225,
            "noobaa_nsfs_fs_worker_readfile_count": 3,
            "noobaa_nsfs_fs_worker_readfile_error_count": 0,
            "noobaa_nsfs_fs_worker_stat_min_time_milisec": 29,
            "noobaa_nsfs_fs_worker_stat_max_time_milisec": 165,
            "noobaa_nsfs_fs_worker_stat_avg_time_milisec": 79,
            "noobaa_nsfs_fs_worker_stat_count": 24,
            "noobaa_nsfs_fs_worker_stat_error_count": 0,
            "noobaa_nsfs_fs_worker_realpath_min_time_milisec": 17,
            "noobaa_nsfs_fs_worker_realpath_max_time_milisec": 20,
            "noobaa_nsfs_fs_worker_realpath_avg_time_milisec": 18,
            "noobaa_nsfs_fs_worker_realpath_count": 3,
            "noobaa_nsfs_fs_worker_realpath_error_count": 0,
            "noobaa_nsfs_fs_worker_fileopen_min_time_milisec": 31,
            "noobaa_nsfs_fs_worker_fileopen_max_time_milisec": 31,
            "noobaa_nsfs_fs_worker_fileopen_avg_time_milisec": 31,
            "noobaa_nsfs_fs_worker_fileopen_count": 1,
            "noobaa_nsfs_fs_worker_fileopen_error_count": 0,
            "noobaa_nsfs_fs_worker_filestat_min_time_milisec": 137,
            "noobaa_nsfs_fs_worker_filestat_max_time_milisec": 137,
            "noobaa_nsfs_fs_worker_filestat_avg_time_milisec": 137,
            "noobaa_nsfs_fs_worker_filestat_count": 1,
            "noobaa_nsfs_fs_worker_filestat_error_count": 0,
            "noobaa_nsfs_fs_worker_fileread_min_time_milisec": 190,
            "noobaa_nsfs_fs_worker_fileread_max_time_milisec": 190,
            "noobaa_nsfs_fs_worker_fileread_avg_time_milisec": 190,
            "noobaa_nsfs_fs_worker_fileread_count": 1,
            "noobaa_nsfs_fs_worker_fileread_error_count": 0,
            "noobaa_nsfs_fs_worker_fileclose_min_time_milisec": 13,
            "noobaa_nsfs_fs_worker_fileclose_max_time_milisec": 13,
            "noobaa_nsfs_fs_worker_fileclose_avg_time_milisec": 13,
            "noobaa_nsfs_fs_worker_fileclose_count": 1,
            "noobaa_nsfs_fs_worker_fileclose_error_count": 0
    }
}
```
