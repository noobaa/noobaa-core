# NSFS Multi FS Standalone

Running noobaa-core standalone is useful for development, testing, or deploying in Linux without depending on Kubernetes, NSFS multi FS is different from the normal standalone in such a way that it doesn't depend on the Noobaa postgres db. All the Global configurations, Accounts, and Bucket related schemas are saved in FS. And it gives a more lightweight flavor to the Noobaa standalone version. Permissions are handled by uid and gid.

Users can switch between Noobaa standalone and NSFS multi FS standalone by adding/removing the argument `multi_fs_config_dir`.

```
node src/cmd/nsfs ../standalon/nsfs_root --multi_fs_config_dir ../standalon/multi_fs_config

```

---

## Compments

### 1. Accounts

- Account will have a directory and in that, it will map 1 file per account, and the file name will be {access_key}.json
- Secrets will be saved either as plain text or Encrypted strings? [TBD]
- JSON Schema - $ref: account_api#/definitions/account_info
- new_buckets_path in the account schema will be used to populate the namespace store(read_resources, write_resource).
- BucketSpace interface is updated with the new method `read_account_by_access_key()`
    - Method will read multiple account config files referring to access_key and return the account to `account_cache`.

```
{
	"name": "user1",
	"email": "user1@noobaa.io",
	"has_login": "false",
	"has_s3_access": "true",
    "allow_bucket_creation": "true",
	"access_keys": [{
		"access_key": "aa-abcdefghijklmn123456",
		"secret_key": "ss-abcdefghijklmn123456"
	}],
	"nsfs_account_config": {
		"uid": 10,
		"gid": 10,
		"new_buckets_path": "/",
		"nsfs_only": "true"
	}
}
```

### 2. Bucket

- Bucket will have a directory and in that, it will map 1 file per Bucket
- bucket files name will be same as bucket name; eg: {bucket_name}.json
- Bucket schema should have a name, account name/email, s3_policy, path, etc.
- JSON Schema - $ref: 'bucket_api#/definitions/bucket_info'
- BucketSpace interface is updated with the new method `read_bucket_sdk_info()`
    - Method will read bucket schama referring to bucket name and return the bucket to `bucket_namespace_cache`.

```
{
  "name": "mybucke-test1",
  "tag": "",
  "system_owner": "user1@noobaa.io",
  "bucket_owner": "user1@noobaa.io",
  "versioning": "DISABLED",
  "path": "mybucke-test1",
  "should_create_underlying_storage": true,
  "s3_policy": {
    "version": "2012-10-17",
    "statement": [
      {
        "sid": "id-1222",
        "effect": "allow",
        "principal": [
          "*"
        ],
        "action": [
          "s3:*"
        ],
        "resource": [
          "arn:aws:s3:::*"
        ]
      }
    ]
  }
}
```

### 3. Global config

 - JSON Schema with Noobaa global properties

## Operations

### Accounts operations

- S3 Authentication of account requests - lookup accounts by access key etc.
- Create account - admin creates a file in the accounts dir, and Noobaa reloads on demand.
- Delete account - admin deletes the file, we have a cache and will expire it after some time.
- Regenerate credentials - update the file, and Noobaa will reload after up to 1 minute.
- Update account details like uid, gid, email etc.

### S3 Bucket operations

- Create Bucket
    - Set Bucket owner to the account, and path to new_buckets_path/bucket_name
    - Mark the bucket as created from S3 (should_create_underlying_storage)
- Delete Bucket
    - We check the user has permission to do it using uid and gid
    - Bucket owner and Admin can delete.
    - If we created the bucket, we also cleaned up the bucket directory along with the .noobaa dir in it, but no data should be deleted. If there is still data we should fail the deletion
- Update bucket
    - Put bucket policy
    - Put bucket website
- List buckets
    - Readdir the bucket config directory and filter based on the requesting account.
    - Check uid/gid access to the bucket path

## Code Structure
To simplify the flow new SDK `BucketSpaceMultiFS` is added for the NSFS multi FS standalone by extending the `BucketSpaceFS`. `BucketSpaceMultiFS` will handle all the multi FS related functionalities on the other hand `BucketSpaceFS` keeps serving existing NSFS standalone functionalities.

### BucketSpaceFS
- simplified nsfs bucket manager - single root dir for all buckets under it, and a single account.
- CLI: node nsfs /fsroot/

### BucketSpaceMultiFS
- Reuse the simple `BucketSpaceFS` code by extending it.
- Implements the requirements from the top.
- CLI: node nsfs --multi_fs_config_directory /fs-config-root/
