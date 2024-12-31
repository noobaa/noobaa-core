# NooBaa Non Containerized - Upgrade (Upstream only)

1. [Introduction](#introduction)
2. [General Information](#general-information)
3. [Download Upstream RPM](#download-upstream-rpm)
4. [Offline Upgrade (Version < 5.18.0)](#offline-upgrade-version--5180)
    1. [Offline Upgrade steps](#offline-upgrade-steps)
5. [Online Upgrade (Version >= 5.18.0)](#online-upgrade-version--5180)


## Introduction
This document provides step-by-step instructions to help you successfully upgrade your current Upstream NooBaa RPM version to a newer version.

## General Information
- The upgrade process of NooBaa Non Containerized contains 2 parts - 
    1. RPM upgrade.
    2. NooBaa upgrade manager run.
- RPM Upgrade 
    - An RPM upgrade refers to the process of upgrading software packages on Linux systems that use the RPM Package Manager (RPM). RPM upgrade will upgrade NooBaa's source code. 

- NooBaa Upgrade Manager
    - The noobaa.service file includes an `ExecStartPre` instruction to run NooBaa's upgrade manager. This ensures the upgrade manager executes on every restart of NooBaa service. 

    - If the version of NooBaa in package.json is newer than the version in system.json, an upgrade will be initiated.

    - The NooBaa Upgrade Manager is responsible for handling schema changes in configuration files, as well as modifications to the config directory structure, among other tasks.

## Download Upstream RPM

For NooBaa upstream (open source code) RPM download instructions, See [NooBaa Non Containerized Getting Started](./GettingStarted.md).

## Offline Upgrade (Version < 5.18.0)
The currently available upgrade process of NooBaa Non Containerized is an offline upgrade. Offline upgrade means that NooBaa service must be stopped during the upgrade and that NooBaa endpoints won't be handling S3 requests at the time of the upgrade.

### Offline Upgrade steps
1. Install NooBaa RPM version x.

    Example: 
    ```sh 
    rpm -i noobaa-core-5.15.0-1.el8.x86_64.20231009
    ```

2. Start the NooBaa service.
    ```sh
    systemctl enable noobaa.service
    systemctl start noobaa.service
    ```
3. Stop the NooBaa service.
    Example:
    ```sh
    systemctl stop noobaa.service
    ```
4. Upgrade the RPM to version x + 1 (Upgrade RPM). 
    ```sh
    rpm -Uvh noobaa-core-5.15.1.el8.x86_64.20241009
    ```
5. Start the NooBaa service again (NooBaa upgrade manager).
    ```sh
    systemctl start noobaa.service
    ```
6. Check for upgrade manager logs. 
    ```sh 
    systemctl status noobaa
    // OR using journalctl
    journalctl -u noobaa
    ```
7. Check system.json version was updated.
    ```sh
    cat /etc/noobaa.conf.d/system.json
    {"hostname":{"current_version":"5.17.0","upgrade_history":{"successful_upgrades":[{"timestamp":1719299738760,"completed_scripts":[],"from_version":"5.15.4","to_version":"5.17.0"}]}}}
    ```
## Online Upgrade (Version >= 5.18.0)

### Online Upgrade Goals
**1. Minimal downtime -** Ensure minimal downtime for each node.

**2. Incremental changes -** Split upgrade to small chunks, for example, upgrade nodes one by one. Each node will get upgraded on its turn, the other nodes will still be available for handling s3 requests.

**3. Rollback capability -** Mechanism for revert to the previous version in case something went wrong during the upgrade.

**4. Schema backward compatibility -** Changes to account/bucket/config schema must be backwards compatible to allow seamless transitions to new version.


### Online Upgrade Algorithm

1. Initiate config directory backup (#1).
2. Iterate nodes one by one -
    * Stop NooBaa service (or suspend the node in CES)
    * RPM upgrade each node.
    * Restart NooBaa service on each node.
3. Wait for all hosts to finish RPM upgrade (source code upgrade).
4. Initiate config directory backup (#2).
5. Initiate upgrade of the config directory using a noobaa-cli complete upgrade command. (point of no return)

Online Upgrade Algorithm commands examples - 
1. Config directory backup -  
    1. CES - `mms3 config backup /path/to/backup/location`
    2. Non CES - `cp -R /etc/noobaa.conf.d/ /path/to/backup/location`
2. Stop NooBaa service - `systemctl stop noobaa`
3. RPM upgrade on a specific node - `rpm -Uvh /path/to/new_noobaa_rpm_version.rpm`
4. Restart NooBaa service - `systemctl restart noobaa`
5. `noobaa-cli upgrade start --expected_version=5.18.0 --expected_hosts=hostname1,hostname2,hostname3` 

### Additional Upgrade Properties of `system.json`-

1. New per host property -   
    - config_dir_version

2. New config directory information -
    - config_directory 
        - config_dir_version
        - phase
        - upgrade_package_version 
        - in_progress_upgrade - (during the upgrade)
            - timestamp
            - completed_scripts
            - running_host
            - config_dir_from_version
            - config_dir_to_version
            - package_from_version
            - package_to_version
        - upgrade_history
            - last_failure (if last upgrade failed)
            - successful_upgrades

#### system.json new information examples - 
1. During Upgrade - `cat /etc/noobaa.conf.d/system.json | jq .`
```json
{
  "my_host1":{
    "current_version":"5.18.0",
    "config_dir_version": "1.0.0",
    "upgrade_history":{
      "successful_upgrades":[{
        "timestamp":1730890665481,
        "from_version":"5.17.1",
        "to_version":"5.18.0"
      }]
    }
  },
    "config_directory":{
        "phase":"CONFIG_DIR_LOCKED",         // <- config dir is locked during an upgrade
        "config_dir_version":"0.0.0",        // <- config_dir_version is still the old config_dir_version
        "upgrade_package_version":"5.17.1",  // <- upgrade_package_version is still the old upgrade_package_version
        "in_progress_upgrade":[{             // <- in_progress_upgrade property during the upgrade
            "timestamp":1730890691016,
            "completed_scripts": [],
            "running_host":"my_host1",
            "config_dir_from_version":"0.0.0",
            "config_dir_to_version":"1.0.0",
            "package_from_version":"5.17.1",
            "package_to_version":"5.18.0"
        }]
    }
}
```

2. After a successful upgrade - `cat /etc/noobaa.conf.d/system.json | jq .`
```json
{
  "my_host1":{
    "current_version":"5.18.0",
    "config_dir_version": "1.0.0",
    "upgrade_history":{
      "successful_upgrades":[{
        "timestamp":1730890665481,
        "from_version":"5.17.1",
        "to_version":"5.18.0"
      }]
    }
  },
    "config_directory":{
        "phase":"CONFIG_DIR_UNLOCKED",         // <- after a successful upgrade, config dir is unlocked
        "config_dir_version":"1.0.0",          // <- config_dir_version is the new config_dir_version
        "upgrade_package_version":"5.18.0",    // <- upgrade_package_version is the new upgrade_package_version
        "upgrade_history":{                    // <- a new item in the successful upgrades array was added
            "successful_upgrades":[{
                "timestamp":1730890691016,
                "completed_scripts":
                ["/usr/local/noobaa-core/src/upgrade/nc_upgrade_scripts/1.0.0/config_dir_restructure.js"],
                "running_host":"my_host1",
                "config_dir_from_version":"0.0.0",
                "config_dir_to_version":"1.0.0",
                "package_from_version":"5.17.1",
                "package_to_version":"5.18.0"
            }]
        }
    }
}
```

3. After a failing upgrade - `cat /etc/noobaa.conf.d/system.json | jq .`
```json
{
  "my_host1":{
    "current_version":"5.18.0",
    "config_dir_version": "1.0.0",
    "upgrade_history":{
      "successful_upgrades":[{
        "timestamp":1730890665481,
        "from_version":"5.17.1",
        "to_version":"5.18.0"
      }]
    }
  },
    "config_directory":{
        "phase":"CONFIG_DIR_LOCKED",              // <- after a failing upgrade, config dir is still locked
        "config_dir_version":"0.0.0",             // <- config_dir_version is still the old config_dir_version
        "upgrade_package_version":"5.17.1",       // <- upgrade_package_version is still the old upgrade_package_version
        "upgrade_history":{
            "successful_upgrades": [],            // <- successful_upgrades array is empty/doesn't contain the failed upgrade
            "last_failure":{                      // <- a last_failure property is set in upgrade history 
                "timestamp":1730890676741,
                "completed_scripts":[
                    "/usr/local/noobaa-core/src/upgrade/nc_upgrade_scripts/1.0.0/config_dir_restructure.js"],
                "running_host":"my_host1",
                "config_dir_from_version":"0.0.0",
                "config_dir_to_version":"1.0.0",
                "package_from_version":"5.17.1",
                "package_to_version":"5.18.0",
                "error": "Error: _run_nc_upgrade_scripts: nc upgrade manager failed!!!, Error: this is a mock error\n    at NCUpgradeManager._run_nc_upgrade_scripts (/usr/local/noobaa-core/src/upgrade/nc_upgrade_manager.js:258:19)\n    at async NCUpgradeManager.upgrade_config_dir (/usr/local/noobaa-core/src/upgrade/nc_upgrade_manager.js:119:13)\n    at async start_config_dir_upgrade (/usr/local/noobaa-core/src/manage_nsfs/upgrade.js:52:29)\n    at async Object.manage_upgrade_operations (/usr/local/noobaa-core/src/manage_nsfs/upgrade.js:22:13)\n    at async main (/usr/local/noobaa-core/src/cmd/manage_nsfs.js:73:13)"
            }
        }
    }
}
```

### Upgrade Helpers 
1. NooBaa Health CLI - will report on the config directory status, upgrade failures and hosts that are blocked for config directory updates.
2. NooBaa CLI upgrade status - will print the upgrade status per the information written in system.json.

