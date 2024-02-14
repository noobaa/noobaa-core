# NSFS Non Containerized

Running noobaa-core non containerized is useful for development, testing, or deploying in Linux without depending on Kubernetes, NSFS FS is different from the simple standalone in such a way that it doesn't depend on the Noobaa postgres db. All the Global configurations, Accounts, and Bucket related schemas are saved in FS. And it gives a more lightweight flavor to the Noobaa standalone version. Permissions are handled by uid and gid, or by providing a distinguished name (LDAP/AD) that will be resolved to uid/gid by the operating system.

Users can switch between Noobaa standalone and NSFS FS standalone by adding/removing the argument `config_dir`.

```
node src/cmd/nsfs ../standalon/nsfs_root --config_dir ../standalon/fs_config

```

---

## Components

### 1. Account

- Account will have a directory and in that, it will map 1 file per account
- Account file name will be {account_name}.json
- Secrets will be saved as plain text
  - Note: We had the option to save it as plain text or Encrypted strings.
- JSON Schema - `src/server/system_services/schemas/nsfs_account_schema.js`.
  - Note: It is based on $ref: account_api#/definitions/account_info.
- `new_buckets_path` in the account schema will be used to populate the namespace store (read_resources, write_resource).
- `BucketSpace` interface is updated with the new method `read_account_by_access_key()`
    - Method will read multiple account config files referring to access_key and return the account to `account_cache`.

```json
{
  "name": "user1",
  "email": "user1", // the email will be internally (the account name), email will not be set by user
  "creation_date": "2024-01-11T08:24:14.937Z",
  "access_keys": [
    {
      "access_key": "T9ND65mekH3hCv81ztft",
      "secret_key": "fTeJr6P+xe+N4TnjHnYLWZTM5oEBBB04Yw5nOPkHEXAMPLE" //real secret_key would not have the suffix EXAMPLE
    }
  ],
  "nsfs_account_config": {
    "uid": 1001,   // Both can also be replaced with "distingished_name": "unique_user1_name",
    "gid": 1001,   // 
    "new_buckets_path": "/",
  },
  "allow_bucket_creation": true,
  "_id": "65cb1e7c9e6ae40d499c0ae3" // _id automatically generated
}
```

### 2. Bucket

- Bucket will have a directory and in that, it will map 1 file per bucket
- Bucket file name will be {bucket_name}.json
- Bucket schema should have a name, bucket_owner, path, etc. The are optional properties that can be added like bucket policy.
- JSON Schema - `src/server/system_services/schemas/nsfs_bucket_schema.js`.
  -  It is based on  $ref: 'bucket_api#/definitions/bucket_info'
- `BucketSpace` interface is updated with the new method `read_bucket_sdk_info()`
    - Method will read bucket schema referring to bucket name and return the bucket to `bucket_namespace_cache`.

```json
{
  "_id": "65cb1efcbec92b33220112d6",
  "name": "mybucket-test1",
  "owner_account": "65cb1e7c9e6ae40d499c0ae3",
  "system_owner": "user1",
  "bucket_owner": "user1",
  "versioning": "DISABLED",
  "creation_date": "2024-01-11T08:26:16.9731",
  "path": "mybucket-test1",
  "should_create_underlying_storage": true,
  "s3_policy": {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Effect": "Allow",
            "Principal": {
              "AWS": [
                "*"
              ]
            },
            "Action": [
              "s3:*"
            ],
            "Resource": [
              "arn:aws:s3:::mybucket-test1/*",
              "arn:aws:s3:::mybucket-test1"
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
- Update account details like uid, gid, fs_backend etc.

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
To simplify the flow new SDK `BucketSpaceFS` is added for the NSFS FS standalone by extending the `BucketSpaceSimpleFS`. `BucketSpaceFS` will handle all the FS related functionalities on the other hand `BucketSpaceSimpleFS` keeps serving existing NSFS simple standalone functionalities.

### BucketSpaceSimpleFS
- simplified nsfs bucket manager - single root dir for all buckets under it, and a single account.
- CLI: node nsfs /fsroot/

### BucketSpaceFS
- Reuse the simple `BucketSpaceSimpleFS` code by extending it.
- Implements the requirements from the top.
- CLI: node nsfs --config_dir /fs-config-root/


### Configuration Structure

High level configuration - 

1. /etc/noobaa.conf.d/config_dir_redirect - a fixed starting point, the noobaa nsfs service will try to read this file, and if this file does not exist it will use /etc/noobaa.conf.d/ as the wanted config_dir

2. /etc/sysconfig/noobaa_nsfs - env file, one should avoid using it, should be used only for configurations that can not be set using config.json

3. /path/to/config_dir - the user's config_dir, contains the following files/subdirectories - 

3.1. accounts/ - directory that contains accounts configurations, each account configuration file is called {account_name}.json and fits to the account schema.

3.2. access_keys/ - directory that contains symlinks to accounts configurations, each symlink called {access_key}.symlink and links to an account under accounts/ directory.

3.3. buckets/ - directory that contains buckets configurations, each bucket configuration file called {bucket_name}.json and fits the bucket schema.

3.4. system.json - json file that contains information about the system deployed on the machine, the specified information has the following format: 
`{ [hostname1]: { "current_version":"5.15.0","upgrade_history":{"successful_upgrades":[]}},
   [hostname2]: { "current_version":"5.15.0","upgrade_history":{"successful_upgrades":[]}}
}` 

3.5. config.json - json file that contains shared configurations of the node cluster, and machine specific configurations, the configuration has the following format: 
{
	"ENDPOINT_FORKS": 2,
  "host_customization": {
    "{node_name}" : {
      "ENDPOINT_FORKS": 3, 
    }
  },
}

* Please be aware that when a node is designated in the host_customization, Noobaa will combine the shared configuration with the node's configuration. If a configuration value is provided under the node's configuration, it will take precedence as the final configuration value applied to the noobaa_nsds service on that specific node.

#### config.json schema - 
See [NSFS config.json schema](https://github.com/noobaa/noobaa-core/src/server/object_services/schemas/nsfs_config_schema.js)
config.json will be reloaded every 10 seconds automatically, please notice that some config.json properties require restart of the service, for more details check the schema.

### Configuration files (accounts/buckets) permissions
- Configuration files created under accounts/ or buckets/ will have 600 permissions (read, write, execute) for the owner of the config file only. 
- config_file created by manage_nsfs.js CLI tool will be owned by the user who ran the command. 
