# NooBaa Non Containerized - Health CLI

1. [Introduction](#introduction)
2. [Installation](#installation)
3. [General Information](#general-information)
5. [Usage](#usage)
6. [Output](#output)
7. [Example](#example)
8. [Health Errors](#health-errors)
    1. [General Errors](#general-errors)
    2. [Accounts / Buckets Health Errors](#accounts--buckets-health-errors)


## Introduction
The Health CLI tool is a powerful command-line interface designed to efficiently analyze the NooBaa service, endpoints, accounts and buckets health.

## Installation
Health CLI installed automatically during the NooBaa RPM installation.
For more details about NooBaa RPM installation, see - [Getting Started](./GettingStarted.md).


## General Information 
* NooBaa Health CLI will analyze the following aspects - 
  - `NooBaa service health`
    - Verifying that the NooBaa service is active and has a valid PID (not equal to 0).
  - `NooBaa endpoints health`
    - Ensuring that the NooBaa endpoint is running.
  - `NooBaa accounts Health`
    - Iterating accounts under the config directory.
    - Confirming the existence of the account's configuration file and its validity as a JSON file.
    - Verifying that the account's `new_buckets_path` is defined and `allow_bucket_creation` is set to true.
    - Ensuring that the account has read and write access to its new_buckets_path.
  - `NooBaa buckets health` 
    - Iterating buckets under the config directory.
    - Confirming the existence of the bucket's configuration file and its validity as a JSON file.
    - Verifying that the underlying storage path of a bucket exists.
  - `Config directory health`
    - checks if config system and directory data exists
    - returns the config directory status 
  - `Config directory upgrade health`
    - checks if config system and directory data exists
    - checks if there is ongoing upgrade
    - returns error if there is no ongoing upgrade, but the config directory phase is locked
    - returns message if there is no ongoing upgrade and the config directory is unlocked
  - `Bucket event notifications connections health`
    - Sends out a test notification for each connection.
  - `Lifecycle worker last run health`
    - checks if the previous run of the lifecycle worker finished successfully.

* Health CLI requires root permissions.

* Add `2>/dev/null` to the NooBaa CLI commands for omitting stderr logs printed by NooBaa.


## Usage
The `health` command is used to analyze NooBaa health with customizable options.

```sh
noobaa-cli diagnose health [--deployment_type][--https_port]
[--all_account_details][--all_bucket_details][--all_connection_details][--notif_storage_threshold][--lifecycle][--config_root][--debug]
```
### Flags -

- `deployment_type`
    - <u>Type</u>: String
    - <u>Default</u>: 'nc'
    - <u>Description</u>: Indicates the deployment type.  

- `https_port`
    - Type: Number
    - Default: 6443
    - Description: Indicates NooBaa's https port number.  

- `all_account_details`
    - Type: Boolean
    - Default: false
    - Description: Indicates if health output should contain valid accounts.  

- `all_bucket_details`
    - Type: Boolean
    - Default: false
    - Description: Indicates if health output should contain valid buckets.

- `all_connection_details`
    - Type: Boolean
    - Default: false
    - Description: Indicates if health output should contain connection test result.

- `notif_storage_threshold`
    - Type: Boolean
    - Default: false
    - Description: Whether health ouput should check if notification storage FS is below threshold.

- `lifecycle`
    - Type: Boolean
    - Default: false
    - Description: Indicates if health output should contain lifecycle test result.

- `config_root`
    - Type: String
    - Description: Indicates the config directory (default config.NSFS_NC_DEFAULT_CONF_DIR). config_root flag should be used only for dev/tests envs.

- `debug`
    - Type: Number
    - Description: Specifies the debug level used for increasing the log verbosity (Debug levels are 0-5).    


## Output
The output of the Health CLI is a JSON object containing the following properties - 

- `status`
    - Type: String
    - Enum: OK | NOTOK
    - Description: Overall status of the system.

- `memory`
    - Type: String
    - Description: Current memory being used by NooBaa service.

- `error_code`
    - Type: String
    - Enum: See - [Health Errors](#health-errors)
    - Description: Error code of the health issue uncovered by the Health CLI. Will be displayed in Health response if status is NOTOK.
    

- `error_message`
    - Type: String
    - Enum: See - [Health Errors](#health-errors)
    - Description: Error message describing a health issue uncovered by the Health CLI. Will be displayed in Health response if status is NOTOK.

- `service_status`
    - Type: String
    - Enum: "active" | "inactive" | "missing service status info"
    - Description: NooBaa service status. Determined by whether the service is up and running.

- `pid`
    - Type: Number | "missing pid info"
    - Description: NooBaa service process ID or Error message.

- `endpoint_state`
    - Type: { response: { response_code: "Running" | "NOT_RUNNING", response_message: String } }
    - Description: NooBaa endpoint response.
  
- `total_fork_count`:
    - Type: Number
    - Description: Total number of expected forks in NooBaa.

- `running_workers`
    - Type: Array
    - Description: Running NooBaa endpoint workers IDs.

- `invalid_buckets`: 
  - Type: [{"name": "bucket_name", "config_path": "/bucket/config/path" OR "storage_path": "/bucket/storage/path", "code": String }]
  - Description: Array of invalid buckets, invalid bucket is a bucket that -
    1. The bucket's missing a valid storage path
    2. The bucket has an invalid config JSON file.

- `invalid_accounts`: 
  - Type: [{ "name": "account_name", "config_path": "/account/config/path" OR "storage_path": "/path/to/accounts/new_buckets_path","code": String }] 
  - Description: Array of invalid accounts, invalid account is account that - 
    1. The account's new_buckets_path doesn't exist.
    2. The account doesn't have RW access to its `new_buckets_path` or having invalid config JSON file.
    3. The account has an invalid config JSON file.

- `invalid connections`:
  - Type: [{ "name": "connection_name", "config_path": "/connection/file/path", "code": String }]
  - Description: Array of connections that failed test notification.

- `valid_accounts`
  - Type: [{ "name": account_name, "storage_path": "/path/to/accounts/new_buckets_path" }]
  - Description: Array of all the valid accounts. If the all_account_details flag is set to true, valid_accounts will be included in the Health response.

- `valid_buckets`
  - Type: [{ "name": bucket_name, "storage_path": "/path/to/bucket/path" }]
  - Description: Array of all the valid buckets. If the all_bucket_details flag is set to true, valid_buckets will be included in the Health response.

- `valid_connections`:
  - Type: [{ "name": "connection_name", "config_path": "/connection/file/path" }]
  - Description: Array of all connections to which test notification was send successfully.

- `error_type`
  - Type: String
  - Enum: 'PERSISTENT' | 'TEMPORARY'
  - Description: For TEMPORARY error types, NooBaa attempts multiple retries before updating the status to reflect an error. Currently, TEMPORARY error types are only observed in checks for invalid NooBaa endpoints.
 
- `config_directory`
  - Type: Object {"phase": "CONFIG_DIR_UNLOCKED" | "CONFIG_DIR_LOCKED","config_dir_version": String,
  "upgrade_package_version": String, "upgrade_status": Object, "error": Object }.
  - Description: An object that consists config directory information, config directory upgrade information etc.
  - Example: { "phase": "CONFIG_DIR_UNLOCKED", "config_dir_version": "1.0.0", "upgrade_package_version": "5.18.0", "upgrade_status": { "message": "there is no in-progress upgrade" }}

- `latest_lifecycle_run_status`
   - Type: Object { <br>
    "total_stats": { "num_objects_deleted": number, "num_objects_delete_failed": number, "objects_delete_errors": array, "num_mpu_aborted": number, "num_mpu_abort_failed": number, "mpu_abort_errors": array  <br>},  <br>
   "lifecycle_run_times": Object {
    "run_lifecycle_start_time": number,
    "list_buckets_start_time": number,
    "list_buckets_end_time": number,
    "list_buckets_took_ms": number,
    "process_buckets_start_time": number,
    "process_buckets_end_time": number,
    "process_buckets_took_ms": number,
    "run_lifecycle_end_time": number,
    "run_lifecycle_took_ms": number <br>
   },<br>
  "errors": array <br> }.
  - Description: An object that consists total_stats information, lifecycle_run_times information and errors.
  - Example: see in [Health Output Example](./Lifecycle.md#health-cli)
## Example 
```sh
noobaa-cli diagnose health --all_account_details --all_bucket_details
```

Output:
```json
{
  "service_name": "noobaa",
  "status": "NOTOK",
  "memory": "88.6M",
  "error": {
    "error_code": "NOOBAA_SERVICE_FAILED",
    "error_message": "NooBaa service is not started properly, Please verify the service with status command."
  },
  "checks": {
    "services": [
      {
        "name": "noobaa",
        "service_status": "active",
        "pid": "1204",
        "error_type": "PERSISTENT"
      }
    ],
    "endpoint": {
      "endpoint_state": {
        "response": {
          "response_code": "RUNNING",
          "response_message": "Endpoint running successfuly."
        },
        "total_fork_count": 1,
        "running_workers": [
          "1"
        ]
      },
      "error_type": "TEMPORARY"
    },
    "accounts_status": {
      "invalid_accounts": [
        {
          "name": "account_invalid",
          "storage_path": "/tmp/nsfs_root_invalid/",
          "code": "STORAGE_NOT_EXIST"
        },
        { "name": "account_inaccessible",
          "storage_path": "/tmp/account_inaccessible",
          "code": "ACCESS_DENIED" }
      ],
      "valid_accounts": [
        {
          "name": "account2",
          "storage_path": "/tmp/nsfs_root"
        }
      ],
      "error_type": "PERSISTENT"
    },
    "buckets_status": {
      "invalid_buckets": [
        {
          "name": "bucket1.json",
          "config_path": "/etc/noobaa.conf.d/buckets/bucket1.json",
          "code": "INVALID_CONFIG"
        },
        {
          "name": "bucket3",
          "storage_path": "/tmp/nsfs_root/bucket3",
          "code": "STORAGE_NOT_EXIST"
        }
      ],
      "valid_buckets": [
        {
          "name": "bucket2",
          "storage_path": "/tmp/nsfs_root/bucket2"
        }
      ],
      "error_type": "PERSISTENT"
    },
    "connectoins_status": {
      "invalid_connections": [
        {
          "name": "notif_invalid",
          "config_path": "/etc/noobaa.conf.d/connections/notif_invalid.json",
          "code": "ECONNREFUSED"
        }
      ],
      "valid_connections": [
        {
          "name": "notif_valid",
          "config_path": "/etc/noobaa.conf.d/connections/notif_valid.json"
        }
      ]
    },
    "notif_storage_threshold_details": {
      "threshold": 0.2,
      "ratio": 0.9,
      "result": "above threshold"
    }
    "config_directory": {
      "phase": "CONFIG_DIR_UNLOCKED",
      "config_dir_version": "1.0.0",
      "upgrade_package_version": "5.18.0",
      "upgrade_status": {
        "message": "there is no in-progress upgrade"
      }
    }
  }
}
```

### Example Output Details - 

- NooBaa endpoint response:
  - Curl command to NooBaa endpoint returned successfully, therefore, NooBaa health reports RUNNING.

- invalid_accounts: 
  - The new_buckets_path of account_invalid's doesn't exist in the file system, therefore, NooBaa health reports STORAGE_NOT_EXIST.
  - The uid/gid/user of account_inaccessible has insufficient read and write permissions to its new_buckets_path, therefore, NooBaa health reports ACCESS_DENIED.

- invalid_buckets:
  - The config file of bucket1 is invalid. Therefore, NooBaa health reports INVALID_CONFIG.
  - The underlying file system directory of bucket3 is missing. Therefore, NooBaa health reports STORAGE_NOT_EXIST.

- config_directory: 
  - the config directory phase is unlocked, config directory version is "1.0.0", matching source code/package version is "5.18.0" and there is no ongoing upgrade.


## Health Errors

If the Health CLI encounters issues, the following errors will appear in the health output. If any of these error codes are present in the health status, the overall status will be flagged as `NOTOK`.

### General Errors

#### 1. Invalid NooBaa Service
  - Error code: `NOOBAA_SERVICE_FAILED`
  - Error message: NooBaa service is not started properly, Please verify the service with status command.
  - Reasons:
    - NooBaa service is not started properly.
    - Stopped NooBaa service is not removed.
  - Resolutions:
    - Verify the NooBaa service is running by checking the status and logs command.
      ```
      systemctl status noobaa.service
      journalctl -xeu noobaa.service
      ```
      If the NooBaa service is not started, start the service
      ```
      systemctl enable noobaa.service
      systemctl start noobaa.service
      ```

#### 2. Missing Forks
  - Error code: `NOOBAA_ENDPOINT_FORK_MISSING`
  - Error message: One or more endpoint fork is not started properly. Verify the total and missing fork count in response.
  - Reasons:
    - One or more endpoint fork is not started properly.
    - Number of workers running is less than the configured `forks` value.
  - Resolutions:
    - Restart the NooBaa service and also verify NooBaa fork/s is exited with an error within the logs.
      ```
      systemctl status rsyslog.service
      journalctl -xeu rsyslog.service
      ```

#### 3. NooBaa Endpoint Is Not Running
  - Error code: `NOOBAA_ENDPOINT_FAILED`
  - Error message: S3 endpoint process is not running. Restart the endpoint process.
  - Reasons:
    - NooBaa endpoint process is not running, and it's not able to respond to any requests.
  - Resolutions:
    - Restart the NooBaa service and verify NooBaa process is exited with errors within the logs.
      ```
      systemctl status rsyslog
      journalctl -xeu rsyslog.service
      ```

#### 5. Unknown Error
  - Error code: `UNKNOWN_ERROR`
  - Error message: An unknown error occurred.
  - Reasons:
    - Unknown.
  - Resolutions:
    - Unknown.

### Accounts / Buckets Health Errors

The following error codes will be associated with a specific Bucket or Account schema under the invalid_buckets or invalid_accounts property.

#### 1. Storage path does not exist
- Error code: `STORAGE_NOT_EXIST`
- Error message: Storage path mentioned in schema pointing to the invalid directory.
- Reasons:
  - Account's new_buckets_path pointing to a non-existing file.
  - Bucket's path pointing to a non-existing file.
- Resolutions:
  - Ensure that the account's new_buckets_path is an existing file.
  - Ensure that the bucket's path is an existing file.

#### 2. Invalid Account/Bucket Configuration File
  - Error code: `INVALID_CONFIG`
  - Error message: Schema JSON is not valid, Please check the JSON format.
  - Reasons:
    - Bucket/Account JSON is not valid or not in JSON format.
  - Resolutions:
    - Check for any JSON syntax error in the schema structure of the Bucket/Account.

#### 3. Account Can Not Access New_Buckets_Path
  - Error code: `INVALID_CONFIG`
  - Error message: Account do no have access to storage path mentioned in schema.
  - Reasons:
    - Account `new_buckets_path` is not accessible with account uid and gid.
  - Resolutions:
    - Ensure that the account's uid/gid/user has read and write permissions within the `new_buckets_path` file system directory.


#### 4. Bucket/Account Config File Is Missing
  - Error code: `MISSING_CONFIG`
  - Error message: Schema JSON is not found.
  - Reasons:
    - The Bucket/Account configuration file is missing from the config directory.
  - Resolutions:
    - Check for config files in respective Accounts or Buckets directories.


#### 5. Account's User (FS Distinguished Name) Is Invalid
  - Error code: `INVALID_DISTINGUISHED_NAME`
  - Error message: Account distinguished name was not found.
  - Reasons:
    - The account user (distinguished name) was not found.
  - Resolutions:
    - Check for FS user on the host running the Health CLI.

#### 6. Bucket with invalid account owner
  - Error code: `INVALID_ACCOUNT_OWNER`
  - Error message: Bucket account owner is invalid
  - Reasons:
    - The bucket owner account is invalid.
  - Resolutions:
    - Compare bucket account owner and account ids in account dir.

#### 7. Bucket missing account owner
  - Error code: `MISSING_ACCOUNT_OWNER`
  - Error message: Bucket account owner not found
  - Reasons:
    - Bucket missing owner account.
  - Resolutions:
    - Check for owner_account property in bucket config file.

#### 8. Config Directory is invalid
  - Error code: `INVALID_CONFIG_DIR`
  - Error message: Config directory is invalid
  - Reasons:
    - System.json is missing - NooBaa was never started
    - Config directory property is missing in system.json - the user didn't run config directory upgrade when upgrading from 5.17.z to 5.18.0
    - Config directory upgrade error.
  - Resolutions:
    - Start NooBaa service
    - Run `noobaa-cli upgrade`
    - Check the in_progress_upgrade the exact reason for the failure.
