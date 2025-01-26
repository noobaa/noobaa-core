# NooBaa Non Containerized - Accounts and Buckets

1. [Introduction](#introduction)
2. [Account](#account)
    1. [Account Configuration File Location](#account-configuration-file-location)
    2. [Account Properties](#account-properties)
    3. [Account Configuration](#account-configuration)
3. [Bucket](#bucket)
    1. [Bucket Configuration File Location](#bucket-configuration-file-location)
    2. [Bucket Properties](#bucket-properties)
    3. [Bucket Configuration](#bucket-configuration)
    4. [S3 Bucket VS CLI Exported Bucket](#s3-bucket-vs-cli-exported-bucket)

## Introduction  

In NooBaa, accounts and buckets are two fundamental entities. Users can configure these entities using the NooBaa CLI, S3 API, and IAM API. The configuration files for accounts and buckets are validated against NooBaa's schema and then stored in the configuration directory.

## Account

Accounts serve as the primary means of authentication and authorization. Each account can access various resources according to its specific permissions. In order to eliminate the need for reading the account configuration file for each authenticated / authorized S3 operation, NooBaa service maintains an accounts cache.

### Account Configuration File Location  
- Actual file - `/config_directory/accounts/{account_name}.json` - used for lookup by name.
- Symlink - `/config_directory/access_keys/{access_key}.json` → `/config_directory/accounts/{account_name}.json` - used for lookup by access_key.

### Account properties  
See all available account properties - [NC Account Schema](../../src/server/system_services/schemas/nsfs_account_schema.js).  

#### Important properties  
  - `encrypted_secret_key` - Account's secrets will be kept encrypted in the account's configuration file.  

  - `uid/gid/user` - An account's access key is mapped to a file system uid/gid (or user). Before performing any file system operation, NooBaa switches to the account's UID/GID, ensuring that accounts access to buckets and objects is enforced by the file system.  
  
  - `supplemental_groups` - In addition to the account main GID, an account can have supplementary group IDs that are used to determine permissions for accessing files. These GIDs are validated against a files group (GID) permissions.
  By default, supplemental groups are based on user's groups in the filesystem. In case this value was set in the CLI it will override the user's groups in the filesystem. In case this value was not set in account configuration (in the CLI) and failed to fetch the user's group in the filesystem (either because no record exists or because the operation failed), supplemental groups will be unset.
  Note: Depending on the file system there may be 'sticky bit' enabled somewhere on the files path. 'sticky bit' is a user ownership access right flag that prevents other users than the file owner and root from deleting or moving files.
  In that case some actions will still get access denied regardless of group permissions enabled. sticky bit is denoted by `t` at the end of the permissions list (example: `drwxrwxrwt`). see https://en.wikipedia.org/wiki/Sticky_bit

  - `new_buckets_path` - When an account creates a bucket using the S3 protocol, NooBaa will create the underlying file system directory. This directory will be created under new_buckets_path. Note that the account must have read and write access to its `new_buckets_path`.  Must be an absolute path.  

### Account configuration  
Currently, an account can be configured via NooBaa CLI, see - [NooBaa CLI](./NooBaaCLI.md).  

## Bucket

Buckets are the primary entity that represents the storage containers within NooBaa, each bucket represents an underlying file system directory in which the objects will be stored.
In order to eliminate the need for reading the bucket configuration file for each S3 operation, NooBaa service maintains a bucket cache.

### Bucket Configuration File Location  
- Actual file - `/config_directory/buckets/{bucket_name}.json` - used for lookup by name.

### Bucket properties  
See all available bucket properties - [NC Bucket Schema](../../src/server/system_services/schemas/nsfs_bucket_schema.js).  

#### Important properties  
  - `owner` - A bucket's owner is an existing account, this account will have owner privileges on this bucket. 
  - `path` - The underlying file system directory in which the objects will be stored. Must be an absolute path.
  - `bucket_policy` - Similarly to the AWS S3 bucket policy, it's a JSON-based access control policy that specifies permissions and restrictions for a bucket and the objects within it.
 

### Bucket configuration  
A bucket can be configured via -
1. NooBaa CLI, see - [NooBaa CLI](./NooBaaCLI.md).  
2. S3 API, see - [S3 Supported Operations](./S3Ops.md).

### S3 Bucket VS CLI Exported Bucket

A user can create bucket using `NooBaa CLI` and via `S3 API`, each method has a different purpose -  

1. The `NooBaa CLI` is used for creating a bucket that its underlying file system directory already exists.  
    - NooBaa will check that the underlying directory already exists and fail if it does not.
    - The bucket property `should_create_underlying_storage` will be set to false.

2. The `S3 API` is used for creating a bucket that its underlying file system directory does not exist.
    - NooBaa will create the underling file system directory under the requesting account `new_buckets_path`.
    - The bucket property `should_create_underlying_storage` will be set to true.
    - On deleting via S3 API, NooBaa will delete the underlying directory only if the directory was created by NooBaa as well via S3 API (`should_create_underlying_storage=true`).