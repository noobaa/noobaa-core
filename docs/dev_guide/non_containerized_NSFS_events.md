# Non Containerized NSFS Events

This document will list all the possible Noobaa non-containerized NSFS events and possible reasons and resolutions.

## Events

### 1. noobaa_nsfs_crashed
#### Reseason
- Noobaa endpoint module failed to load.
- High Noobaa resource utilization.

#### Resolutions
- Check Noobaa resource utilization.

### 2. noobaa_gpfslib_missing
arguments: `gpfs_dl_path`
#### Reseason
- Missing gpfslib in `GPFS_DL_PATH` path.
#### Resolutions
- Add gpfslib in `GPFS_DL_PATH` path.

### 3. noobaa_started
#### Reseason
- Noobaa started without any issues.
#### Resolutions
- Nil

### 4. noobaa_account_created
arguments: `account_name`
#### Reseason
- Noobaa user account created.
#### Resolutions
- Nil

### 5. noobaa_bucket_creation_failed
arguments: `bucket_name`
#### Reseason
- User does not have permission to update `noobaa.conf.d` dir and its redirect path if present.
- User does not have permission to create the bucket's underlying storage directory.

#### Resolutions
- Check access rights for `noobaa.conf.d` dir and it's redirect path if present.
- Check account `new_buckets_path` property and verify adequate permission present for this dir location. 

### 6. noobaa_bucket_delete_failed
arguments: `bucket_name`, `bucket_path`
#### Reseason
- User does not have permission to delete the bucket config file from `noobaa.conf.d` dir and its redirect path if present.
- User does not have permission to delete the bucket's underlying storage directory.
- Bucket storage dir is missing.

#### Resolutions
- Check access rights for `noobaa.conf.d` dir and it's redirect path if present.
- Check account `new_buckets_path` property and verify adequate permission present for this dir location. 
- Make sure both the bucket config field and underlying storage dir are present.

### 7. noobaa_bucket_not_found
arguments: `bucket_name`
#### Reseason
- Bucket config file in config_root path is missing.
- Bucket config JSON schema validation failed.
- Bucket's underlying storage directory not found 
#### Resolutions
- Check for the valid bucket config file in config root dir.
- Verify bucket config JSON schema.
- Check for Bucket's underlying storage directory present with permission.

### 8. noobaa_object_get_failed
arguments : `bucket_path`, `object_name`
#### Reseason
- Noobaa bucket path is missing.
- Bucket I/O operation is failed.
#### Resolutions
- Verify the bucket path.

### 9. noobaa_object_uplaod_failed
arguments : `bucket_path`, `object_name`
#### Reseason
- Bucket path is outside the bucket boundaries.
- Bucket storage class is not supported.
- Object I/O operation is failed.
#### Resolutions
- Make sure bucket storage class is supported.
- Check for I/O operations.