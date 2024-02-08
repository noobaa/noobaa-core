# Non Containerized NSFS Events

This document will list all the possible Noobaa non-containerized NSFS events and possible reasons and resolutions.

## Events

### 1. noobaa_nsfs_crashed
#### Reasons
- Noobaa endpoint module failed to load.
- High Noobaa resource utilization.

#### Resolutions
- Check Noobaa resource utilization.

### 2. noobaa_fork_exited
#### Reasons
- One of the forks got an unrecoverable error and exited.
- High Noobaa resource utilization.

#### Resolutions
- Check Noobaa resource utilization.

### 3. noobaa_gpfslib_missing
arguments: `gpfs_dl_path`
#### Reasons
- Missing gpfslib in `GPFS_DL_PATH` path.
#### Resolutions
- Add gpfslib in `GPFS_DL_PATH` path.

### 4. noobaa_started
#### Reasons
- Noobaa started without any issues.
#### Resolutions
- Nil

### 5. noobaa_account_created
arguments: `account_name`
#### Reasons
- Noobaa user account created.
#### Resolutions
- Nil

### 6. noobaa_bucket_creation_failed
arguments: `bucket_name`
#### Reasons
- User does not have permission to update `noobaa.conf.d` dir and its redirect path if present.
- User does not have permission to create the bucket's underlying storage directory.

#### Resolutions
- Check access rights for `noobaa.conf.d` dir and it's redirect path if present.
- Check account `new_buckets_path` property and verify adequate permission present for this dir location. 

### 7. noobaa_bucket_delete_failed
arguments: `bucket_name`, `bucket_path`
#### Reasons
- User does not have permission to delete the bucket config file from `noobaa.conf.d` dir and its redirect path if present.
- User does not have permission to delete the bucket's underlying storage directory.
- Bucket storage dir is missing.

#### Resolutions
- Check access rights for `noobaa.conf.d` dir and it's redirect path if present.
- Check account `new_buckets_path` property and verify adequate permission present for this dir location. 
- Make sure both the bucket config field and underlying storage dir are present.

### 8. noobaa_bucket_not_found
arguments: `bucket_name`
#### Reasons
- Bucket config file in config_root path is missing.
- Bucket config JSON schema validation failed.
- Bucket's underlying storage directory not found 
#### Resolutions
- Check for the valid bucket config file in config root dir.
- Verify bucket config JSON schema.
- Check for Bucket's underlying storage directory present with permission.

### 9. noobaa_object_get_failed
arguments : `bucket_path`, `object_name`
#### Reasons
- Noobaa bucket path is missing.
- Bucket I/O operation is failed.
#### Resolutions
- Verify the bucket path.

### 10. noobaa_object_upload_failed
arguments : `bucket_path`, `object_name`
#### Reasons
- Bucket path is outside the bucket boundaries.
- Bucket storage class is not supported.
- Object I/O operation is failed.
#### Resolutions
- Make sure bucket storage class is supported.
- Check for I/O operations.

### 11. noobaa_account_created
arguments : `account_name`
#### Reasons
- Account created using CLI command
#### Resolutions
- Nil

### 12. noobaa_account_deleted
arguments : `account_name`
#### Reasons
- Account deleted using CLI.
#### Resolutions
- Nil

### 13. noobaa_bucket_created
arguments : `bucket_name`
#### Reasons
- Bucket created using CLI or S3.
#### Resolutions
- Nil

### 14. noobaa_bucket_deleted
arguments : `bucket_name`
#### Reasons
- Bucket deleted using CLI or S3.
#### Resolutions
- Nil

### 15. noobaa_whitelist_updated
arguments : `whitelist_ips`
#### Reasons
- Whitelist IPs updated using CLI.
#### Resolutions
- Nil

### 16. noobaa_no_such_bucket
arguments: `bucket_name`
#### Reasons
- Bucket does not exist with a name.
#### Resolutions
- List all the buckets and verify the bucket name exists in that list
- Check users have permission to access the buckets.

### 17. noobaa_bucket_already_exists
arguments: `bucket_name`
#### Reasons
- Bucket already exists with a name.
#### Resolutions
- change bucket name to unit value

### 18. noobaa_bucket_access_unauthorized
arguments: `bucket_name`
#### Reasons
- User does not have access to bucket or bucket directory
#### Resolutions
- Check users have permission to access the buckets.

### 19. noobaa_bucket_io_stream_item_timeout
arguments: `bucket_name`
#### Reasons
- Bucket stream IO output throws time out error
#### Resolutions
- Make sure the user have a fast internet connection
- Both Noobaa and directory resources are not overloaded.

### 20. noobaa_bucket_internal_error
arguments: `bucket_name`
#### Reasons
- Bucket access failed due to internal error
#### Resolutions
- Go through the event description and try to identify the root cause.

### 21. noobaa_account_exists
arguments: `account_name` or `access_key`
#### Reasons
- Noobaa account with name/access key already exists in the system
#### Resolutions
- verify the existing account name/access_key and make sure no account exists with the given name/access_key

### 22. noobaa_account_delete_forbidden
arguments: `account_name` or `access_key`
#### Reasons
- Noobaa account deletion forbidden. Cannot delete account that is the owner of buckets. 
#### Resolutions
- make sure all buckets are deleted before deleting the account.

### 23. noobaa_whitelist_updated_failed
arguments: `config_path`
#### Reasons
- Whitelist updated with IPs failed. Whitelist updated with IPs failed. Error while updation config.json file with whitelist IPs
#### Resolutions
- Check that the user has the right permission
- config.json exists in the config root path
- config.json is a valid JSON schema format

### 24. bucket_invalid_bucket_state
arguments: `bucket_name`
#### Reasons
- Bucket is in invalid state. Bucket schema missing required property or invalid property gets added.
#### Resolutions
- Check the bucket schema definition and make sure the required property is missing and the invalid property gets added in the config root path.