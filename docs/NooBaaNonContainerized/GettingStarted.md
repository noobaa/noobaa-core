# NooBaa Non Containerized - Getting Started

1. [Introduction](#introduction)
2. [NooBaa Non Containerized Solution](#noobaa-non-containerized-solution)
3. [Build NooBaa RPM](#build-noobaa-rpm)
    1. [Build options](#build-options)
4. [Download NooBaa RPM](#download-noobaa-rpm)
5. [Install](#install)
    1. [Pre-requisites (S3 select enabled)](#pre-requisites-s3-select-enabled)
    2. [Install NooBaa RPM](#install-noobaa-rpm)
6. [Configuration](#configuration)
7. [Create Storage File System Paths](#create-storage-file-system-paths)
8. [Create Accounts And Exported Buckets](#create-accounts-and-exported-buckets)
9. [Enable NooBaa service](#enable-noobaa-service)
10. [Run S3 Requests Toward NooBaa](#run-s3-requests-toward-noobaa)

## Introduction
Welcome to the NooBaa Non Containerized guide.
This document provides step-by-step instructions to help you install, configure, and execute the application efficiently. Follow the detailed steps outlined below to get started and make the most of the features and functionalities NooBaa Non Containerized offers.

## NooBaa Non Containerized Solution
NooBaa Non Containerized is a lightweight deployment of NooBaa on Linux without depending on Kubernetes.  
NooBaa Non Containerized includes NooBaa service that deploys S3 endpoints for handling S3 requests, the NooBaa CLI for managing accounts & buckets, and NooBaa Health CLI for performing system health analysis.  
Unlike the traditional NooBaa deployment, NooBaa Non Containerized utilizes a file system configuration directory to store information related to accounts, buckets, system information and configurations, instead of maintaining this data in a database.

NooBaa Non Containerized solution includes the following components - 
1. [NooBaa Service](#enable-noobaa-service) - Deploys NooBaa S3 endpoint for handling S3 requests. 
2. [NooBaa CLI](./NooBaaCLI.md) - Accounts and exported buckets management.
3. [NooBaa Health CLI](./Health.md) - NooBaa health analysis.
4. [NooBaa Config Directory](./Configuration.md) - A File system directory for storing configuration files/directories, for example accounts, buckets, certificates, customizations etc.
5. [Storage File System](#create-storage-file-system-paths) - A File system for storing objects.

### NooBaa High Level Diagram
![NooBaa Non Containerized Components Diagram](https://github.com/user-attachments/assets/601a6220-f236-446e-9ead-404d41a5ffc5)


## Build NooBaa RPM
Running the following command will result with a NooBaa RPM file -
```sh
cd noobaa-core/
make rpm
```


### Build options
`BUILD_S3SELECT`   
* <u>Description</u>: Build NooBaa RPM without S3 select feature. S3 select requires boost shared objects to be present on the host where NooBaa RPM be installed.  
* <u>Available options</u>: 0/1.
* <u>Default</u>: Enabled (`BUILD_S3SELECT=1`).
* Run `make rpm BUILD_S3SELECT=0` for disabling S3 select.

`CONTAINER_PLATFORM`  
* <u>Description</u>: Build NooBaa RPM for different architectures.  
* <u>Available options</u>: `linux/amd64` / `linux/ppc64le` base images.
* <u>Default</u>: `linux/amd64`.
* Run `make rpm CONTAINER_PLATFORM=linux/ppc64le` or `make rpm CONTAINER_PLATFORM=linux/amd64` for changing architecture.

`CENTOS_VER`  
* <u>Description</u>: Build NooBaa RPM for different CentOS versions. 
* <u>Available options</u>: `CentOS:9` / `CentOS:8` base images.
* <u>Default</u>: `CentOS:9`.
* Run `make rpm CENTOS_VER=8` or `make rpm CENTOS_VER=9` for changing CentOS version.



### Download NooBaa RPM
Nightly RPM builds of the upstream master branch can be downloaded from a public S3 bucket -

List all the available RPMs using AWS s3api CLI tool - 
```sh
aws s3api list-objects --bucket noobaa-core-rpms --no-sign-request
```

Download RPM example:
```sh
wget https://noobaa-core-rpms.s3.amazonaws.com/noobaa-core-5.15.4-20240616-5.15.el9.x86_64.rpm
```

For more information about the available NooBaa's upstream RPMs, See - [NooBaa Non Containerized CI & Tests](./CI&Tests.md).

## Install

### Pre-requisites (S3 select enabled)
NooBaa RPM installation requires `boost` - 
```sh
yum install epel-release && yum install boost
```

#### Pre-requisites workaround for machines that cannot install epel-release -
Use the workaround below if `yum install epel-release` resulted in the following error -
```sh
Updating Subscription Management repositories.
Unable to read consumer identity

This system is not registered with an entitlement server. You can use subscription-manager to register.

Last metadata expiration check: <SomeTimeStamp>
No match for argument: epel-release
Error: Unable to find a match: epel-release
```
1. Install wget -
    ```sh
    yum install wget
    ```
2. Download and install boost -
    RHEL8 / centos:stream8 -
    ```sh
    wget https://rpmfind.net/linux/centos/8-stream/AppStream/x86_64/os/Packages/boost-system-1.66.0-13.el8.x86_64.rpm
    wget https://rpmfind.net/linux/centos/8-stream/AppStream/x86_64/os/Packages/boost-thread-1.66.0-13.el8.x86_64.rpm
    rpm -i boost-system-1.66.0-13.el8.x86_64.rpm
    rpm -i boost-thread-1.66.0-13.el8.x86_64.rpm
    ```
    RHEL9 / centos:stream9 -
    ```sh
    wget https://rpmfind.net/linux/centos-stream/9-stream/AppStream/x86_64/os/Packages/boost-system-1.75.0-8.el9.x86_64.rpm
    wget https://rpmfind.net/linux/centos-stream/9-stream/AppStream/x86_64/os/Packages/boost-thread-1.75.0-8.el9.x86_64.rpm
    rpm -i boost-system-1.75.0-8.el9.x86_64.rpm
    rpm -i boost-thread-1.75.0-8.el9.x86_64.rpm
    ```


### Install NooBaa RPM
Install NooBaa RPM by running the following command -
```sh
rpm -i <rpm_file_name>.rpm
```

After installing NooBaa RPM, it's expected to have noobaa-core source code under `/usr/local/noobaa-core` and a `noobaa.service` systemd script under `/usr/lib/systemd/system/`.

## Configuration
In order to understand NooBaa's configuration directory structure and configure NooBaa, follow - [NooBaa Non Containerized Configuration](./Configuration.md)


## Create Storage File System Paths
NooBaa requires designated paths for storing uploaded objects. These storage paths are specified during the creation or updating of accounts and buckets. The bucket's `path` property defines a file system storage path for object storage, while an account's `new_buckets_path` specifies a storage path where new S3 buckets will be created. 
Notice: 
- Account owning a bucket must have a read and write permissions to the bucket's `path`.
- Account must have read and write permissions to its `new_buckets_path`.

Example - 
```sh
// 1. Create the storage underlying directory
// 2. Apply 770 permission to the directory
mkdir -p /tmp/fs1/
chmod 770 /tmp/fs1/
```

## Create Accounts And Exported Buckets
In order to create accounts and exported buckets see the NooBaa CLI instructions - [NooBaa CLI](./NooBaaCLI.md). <br />
Accounts and buckets entities - [Accounts And Buckets](./AccountsAndBuckets.md). <br />



## Enable NooBaa service
The `noobaa.service` systemd script deploys NooBaa Non Containerized S3 endpoints. By enabling NooBaa service, NooBaa will be ready to start handling S3 requests.

```sh
systemctl enable noobaa.service
systemctl start noobaa.service
```

## Run S3 Requests Toward NooBaa

### Pre-requisites 
1. Enable NooBaa Service - See - [Enable NooBaa service](#enable-noobaa-service).

2. Create account - See the NooBaa CLI instructions for creating an account - [Create Accounts And Exported Buckets](#create-accounts-and-exported-buckets).

3. Install AWS S3 CLI - See [AWS CLI Installation Guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).


### Running S3 Requests

#### 1. Create an S3 alias
The alias below defines the new account credentials and directs requests to NooBaa's S3 endpoint URL. Each S3 request made using this alias will be routed to the NooBaa service and authenticated using the account's credentials -
```sh
alias s3-nb-account='AWS_ACCESS_KEY_ID=XXXX AWS_SECRET_ACCESS_KEY=YYYY aws --endpoint https://localhost:6443 --no-verify-ssl s3'
```

#### 2. S3 Create bucket
Create a bucket named s3bucket using the alias created at step 1 -
```sh
s3-nb-account mb s3://s3bucket
make_bucket: s3bucket
```

#### 3. Check that the bucket configuration file was created successfully -
```sh
sudo cat /etc/noobaa.conf.d/buckets/s3bucket.json
{"_id":"65cb1efcbec92b33220112d7","name":"s3bucket","owner_account":"65cb1e7c9e6ae40d499c0ae4","system_owner":"account1","bucket_owner":"account1","versioning":"DISABLED","creation_date":"2023-09-26T05:56:16.252Z","path":"/tmp/fs1/s3bucket","should_create_underlying_storage":true}
```

#### 4. Check that the underlying file system bucket directory was created successfully -
```sh
ls -l /tmp/fs1/s3bucket/
total 0
```

#### 5. S3 list buckets -
```sh
s3-nb-account ls
2023-09-21 11:50:26 s3bucket
```


#### 6. S3 upload objects -

##### 6.1. Copy an object to the S3 bucket -
```sh
echo  "This is the content of object1" | s3-nb-account cp - s3://s3bucket/object1.txt
```

##### 6.2. Check the object was created on the file system -
```sh
sudo cat /tmp/fs1/s3bucket/object1.txt
This is the content of object1
```

#### 7. S3 List objects -
```sh
s3-nb-account ls s3://s3bucket
2023-09-21 11:55:01         31 object1.txt
```
