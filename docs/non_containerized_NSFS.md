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

## Create configuration files -
**IMPORTANT NOTE** - It's not recommended to create the config_root under /tmp/ since the contents of /tmp/ can be deleted occasionaly, In the following instruction we use it just as an example. 

**1. Create buckets and accounts directories -**
```sh
mkdir -p /tmp/noobaa_config_root/
mkdir -p /tmp/noobaa_config_root/buckets/
mkdir -p /tmp/noobaa_config_root/accounts/
```

**2. Create accounts and exported buckets configuration files -**

Find instruction at - https://github.com/noobaa/noobaa-core/blob/master/docs/nsfs-standalone.md. <br />
**Note** - All required paths on the configuration files (bucket - path, account - new_buckets_path) must be absolute paths.


**3. Create env file under the configuration directory -**

nsfs_env.env is the default .env file, link it to /etc/noobaa.conf.d/.env and edit it as you wish before starting the service - 

```sh
ln /usr/local/noobaa-core/nsfs_env.env  /etc/noobaa.conf.d/.env
```
**Note** - If another /usr/local/noobaa-core/.env exists it should be merged into /etc/noobaa.conf.d/.env carefully.

## Create FS -
If it's not already existing, create the fs root path in which buckets (directories) and objects (files) will be created.

```sh
mkdir -p /tmp/fs1/
```


## Run the nsfs service - 
The systemd script runs noobaa non containerized, and requires config_root in order to find the location of the system/accounts/buckets configuration file.

```sh
systemctl start nsfs
```

## NSFS service logs -
Run the following command in order to get the nsfs service logs - 

```sh
journalctl -u nsfs.service
```

## Test 
#### 1. Create a bucket directory -
```sh
mkdir -p /tmp/fs1/bucket1/
```

#### 2. List the buckets -
```sh
 curl http://localhost:6001
```
The following is an expected valid response - 
```xml
<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>123</ID><DisplayName>NooBaa</DisplayName></Owner><Buckets><Bucket><Name>bucket1</Name><CreationDate>2023-08-30T17:12:29.000Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>
```

## S3 Test

#### 1. Create account configuration file -

```sh
account1_json='
{
    "name": "account1",
    "email": "account1@noobaa.io",
    "has_login": "false",
    "has_s3_access": "true",
    "allow_bucket_creation": "true",
    "access_keys": [{
        "access_key": "abc",
        "secret_key": "123"
    }],
    "nsfs_account_config": {
        "uid": 0,
        "gid": 0,
        "new_buckets_path": "/tmp/fs1/",
        "nsfs_only": "true"
    }
}'

cat $account1_json >/tmp/noobaa_config_dir/accounts/abc.json
```

#### 2. Install aws cli -
see https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html


#### 3. Create s3 alias for account1 -
```sh
alias s3-account1='AWS_ACCESS_KEY_ID=abc AWS_SECRET_ACCESS_KEY=123 aws --endpoint https://localhost:6443 --no-verify-ssl s3'
```


#### 4. S3 Create bucket -

4.1. Create  a bucket called s3bucket using account1 - 
```sh
s3-account1 mb s3://s3bucket

Output - 
make_bucket: s3bucket
```

4.2. Check that the bucket configuration file was created successfully -
```sh
cat /tmp/noobaa_config_dir/buckets/s3bucket.json

Output - 
{"name":"s3bucket","tag":"","system_owner":"account1@noobaa.io","bucket_owner":"account1@noobaa.io","versioning":"DISABLED","path":"/tmp/fs1/s3bucket","should_create_underlying_storage":true,"creation_date":"2023-09-26T05:56:16.252Z"}
```

4.3. Check that the file system bucket directory was created successfully -

```sh
ls -l /tmp/fs1/s3bucket/

Output - 
total 0
```

#### 5. S3 List buckets -
```sh
s3-account1 ls

Output - 
2023-09-21 11:50:26 s3bucket
```


#### 6. S3 Upload objects -

6.1. Copy an object to the S3 bucket - 

```sh
echo  "This is the content of object1" | s3-account1 cp - s3://s3bucket/object1.txt
```

6.2. Check the object was created on the file system - 

```sh
cat /tmp/fs1/s3bucket/object1.txt

Output - 
This is the content of object1
```


#### 7. S3 List objects -

```sh
s3-account1 ls s3://s3bucket

Output - 
2023-09-21 11:55:01         31 object1.txt
```



## health
Health status of the NSFS can be fetched using the command line.
 ```
 node usr/local/noobaa-core/src/cmd/health
 ```

## Bucket and Account Manage CLI
Users can create, update, delete, and list buckets and accounts using CLI. If the config directory is missing CLI will create one and also create accounts and buckets sub-directories in it and default config directory is `/etc/noobaa.conf.d`. 

CLI will never create or delete a bucket directory for the user if a bucket directory is missing CLI will return with error.
 
 Bucket Commands
 ```
 node src/cmd/manage_nsfs bucket add --config_root ../standalon/config_root --name bucket1 --email noobaa@gmail.com --path ../standalon/nsfs_root/1

node src/cmd/manage_nsfs bucket update --config_root ../standalon/config_root --name bucket1 --email noobaa@gmail.com

node src/cmd/manage_nsfs bucket list --config_root ../standalon/config_root

node src/cmd/manage_nsfs bucket delete --config_root ../standalon/config_root --name bucket1

```

 Account Commands
 ```
node src/cmd/manage_nsfs account add --config_root ../standalon/config_root --name noobaa --email noobaa@gmail.com --new_buckets_path ../standalon/nsfs_root/ --access_key abc --secret_key abc

node src/cmd/manage_nsfs account update --config_root ../standalon/config_root --name noobaa --access_key abc --secret_key abc123

node src/cmd/manage_nsfs account delete --config_root ../standalon/config_root --access_key abc

node src/cmd/manage_nsfs account list --config_root ../standalon/config_root

 ```

Users can also pass account and bucket/account values in JSON file instead of passing them in cli as arguments.


```
node src/cmd/manage_nsfs bucket add --config_root ../standalon/config_root --from_file /json_file/path
```
NSFS management CLI command will create both account and bucket dir if it's missing in the config_root path.

## Log and Logrotate
Noobaa logs are configured using rsyslog and logrotate. RPM will configure rsyslog and logrotate if both are already running. 

Rsyslog status check
```
systemctl status rsyslog
```

Noobaa logs are pushed to `var/log/noobaa.log` and the log is rotated and compressed daily.

Verify the rsyslog and logrotate rpm configuration is complete by checking the files `etc/rsyslog.d/noobaa_syslog.conf` and `etc/rsyslog.d/noobaa_rsyslog.conf` for rsyslog and `etc/logrotate.d/noobaa/logrotate_noobaa.conf` for logrotate.These files contain the noobaa specific configuration for rsyslog and logrotate.

Rotate the logs manually.

```
logrotate /etc/logrotate.d/noobaa/logrotate_noobaa.conf 
```
