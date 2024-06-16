# NooBaa Non Containerized - Upgrade (Upstream only)

1. [Introduction](#introduction)
2. [General Information](#general-information)
3. [Download Upstream RPM](#download-upstream-rpm)
4. [Offline Upgrade](#offline-upgrade)
    1. [Offline Upgrade steps](#offline-upgrade-steps)
5. [Online Upgrade](#online-upgrade)


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

## Offline Upgrade
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
## Online Upgrade
The process of Online Upgrade of Non Containerized NooBaa is not supported yet.
