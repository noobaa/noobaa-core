# NooBaa CLI Documentation

1. [Introduction](#introduction)
2. [Installation](#installation)
3. [General Information](#general-information)
4. [Managing Accounts](#managing-accounts)
    1. [Add Account](#add-account)
    2. [Update Account](#update-account)
    3. [Account Status](#account-status)
    4. [List Accounts](#list-accounts)
    5. [Delete Account](#delete-account)
5. [Managing Buckets](#managing-buckets)
    1. [Add Bucket](#add-bucket)
    2. [Update Bucket](#update-bucket)
    3. [Bucket Status](#bucket-status)
    4. [List Buckets](#list-buckets)
    5. [Delete Bucket](#delete-bucket)
6. [Managing Server IP White List](#managing-server-ip-white-list)
7. [Managing Glacier](#managing-glacier)
8. [Diagnose](#diagnose)
    1. [Health](#health)
    2. [Metrics](#metrics)
    3. [Gather Logs](#gather-logs)
9. [Global Options](#global-options)
10. [Examples](#examples)
    1. [Bucket Commands Examples](#bucket-commands-examples)
    2. [Account Commands Examples](#account-commands-examples)
    3. [White List Server IP Command Example](#white-list-server-ip-command-example)


## Introduction
The NooBaa CLI tool is a powerful command-line interface designed to efficiently manage buckets and accounts within your system.

## Installation
NooBaa CLI installed automatically during the NooBaa RPM installation.
For more details about NooBaa RPM installation, see - [NooBaa Non Containerized Getting Started](./GettingStarted.md).

## General Information 

- NooBaa CLI creates accounts and buckets configuration files under the correspondent subdirectories of the config directory. For more information about the config directory, see - [NooBaa Non Containerized Configuration](./Configuration.md).

- NooBaa CLI run will create both accounts, access_keys, and buckets directories if they are missing under the config directory.

- NooBaa CLI requires root permissions.

- While specifying a storage/config GPFS path, it's recommended to set `NSFS_NC_STORAGE_BACKEND` / `NSFS_NC_CONFIG_DIR_BACKEND` to GPFS in config.json in order to increase performance by ordering NooBaa to use GPFS library. (In dev environment for setting these properties inline use `--fs_backend=GPFS` or `--fs_config_backend=GPFS`)

- Add `2>/dev/null` to the NooBaa CLI commands for omitting stderr logs printed by NooBaa.

- All the specified paths (bucket - `path`, account - `new_buckets_path`) must be absolute paths.

## Managing Accounts
- **[Add Account](#add-account)**: Create new accounts with customizable options.
- **[Update Account](#update-account)**: Modify the settings and configurations of existing accounts.
- **[Account Status](#account-status)**: Retrieve the current status and detailed information about a specific account.
- **[List Accounts](#list-accounts)**: Display a list of all existing accounts, including relevant details.
- **[Delete Account](#delete-account)**: Remove unwanted or obsolete accounts from the system.


### Add Account

The `account add` command is used to create a new account with customizable options.

#### Usage
```sh
noobaa-cli account add --name <root_account_name> --uid <uid> --gid <gid> [--user]
[--iam_name][--new_buckets_path][--access_key][--secret_key][--fs_backend]
[--allow_bucket_creation][--force_md5_etag][--anonymous][--from_file][--iam_operate_on_root_account]
```
#### Flags -
- `name` (Required)
    - Type: String
    - Description: Specifies the name of the root account.
    If creating an IAM account, specify the name of the new IAM account with `--iam_name` param in 
    addition to `--name` param which is the root account that owns this IAM account.

- `iam_name`
    - Type: String
    - Description: If creating a new IAM account, specifies the name of the new IAM account.
    The new IAM account belongs to the root account specified with --name param.

- `uid` (Required)
    - Type: Number
    - Description: Specifies the File system user ID representing the account. (UID and GID can be replaced by --user option)

- `gid` (Required)
    - Type: Number
    - Description: Specifies the File system group ID representing the account. (UID and GID can be replaced by --user option)

- `user`
    - Type: String
    - Description: Specifies the File system user representing the account. (user can be replaced by --uid and --gid option)

- `new_buckets_path` 
    - Type: String
    - Description: Specifies a file system directory to be used for creating underlying directories that represent buckets created by an account using the S3 API.

- `access_key`
    - Type: String
    - Description: Specifies the access key for the account (default is generated).

- `secret_key`
    - Type: String
    - Description: Specifies the secret key for the account (default is generated).

- `fs_backend`
    - Type: String
    - Enum: none | GPFS | CEPH_FS | NFSv4
    - Description: Specifies the file system of new_buckets_path (default config.NSFS_NC_STORAGE_BACKEND).

- `allow_bucket_creation`
    - Type: Boolean
    - Description: Specifies if the account allowed or blocked for bucket creation.

- `force_md5_etag`
    - Type: Boolean
    - Description: Set the account to force md5 ETag calculation (default is false).

- `anonymous`
    - Type: Boolean
    - Description: Identify the account by the anonymous flag instead of identification by name. For more info about anonymous requests see - [S3 supported operations](./S3Ops.md).

- `from_file`
    - Type: String
    - Description: Path to JSON file which includes account properties. When using `from_file` flag the account details must only appear inside the options JSON file. See [from file example](#--from-file-flag-usage-example).  

- `iam_operate_on_root_account`
    - Type: Boolean
    - Description: Specifies if the account allowed to create root accounts using the IAM API (the default behavior is to create of IAM accounts). See - [IAM - Root Accounts Manager](./../design/iam.md#root-accounts-manager).

### Update Account

The `account update` command is used to update an existing account with customizable options.

#### Usage
```sh
noobaa-cli account update --name <root_account_name> [--new_name][--uid][--gid][--user]
[--iam_name][--new_buckets_path][--access_key][--secret_key][--regenerate][--fs_backend]
[--allow_bucket_creation][--force_md5_etag][--anonymous][--iam_operate_on_root_account]
```
#### Flags -
- `name` (Required)
    - Type: String
    - Description: Specifies the name of the root account to be updated.
    If updating an IAM account, specify its name with `--iam_name` param, in addition to `--name` 
    param which is the root account that owns this IAM account.

- `iam_name`
    - Type: String
    - Description: If updating an IAM account, specifies the name of the IAM account to be updated.
    The update IAM account belongs to the root account specified with --name param.

- `new_name` 
    - Type: String
    - Description: Specifies the new name of the account.

- `uid`
    - Type: Number
    - Description: Specifies the File system user ID representing the account. (UID and GID can be replaced by --user option)

- `gid`
    - Type: Number
    - Description: Specifies the File system group ID representing the account. (UID and GID can be replaced by --user option)

- `user`
    - Type: Number
    - Description: Specifies the File system user representing the account. (user can be replaced by --uid and --gid option)

- `new_buckets_path` 
    - Type: String
    - Description: Specifies a file system directory to be used for creating underlying directories that represent buckets created by an account using the S3 API.

- `regenerate`
    - Type: Boolean
    - Description: Update automatically generated access key and secret key.

- `access_key`
    - Type: String
    - Description: Specifies the access key for the account (default is generated).

- `secret_key`
    - Type: String
    - Description: Specifies the secret key for the account (default is generated).

- `fs_backend`
    - Type: String
    - Enum: none | GPFS | CEPH_FS | NFSv4
    - Description: Specifies the file system of new_buckets_path (default config.NSFS_NC_STORAGE_BACKEND).

- `allow_bucket_creation`
    - Type: Boolean
    - Description: Specifies if the account to explicitly allow or block bucket creation.

- `force_md5_etag`
    - Type: Boolean
    - Description: Set the account to force md5 ETag calculation.

- `anonymous`
    - Type: Boolean
    - Description: Identify the account by the anonymous flag instead of identification by name.

- `iam_operate_on_root_account`
    - Type: Boolean
    - Description: Specifies if the account allowed to create root accounts using the IAM API (the default behavior is to create of IAM accounts). See - [IAM - Root Accounts Manager](./../design/iam.md#root-accounts-manager).

### Account Status

The `account status` command is used to print the status of the account.

#### Usage
```sh
noobaa-cli account status --name <root_account_name> [--iam_name][--access_key][--anonymous][--show_secrets]
```
#### Flags -
- `name` (Required)
    - Type: String
    - Description: Specifies the name of the root account.

- `iam_name`
    - Type: String
    - Description: If requesting an IAM account, specifies the name of the IAM account (owned by root account).

- `access_key`
    - Type: String
    - Description: Specifies the access_key of the account. (Identify the account by access_key instead of name).

- `anonymous`
    - Type: Boolean
    - Description: Identify the account by the anonymous flag instead of identification by name.

- `show_secrets`
    - Type: Boolean
    - Description: Display the access key and secret key of each account.  

### List accounts

The `account list` command is used to display a list of all existing accounts.


#### Usage
```sh
noobaa-cli account list [--wide][--show_secrets][--name][--uid][--gid][--user][--access_key]
```
#### Flags -
- `wide`
    - Type: Boolean
    - Description: Display additional details for each account.

- `show_secrets`
    - Type: Boolean
    - Description: Display the access key and secret key of each account (only when using flag --wide).

- `name`
    - Type: String
    - Description: Filter the list based on the provided account name.

- `uid`
    - Type: String
    - Description: Filter the list based on the provided account file system uid.

- `gid`
    - Type: String
    - Description: Filter the list based on the provided account file system gid.

- `user`
    - Type: String
    - Description: Filter the list based on the provided account file system user name.

- `access_key`
    - Type: String
    - Description: Filter the list based on the provided account access key.


### Delete Account

The `account delete` command is used to delete an existing account.


#### Usage
```sh
noobaa-cli account delete --name <root_account_name> [--iam_name][--anonymous]
```
#### Flags -
- `name` (Required)
    - Type: String
    - Description: If deleting a root account, specifies the name of the account to be deleted.
    If deleting an IAM account, specify the name of the IAM account to be deleted in addition
    to `--name` param which is the root account that owns this IAM account.

- `iam_name`
    - Type: String
    - Description: If deleting an IAM account, specifies the name of the IAM account the be deleted.

- `anonymous`
    - Type: Boolean
    - Description: Identify the account by the anonymous flag instead of identification by name.

## Managing Buckets

- **[Add Bucket](#add-bucket)**: Create new buckets with customizable options.
- **[Update Bucket](#update-bucket)**: Modify the settings and configurations of existing buckets.
- **[Bucket Status](#bucket-status)**: Retrieve the current status and detailed information about a specific bucket.
- **[List Buckets](#list-buckets)**: Display a list of all existing buckets, including relevant details.
- **[Delete Bucket](#delete-bucket)**: Remove unwanted or obsolete buckets from the system.

### Add Bucket

The `bucket add` command is used to create a new bucket with customizable options.

#### Usage
```sh
noobaa-cli bucket add --name <bucket_name> --owner <owner_name> --path <path> 
[--bucket_policy][--fs_backend][--force_md5_etag][--from_file]
```
#### Flags -
- `name` (Required)
    - Type: String
    - Description: Specifies the name of the new bucket.

- `owner` (Required)
    - Type: String
    - Description: Specifies the name of the owner of the bucket. (the owner is the account name).  

- `path` (Required)
    - Type: String
    - Description: Specifies the underlying path of the bucket. Path must be an absolute path.

- `bucket_policy`
    - Type: String
    - Description: Set the bucket policy, type is a string of valid JSON policy

- `fs_backend`
    - Type: String
    - Enum: none | GPFS | CEPH_FS | NFSv4
    - Description: Specifies the file system of the bucket (default config.NSFS_NC_STORAGE_BACKEND)

- `force_md5_etag`
    - Type: Boolean
    - Description: Set the bucket to force md5 ETag calculation

- `from_file`
    - Type: String
    - Description: Path to a JSON file which includes bucket properties. When using `from_file` flag the bucket details must only appear inside the options JSON file. See [from file example](#--from-file-flag-usage-example). 


### Update Bucket

The `bucket update` command is used to update an existing bucket with customizable options.

#### Usage
```sh
noobaa-cli bucket update --name <bucket_name> [--new_name] [--owner]
[--path][--bucket_policy][--fs_backend][--force_md5_etag][--from_file]
```
#### Flags -
- `name` (Required)
    - Type: String
    - Description: Specifies the name of the updated bucket.

- `new_name`
    - Type: String
    - Description: Specifies the new name of the bucket.

- `owner`
    - Type: String
    - Description: Specifies the name of the owner of the bucket. (the owner is the account name).  

- `path`
    - Type: String
    - Description: Specifies the underlying path of the bucket. Path must be an absolute path.

- `bucket_policy`
    - Type: String
    - Description: Set the bucket policy, type is a string of valid JSON policy.

- `fs_backend`
    - Type: String
    - Enum: none | GPFS | CEPH_FS | NFSv4
    - Description: Specifies the file system of the bucket (default config.NSFS_NC_STORAGE_BACKEND), unset with ''.

- `force_md5_etag`
    - Type: Boolean
    - Description: Set the bucket to force md5 ETag calculation.


### Bucket Status

The `bucket status` command is used to print the status of the bucket.

#### Usage
```sh
noobaa-cli bucket status --name <account_name>
```
#### Flags -
- `name` (Required)
    - Type: String
    - Description: Specifies the name of the bucket.

### List buckets

The `bucket list` command is used to display a list of all existing buckets.


#### Usage
```sh
noobaa-cli bucket list [--wide][--name]
```
#### Flags -
- `wide`
    - Type: Boolean
    - Description: Display additional details for each bucket.

- `name`
    - Type: String
    - Description: Filter the list based on the provided bucket name.

### Delete Bucket

The `bucket delete` command is used to delete an existing bucket.


#### Usage
```sh
noobaa-cli bucket delete --name <bucket_name> [--force]
```
#### Flags -
- `name` (Required)
    - Type: String
    - Description: Specifies the name of the bucket to be deleted.

- `force`
    - Type: Boolean
    - Description: Forcefully delete bucket if the bucket is not empty. (Un-recommended)


## Managing Server IP white list


### Set server IP white list

The `whitelist` command is used to set white list of server IPs for S3 access, Allow access to all the IPs if list is empty.

#### Usage
```sh
noobaa-cli whitelist --ips <ips>
```
#### Flags -
- `ips` (Required)
    - Type: String
    - Description: Specifies the white list of server IPs for S3 access. Example - '["127.0.0.1", "192.0.10.0", "3002:0bd6:0000:0000:0000:ee00:0033:6778"]'


## Managing Glacier

TODO

## Diagnose


### Health
The Health CLI tool designed to analyze the NooBaa service, endpoints, accounts and buckets health. For more info please see - [Health CLI Documentation](Health.md).

### Metrics

The `metrics` command is used for extracting NooBaa non containerized metrics.
For more info please see - [Monitoring Documentation](./Monitoring.md).
#### Usage
```sh
noobaa-cli diagnose metrics
```

### Gather Logs

The `gather-logs` command is used for extract NooBaa non containerized logs.
Not implemented yet, running this command will fail with not implemented error.


## Global Flags

Global options used by the CLI to define the config directory settings. 

- The usage of `config_root` and `config_root_backend` flag is not recommended for users and should be used only for dev environments. 

- The recommended usage of specifying a custom config directory path is by creating a redirect file /etc/noobaa.conf.d/config_dir_redirect, for more info about using a custom config directory path, see - [Non Containerized Configuration](./Configuration.md).

- The recommended usage of specifying a custom config directory file system type is by setting NSFS_NC_CONFIG_DIR_BACKEND property in config.json, for more info about setting custom properties, see - [Non Containerized NooBaa Developer Customization](./ConfigFileCustomizations.md)
 

#### Flags -

- `config_root`
    - Type: String
    - Description: Specifies a configuration files directory (default config.NSFS_NC_DEFAULT_CONF_DIR). config_root flag should be used only for dev/tests envs.

- `config_root_backend`
    - Type: String
    - Enum: <none | GPFS | CEPH_FS | NFSv4>
    - Description: Specifies the file system type of the configuration directory (default config.NSFS_NC_CONFIG_DIR_BACKEND)

- `debug`
    - Type: Number
    - Description: Specifies the debug level used for increasing the log verbosity (Debug levels are 0-5).    

## Examples


### Account Commands Examples

#### Add Account

Add account while specifying the account properties inline
```sh
sudo noobaa-cli account add --name account1 --new_buckets_path /file_system/path/ --fs_backend GPFS 2>/dev/null
```

Add account while specifying the account properties in a file -  See [from file example](#--from-file-flag-usage-example).  
```sh
sudo noobaa-cli account add --from_file <options_JSON_file_path>
```

#### Update Account 

```sh
sudo noobaa-cli account update --name account1 --fs_backend GPFS 2>/dev/null
```

#### Account Status 

```sh
sudo noobaa-cli account status --name account1 2>/dev/null
```

#### List Accounts 

Default list accounts
```sh
sudo noobaa-cli account list 2>/dev/null
```

List accounts with additional details
```sh
sudo noobaa-cli account list --wide 2>/dev/null
```

List accounts with additional details and access_key and secret_key
```sh
sudo noobaa-cli account list --show_secrets --wide 2>/dev/null
```

List accounts and filter by name
```sh
sudo noobaa-cli account list --name account1 2>/dev/null
```

5. Delete Account
```sh
sudo noobaa-cli account delete --name account1 2>/dev/null
```

------

### Bucket Commands Examples

#### Add Bucket

Add bucket while specifying the bucket properties inline
```sh
sudo noobaa-cli bucket add --name bucket1 --path /file_system/path/ --owner account1 2>/dev/null
```

Add bucket while specifying the bucket properties in a file
```sh
sudo noobaa-cli bucket add --from_file <options_JSON_file_path>
```

#### Update Bucket 

```sh
sudo noobaa-cli bucket update --name bucket1 --new_name bucket2 2>/dev/null
```

#### Bucket Status 

```sh
sudo noobaa-cli bucket status --name bucket 2>/dev/null
```

#### List Buckets 

Default list buckets
```sh
sudo noobaa-cli bucket list 2>/dev/null
```

List buckets with additional details
```sh
sudo noobaa-cli bucket list --wide 2>/dev/null
```

List Buckets and filter by name
```sh
sudo noobaa-cli bucket list --name bucket1 2>/dev/null
```

#### Delete Bucket
```sh
sudo noobaa-cli bucket delete --name bucket1 2>/dev/null
```

-----

#### `--from-file` flag usage example

Using `from_file` flag:
- For account and bucket creation users can also pass account or bucket values in JSON file (hereinafter referred to as "options JSON file") instead of passing them in CLI as arguments using flags.

- The options are key-value, where the key is the same as suggested flags, for example:

##### 1. Create JSON file for account

```json
{
    "name": "account-1001",
    "uid": 1001,
    "gid": 1001,
    "new_buckets_path": "/tmp/nsfs_root1"
}
```

```bash
sudo noobaa-cli account add --from_file <options_account_JSON_file_path>
```

##### 2. Create JSON file for bucket:

```json
{
    "name": "account-1001-bucket-1",
    "owner": "account-1001",
    "path": "/tmp/nsfs_root1/account-1001-bucket-1"
}
```

```bash
sudo noobaa-cli bucket add --from_file <options_bucket_JSON_file_path>
```

------

### White List Server IP command example
```
sudo noobaa-cli whitelist --ips ["127.0.0.1", "192.0.10.0", "3002:0bd6:0000:0000:0000:ee00:0033:6778"]'
```