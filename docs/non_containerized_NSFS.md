# Non Containerized NSFS

Running nsfs non containerized is useful for deploying in linux without depending on kubernetes, but requires some steps which are described next.


## Build

### Build options - 
1. noobaa-core S3 Select is enabled. This requires boost shared objects to be present on the machine where noobaa is supposed to be installed. This feature can be disabled if not required (due to additional dependency) by running make rpm BUILD_S3SELECT=0.
2. In order to build RPM packages for other architectures simply run make rpm CONTAINER_PLATFORM=linux/amd64 or make rpm CONTAINER_PLATFORM=linux/ppc64le

Running the following command will result with an RPM file -
```sh
make rpm
```


## Install

### Pre-requisites (S3 select enabled) - 
1. boost - 
```sh
yum install epel-release && yum install boost
```

### A workaround for machines that cannot install epel-release -
Use the workaround below if `yum install epel-release` resulted in the following error - 
```
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
```sh
wget https://rpmfind.net/linux/centos/8-stream/AppStream/x86_64/os/Packages/boost-system-1.66.0-13.el8.x86_64.rpm
wget https://rpmfind.net/linux/centos/8-stream/AppStream/x86_64/os/Packages/boost-thread-1.66.0-13.el8.x86_64.rpm
rpm -i boost-system-1.66.0-13.el8.x86_64.rpm
rpm -i boost-thread-1.66.0-13.el8.x86_64.rpm
```

### Install NooBaa RPM - 
Download the RPM to the machine and install it by running the following command - 

```sh
rpm -i noobaa-core-5.14.0-1.el8.x86_64.rpm
```

After installing NooBaa RPM, it's expected to have noobaa-core source code under /usr/local/noobaa-core and an nsfs systemd example script under /etc/systemd/system/.

## Run the nsfs service - 
This systemd example script runs noobaa non containerized (currently) single mode, while /tmp/test/ is the fs root path directory.

```sh
systemctl start nsfs
```

## Test 
1. create a bucket directory -
```sh
mkdir -p /tmp/test/bucket1/
```
2. try list the buckets - 
```sh
 curl http://localhost:6001
```
The following is an expected valid response - 
```xml
<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>123</ID><DisplayName>NooBaa</DisplayName></Owner><Buckets><Bucket><Name>bucket1</Name><CreationDate>2023-08-30T17:12:29.000Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>
```

## health
Health status of the NSFS can be fetched using the command line.
 ```
 node usr/local/noobaa-core/src/cmd/health
 ```