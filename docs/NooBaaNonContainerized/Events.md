# NooBaa Non Containerized - Events

1. [Introduction](#introduction)
2. [Events log file location](#events-log-file-location)
3. [Events List](#events-list)
    1. [Normal Events](#normal-events)
    1. [Error Indicating Events](#error-indicating-events)

## Introduction

NooBaa Non Containerized generates events on the S3 and NooBaa CLI flows.  
This document will list all possible NooBaa Non Containerized events, their potential causes, and resolutions.

## Events Log File Location
Events logs file is available only when using syslog, the events log file location is at - `/var/log/noobaa_events.log`.

## Events List

### Normal Events

The following list includes events that indicate on a normal / successful operation -

#### 1. `noobaa_started`
- Description: NooBaa endpoint started successfully.

#### 2. `noobaa_account_created`
- Arguments: `account_name`
- Description: NooBaa account was created successfully using NooBaa CLI.

#### 3. `noobaa_account_deleted`
- Arguments: `account_name`
- Description: NooBaa account was deleted successfully using NooBaa CLI.

#### 4. `noobaa_bucket_created`
- Arguments:
    - `bucket_name`
    - `account_name`
    - `<tag_value>` (if `event` is `true` for the reserved tag)
- Description: NooBaa bucket was created successfully using NooBaa CLI or S3.

#### 5. `noobaa_bucket_deleted`
- Arguments: `bucket_name`
- Description: NooBaa bucket was deleted successfully using NooBaa CLI or S3.

#### 6. `noobaa_whitelist_updated`
- Arguments: `whitelist_ips`
- Description: Whitelist Server IPs updated successfully using NooBaa CLI.  

#### 7. `noobaa_bucket_reserved_tag_modified`
- Arguments:
    - `bucket_name`
    - `<tag_value>` (if `event` is `true` for the reserved tag)
- Description: NooBaa bucket reserved tag was modified successfully using NooBaa CLI or S3.

### Error Indicating Events

The following list includes events that indicate on some sort of malfunction or a problem -

#### 1. `noobaa_s3_crashed`
- Reasons:
    - NooBaa endpoint failed to start.
    - High NooBaa resource utilization.
- Resolutions: 
    - Check NooBaa resource utilization.

#### 2. `noobaa_fork_exit`
- Reasons:
    - One of the forks got an unrecoverable error and exited.
    - High NooBaa resource utilization.
- Resolutions: 
    - Check NooBaa resource utilization.

#### 3. `noobaa_gpfslib_missing`
- Arguments: 
    -  `gpfs_dl_path`  
- Reasons:
    - The GPFS library (`libgpfs`) path specified in `GPFS_DL_PATH` is missing.
- Resolutions: 
    - Check/Add GPFS library (`libgpfs`) in `GPFS_DL_PATH` path or update `GPFS_DL_PATH` to the correct location of the GPFS library.  

#### 4. `noobaa_bucket_creation_failed`
- Arguments: 
    - `bucket_name`
- Reasons:
    - A failure during the creation of the bucket config file.
    - Account does not have permission for creating to the bucket's underlying storage directory.
    - Bucket schema validation failed.
    - Etc.

- Resolutions:
    - Check access rights to the config directory path.
    - Check account's `new_buckets_path` property and verify adequate permission present for this directory. 

#### 5. `noobaa_bucket_delete_failed`
- Arguments:
    - `bucket_name`
    - `bucket_path`
- Reasons:
    - Account does not have permission to delete the bucket config file from the config directory path.
    - Account does not have permission to delete the bucket's underlying storage directory.

- Resolutions:
    - Check access rights to the config directory path.
    - Check account's `new_buckets_path` property and verify adequate permission present for this directory location. 

#### 6. `noobaa_bucket_not_found`
- Arguments:
    - `bucket_name`
- Reasons:
    - Bucket config file in the config directory is missing.
    - Bucket config JSON schema validation failed.
    - Bucket's underlying storage directory not found. 
- Resolutions:
    - Check for the valid bucket config file in config root directory.
    - Verify bucket config JSON schema.
    - Check for Bucket's underlying storage directory present with permission.

#### 7. `noobaa_object_get_failed`
- Arguments:
    - `bucket_path`
    - `object_name`
- Reasons:
    - NooBaa bucket path is missing.
    - Bucket I/O operation is failed.
- Resolutions:
    - Verify the bucket path.

#### 8. `noobaa_object_upload_failed`
- Arguments:
    - `bucket_path`
    - `object_name`
- Reasons:
    - Bucket path is outside the bucket boundaries.
    - Bucket storage class is not supported.
    - Object I/O operation is failed.
- Resolutions:
    - Make sure bucket storage class is supported.
    - Check for I/O operations.

#### 9. `noobaa_no_such_bucket`
- Arguments:
    - `bucket_name`
- Reasons:
    - Bucket does not exist.
- Resolutions:
    - List all the buckets and verify the bucket name exists in that list.
    - Check account has permission to access the listed buckets.

#### 10. `noobaa_bucket_already_exists`
- Arguments:
    - `bucket_name`
- Reasons:
    - A bucket having the same name already exists.
- Resolutions:
    - Replace the bucket name parameter.

#### 11. `noobaa_bucket_access_unauthorized`
- Arguments:
    - `bucket_name`
- Reasons:
    - Account does not have access to bucket or to the bucket directory.
- Resolutions:
    - Check account has permission to access the buckets.

#### 12. `noobaa_bucket_io_stream_item_timeout`
- Arguments:
    - `bucket_name`
- Reasons:
    - Bucket stream IO output throws time out error.
- Resolutions:
    - Make sure the account have a fast internet connection.
    - Check that both NooBaa and config directory resources are not overloaded.

#### 13. `noobaa_bucket_internal_error`
- Arguments:
    - `bucket_name`
- Reasons:
    - Bucket access failed due to an internal error.
- Resolutions:
    - Go through the event description and try to identify the root cause.

#### 14. `noobaa_account_exists`
- Arguments:
    - `account_name` / `access_key`
- Reasons:
    - NooBaa account with name/access key already exists in the system.
- Resolutions:
    - Replace the account name/access_key parameter.

#### 15. `noobaa_account_delete_forbidden`
- Arguments:
    - `account_name` / `access_key`
- Reasons:
    - NooBaa account deletion forbidden, Cannot delete account that is the owner of buckets. 
- Resolutions:
    - Make sure all buckets owned by account are deleted before deleting the account.

#### 16. `noobaa_whitelist_updated_failed`
- Arguments:  
    - `config_path`
- Reasons:  
    - Update of whitelist server IPs failed. 
    - Error while update config.json.
- Resolutions:  
    - Check that config.json exists in config directory.
    - Check that config.json is a valid JSON schema.

#### 17. `bucket_invalid_bucket_state`
- Arguments:
    - `bucket_name`  
- Reasons:
    - Bucket is in invalid state. Bucket schema missing required property or invalid property gets added.  
- Resolutions:
    - Check the bucket schema definition and make sure the required property is missing and the invalid property gets added in the config root path.

#### 18. `noobaa_notification_failed`
- Arguments
    - `name`
- Reasons:
    - No connectivity to external server.
- Resolutions:
    - Check if external server is reachable.

#### 19. `noobaa_notification_low_space`
- Arguments
    - `fs_stat`
- Reasons:
    - Free space in notification log dir FS is below threshold.
- Resolutions:
    - Free up space is FS.
