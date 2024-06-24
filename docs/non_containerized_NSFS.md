# Non Containerized NooBaa

Running NooBaa non containerized is useful for deploying in linux without depending on kubernetes, but requires some steps which are described next.


## Build

### Build options -
1. noobaa-core S3 Select is enabled. This requires boost shared objects to be present on the machine where noobaa is supposed to be installed. This feature can be disabled if not required (due to additional dependency) by running make rpm BUILD_S3SELECT=0.
2. In order to build RPM packages for other architectures simply run make rpm CONTAINER_PLATFORM=linux/amd64 or make rpm CONTAINER_PLATFORM=linux/ppc64le
3. Building RPM packages is available on top of centos:9 / centos:8 base images, The default base image is centos:9.
In order to build RPM packages for centos:8 simply run `make rpm CENTOS_VER=8`.

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

### Download NooBaa RPM -
Nightly RPM builds of the upstream master branch can be downloaded from a public S3 bucket by running the following command -

```sh
wget  noobaa-core-{VERSION}-{DATE}.el9.x86_64.rpm // Replace the VERSION and DATE

Example:
wget https://noobaa-core-rpms.s3.amazonaws.com/noobaa-core-5.15.0-20231106.el9.x86_64.rpm
```

### Install NooBaa RPM -
Install NooBaa RPM by running the following command -

```sh
rpm -i <rpm_file_name>.rpm
```

After installing NooBaa RPM, it's expected to have noobaa-core source code under /usr/local/noobaa-core and an noobaa systemd example script under /usr/lib/systemd/system/.

## Create config dir redirect file -
NooBaa will try locate a text file that contains a path to the configuration directory, the user should create the redirect file in the fixed location - /etc/noobaa.conf.d/config_dir_redirect

```sh
echo "/path/to/config/dir" > /etc/noobaa.conf.d/config_dir_redirect
```

If config_root flag was not provided to the NooBaa service and /etc/noobaa.conf.d/config_dir_redirect file does not exist, NooBaa service will use /etc/noobaa.conf.d/ as its default config_dir.

## Create configuration files -
**IMPORTANT NOTE** - It's not mendatory to create the config_root under /etc/noobaa.conf.d/. config_dir path can be set using an CONFIG_JS_NSFS_NC_DEFAULT_CONF_DIR.

**1. Create buckets and accounts directories -**
```sh
mkdir -p /etc/noobaa.conf.d/
mkdir -p /etc/noobaa.conf.d/buckets/
mkdir -p /etc/noobaa.conf.d/accounts/
mkdir -p /etc/noobaa.conf.d/access_keys/

```

## Create FS -
If it's not already existing, create the fs root path in which buckets (directories) and objects (files) will be created.

```sh
mkdir -p /tmp/fs1/
```

## Developer customization of the NooBaa service (OPTIONAL) -
One can customize NooBaa service by creation of config.json file under the config_dir/ directory (/path/to/config_dir/config.json).
The following are some of the properties that can be customized -
1. Number of forks
2. Log debug level
3. Ports
4. Allow http
5. GPFS library path
etc...

For more details about the available properties and an example see - [Non Containerized NooBaa Developer Customization](https://github.com/noobaa/noobaa-core/blob/master/docs/dev_guide/NonContainerizedDeveloperCustomizations.md)

## Create accounts and exported buckets configuration files - ##

In order to create accounts and exported buckets see the management CLI instructions - [Bucket and Account Manage CLI](#bucket-and-account-manage-cli) <br />
Design of Accounts and buckets configuration entities - [NonContainerizedNooBaa](https://github.com/noobaa/noobaa-core/blob/master/docs/design/NonContainerizedNooBaaDesign.md). <br />
**Note** - All required paths on the configuration files (bucket - path, account - new_buckets_path) must be absolute paths.


## Run the NooBaa service -
The systemd script runs noobaa non containerized, and requires config_root in order to find the location of the system/accounts/buckets configuration file.
Limitation - In a cluster each host should have a unique name.
```sh
systemctl enable noobaa.service
systemctl start noobaa.service
```

## NooBaa service logs -
Run the following command in order to get the NooBaa service logs -

```sh
journalctl -u noobaa.service
```


## S3 Test

#### 1. Create account -
see the management CLI instructions for creating an account - [Bucket and Account Manage CLI](#bucket-and-account-manage-cli)

#### 2. Install aws cli -
see https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html


#### 3. Create s3 alias for the new account (to be referenced as account1) -
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
{"_id":"65cb1efcbec92b33220112d7","name":"s3bucket","owner_account":"65cb1e7c9e6ae40d499c0ae4","system_owner":"account1","bucket_owner":"account1","versioning":"DISABLED","creation_date":"2023-09-26T05:56:16.252Z","path":"/tmp/fs1/s3bucket","should_create_underlying_storage":true}
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
sudo cat /tmp/fs1/s3bucket/object1.txt

Output -
This is the content of object1
```


#### 7. S3 List objects -

```sh
s3-account1 ls s3://s3bucket

Output -
2023-09-21 11:55:01         31 object1.txt
```

## Health script
NooBaa Health status can be fetched using the command line. Run `--help` to get all the available options.

NOTE - health script execution requires root permissions.

 ```
 sudo node usr/local/noobaa-core/src/cmd/health [--https_port, --all_account_details, --all_bucket_details]
 ```

 output:
 ```
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
          "response_code": 200,
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
    }
  }
}
 ```
`status`: overall status of the system.

`error_code`: Error code for specific issue in health.

`error_message`: Message explaining the issue with the health script.

`service_status`: NooBaa systemd status. Check for noobaa service up and running.

`pid`: NooBaa systemd process id.

`endpoint_response`: Noobaa endpoint web service response code.

`total_fork_count`: Total number of forks in NooBaa.

`running_workers`: Running endpoint workers ids in list.

`invalid_buckets`: List of buckets missing valid storage path and invalid JSON schema definition.

`invalid_accounts`: List of account missing valid storage path and invalid JSON schema definition.

`valid_accounts`: List all the valid accounts if `all_account_details` flag is `true`.

`valid_buckets`: List all the valid buckets if `all_bucket_details` flag is `true`.

`error_type` : This property could have two values, `PERSISTENT` and `TEMPORARY`, It means the retry could fix the issue or not. For `TEMPORARY` error types multiple retries are initiated from Noobaa side before updating the status with failed status. Right now only Noobaa endpoint has the error type `TEMPORARY`.

In this health output, `bucket2`'s storage path is invalid and the directory mentioned in `new_buckets_path` for `user1` is missing or not accessible. Endpoint curl command returns an error response(`"endpoint_response":404`) if one or more buckets point to an invalid bucket storage path.

Account without `new_buckets_path` and `allow_bucket_creation` value is `false` then it's considered a valid account, But if the `allow_bucket_creation` is true `new_buckets_path` is empty, in that case account is invalid.

### Health Error Codes
These are the error codes populated in the health output if the system is facing some issues. If any of these error codes are present in health status then the overall status will be in `NOTOK` state.
#### 1. `NOOBAA_SERVICE_FAILED`
#### Reasons
- NooBaa service is not started properly.
- Stopped NooBaa service is not removed.

#### Resolutions
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

#### 2. `NOOBAA_ENDPOINT_FORK_MISSING`
#### Reasons
- One or more endpoint fork is not started properly.
- Number of workers running is less than the configured `forks` value.

#### Resolutions
- Restart the NooBaa service and also verify NooBaa fork/s is exited with error in logs.
```
systemctl status rsyslog.service
journalctl -xeu rsyslog.service
```

#### 3. `NOOBAA_ENDPOINT_FAILED`
#### Reasons
- NooBaa endpoint process is not running and Its not able to respond to any requests.

#### Resolutions
- Restart the NooBaa service and verify NooBaa process is exited with errors in logs.
```
systemctl status rsyslog
journalctl -xeu rsyslog.service
```
### Health Schema Error Codes
These error codes will get attached with a specific Bucket or Account schema inside `invalid_buckets` or `invalid_accounts` property.
#### 1. `STORAGE_NOT_EXIST`
#### Reasons
- Storage path mentioned in Bucket/Account schema pointing to the invalid directory.
#### Resolutions
- Make sure the path mentioned in Bucket/Account schema is a valid directory path.
- User has sufficient access.

#### 2. `INVALID_CONFIG`
#### Reasons
- Bucket/Account Schema JSON is not valid or not in JSON format.
#### Resolutions
- Check for any JSON syntax error in the schema structure for Bucket/Account.

#### 3. `ACCESS_DENIED`
#### Reasons
- Account `new_buckets_path` is not accessible with account uid and gid.
#### Resolutions
- Check access restriction in the path mentioned in `new_buckets_path` and compare it with account uid and gid

#### 4. `MISSING_CONFIG`
#### Reasons
- Account/Bucket schema config file is missing for config root.
#### Resolutions
- Check for schema config file in respective Accounts or Buckets dir.

## Bucket and Account Manage CLI
Users can create, get status, update, delete, and list buckets and accounts using CLI. If the config directory is missing CLI will create one and also create accounts and buckets sub-directories in it and default config directory is `${config.NSFS_NC_DEFAULT_CONF_DIR}`.

CLI will never create or delete a bucket directory for the user if a bucket directory is missing CLI will return with error.

NOTES -
1. noobaa cli execution requires root permissions.
2. While path specifies a GPFS path, it's recommended to add fs_backend=GPFS in order to increase performance by ordering NooBaa to use GPFS library.

Account Commands
```
sudo noobaa-cli account add --config_root ../standalon/config_root --name noobaa --new_buckets_path ../standalon/nsfs_root/ --fs_backend GPFS 2>/dev/null

sudo noobaa-cli account update --config_root ../standalon/config_root --name noobaa --fs_backend GPFS 2>/dev/null

sudo noobaa-cli account status --config_root ../standalon/config_root --name noobaa 2>/dev/null

sudo noobaa-cli account delete --config_root ../standalon/config_root --name noobaa 2>/dev/null

sudo noobaa-cli account list --config_root ../standalon/config_root 2>/dev/null

 ```

Bucket Commands
Note: before creating a bucket, a user must create an account.
```
sudo noobaa-cli bucket add --config_root ../standalon/config_root --name bucket1 --owner noobaa --path ../standalon/nsfs_root/1 --fs_backend GPFS 2>/dev/null

sudo noobaa-cli bucket update --config_root ../standalon/config_root --name bucket1 --owner noobaa --fs_backend GPFS 2>/dev/null

sudo noobaa-cli bucket status --config_root ../standalon/config_root --name bucket1 2>/dev/null

sudo noobaa-cli bucket delete --config_root ../standalon/config_root --name bucket1 2>/dev/null

sudo noobaa-cli bucket list --config_root ../standalon/config_root 2>/dev/null

```
NSFS management CLI run will create both accounts, access_keys, and buckets directories if they are missing under the config_root directory.
**Important**:  All the Account/Bucket commands end with `2>/dev/null` to make sure there are no unwanted logs.

Using `from_file` flag:
- For account and bucket creation users can also pass account or bucket values in JSON file (hereinafter referred to as "options JSON file") instead of passing them in CLI as arguments using flags.
- General use:

```bash
sudo noobaa-cli account add --config_root ../standalon/config_root --from_file <options_JSON_file_path>
sudo noobaa-cli bucket add --config_root ../standalon/config_root --from_file <options_JSON_file_path>
```

- The options are key-value, where the key is the same as suggested flags, for example:

(1) Create JSON file for account

```json
{
    "name": "account-1001",
    "uid": 1001,
    "gid": 1001,
    "new_buckets_path": "/tmp/nsfs_root1"
}
```

```bash
sudo noobaa-cli account add --config_root ../standalon/config_root --from_file <options_account_JSON_file_path>
```

(2) Create JSON file for bucket:

```json
{
    "name": "account-1001-bucket-1",
    "owner": "account-1001",
    "path": "/tmp/nsfs_root1/account-1001-bucket-1"
}
```

```
sudo noobaa-cli bucket add --config_root ../standalon/config_root --from_file <options_bucket_JSON_file_path>
```

- When using `from_file` flag the details about the account/bucket should be only inside the options JSON file.
- The JSON config file and JSON options file of account are different! 

## NSFS Certificate

Non containerized NooBaa certificates/ directory location will be under the config_root path. <br />
The certificates/ directory should contain SSL files tls.key and tls.crt. <br />
System will use a cert from this dir to create a valid HTTPS connection. If cert is missing in this dir a self-signed SSL certificate will be generated. Make sure the path to certificates/ directory is valid before running the service, If the path is invalid then cert flow will fail.

Non containerized NooBaa restrict insecure HTTP connections when `ALLOW_HTTP` is set to false in cofig.json. This is the default behaviour.

### Setting Up Self signed SSL/TLS Certificates for Secure Communication Between S3 Client and NooBaa Service -

#### 1. Creating a SAN (Subject Alternative Name) Config File -
**Important**: This step is needed only if S3 Client and NooBaa Service Running on different nodes.

To accommodate S3 requests originating from a different node than the one running the NooBaa service, it is recommended to create a Subject Alternative Name (SAN) configuration file. <br />
This file specifies the domain names or IP addresses that will be included in the SSL certificate.<br />
The Common Name (CN) sets the primary domain for the certificate, and additional domains or IPs can be listed under subjectAltName.<br />

Ensure to replace placeholders such as noobaa-domain-name-example.com and <noobaa-server-ip> with your actual domain and IP address.

Example SAN Config File (san.cnf):
```
# san.cnf

[req]
req_extensions = req_ext
distinguished_name = req_distinguished_name

[req_distinguished_name]
CN = localhost

[req_ext]
# The subjectAltName line directly specifies the domain names and IP addresses that the certificate should be valid for.
# This ensures the SSL certificate matches the domain or IP used in your S3 command.

# Example:
# 'DNS:localhost' makes the certificate valid when accessing S3 storage via 'localhost'.
# 'DNS:noobaa-domain-name-example.com' adds a specific domain to the certificate. Replace 'noobaa-domain-name-example.com' with your actual domain.
# 'IP:<noobaa-server-ip>' includes an IP address. Replace '<noobaa-server-ip>' with the actual IP address of your S3 server.
subjectAltName = DNS:localhost,DNS:noobaa-domain-name-example.com,IP:<noobaa-server-ip>
```


#### 2. Generating TLS Key, CSR, and CRT Files via OpenSSL -
 The following process will generate the necessary TLS key (tls.key), certificate signing request (tls.csr), and SSL certificate (tls.crt) files for secure communication between the S3 client and the NooBaa service.

* If S3 Client and NooBaa Service Running on the Same Node, run -

```bash
sudo openssl genpkey -algorithm RSA -out tls.key
sudo openssl req -new -key tls.key -out tls.csr
sudo openssl x509 -req -days 365 -in tls.csr -signkey tls.key -out tls.crt
```
* If S3 Client and NooBaa Service Running on Different Nodes, run -
```
$ sudo openssl genpkey -algorithm RSA -out tls.key
$ sudo openssl req -new -key tls.key -out tls.csr -config san.cnf -subj "/CN=localhost"
$ sudo openssl x509 -req -days 365 -in tls.csr -signkey tls.key -out tls.crt -extfile san.cnf -extensions req_ext
```

#### 3. Move tls.key and tls.crt under {config_dir_path}/cerfiticates -
Note - The default config_dir is /etc/noobaa.conf.d/.

```bash
sudo mv tls.key {config_dir_path}/certificates/
sudo mv tls.crt {config_dir_path}/certificates/
```
#### 4. Restart the NooBaa service -
```bash
sudo systemctl restart noobaa
```
#### 5. Create S3 CLI alias while including tls.crt at the s3 commands via AWS_CA_BUNDLE=/path/to/tls.crt -
* Make sure to replace credentials placeholders with their respective values, and the <endpoint> placeholder either with `localhost` or the domain name or IP of the node which is running the NooBaa service.
```bash
alias s3_ssl='AWS_CA_BUNDLE=/path/to/tls.crt AWS_ACCESS_KEY_ID=add_your_access_key AWS_SECRET_ACCESS_KEY=add_your_secret_key aws --endpoint https://<endpoint>:6443 s3'
```

#### 6. Try running an s3 list buckets using the s3 alias -
```bash
s3_ssl ls
```

## Monitoring

Prometheus metrics port can be passed through the argument `--metrics_port` while executing the noobaa command.
NooBaa state and output metrics can be fetched from URL `http:{host}:{metrics_port}/metrics/nsfs_stats`.

## Log and Logrotate
Noobaa logs are configured using rsyslog and logrotate. RPM will configure rsyslog and logrotate if both are already running.

Rsyslog status check
```
systemctl status rsyslog
```

Noobaa logs are pushed to `var/log/noobaa.log` and the log is rotated and compressed daily.

Verify the rsyslog and logrotate rpm configuration is complete by checking the files `etc/rsyslog.d/noobaa_syslog.conf` for rsyslog and `etc/logrotate.d/noobaa-logrotate` for logrotate.These files contain the noobaa specific configuration for rsyslog and logrotate.

Logrotate configuration is set up under `/etc/logrotate.d/`.  Logrotate is called from cron on daily schedule.

To rotate the logs manually run.

```
logrotate /etc/logrotate.d/noobaa-logrotate
```

**Create env file under the configuration directory (OPTIONAL) -**

In order to apply env variables changes on the service, edit /etc/sysconfig/noobaa env file as you wish before starting the service, notice that the env file format is key-value pair -

```sh
vim  /etc/sysconfig/noobaa
```
**Note** - If another /usr/local/noobaa-core/.env exists it should be merged into /etc/sysconfig/noobaa carefully.

In order to apply env changes after the service was started, edit the /etc/sysconfig/noobaa env file and restart the service -
```sh
vim  /etc/sysconfig/noobaa
systemctl restart noobaa
```

## WhiteList IPs

Access is restricted to these whitelist IPs. If there are no IPs mentioned all IPs are allowed. WhiteList IPs are added to cnfig.json.

```
sudo noobaa-cli whitelist --ips '["127.0.0.1", "192.000.10.000", "3002:0bd6:0000:0000:0000:ee00:0033:000"]'  2>/dev/null
```

## Anonymous request

Anonymous requests are those sent without access and secret key and Noobaa NSFS allow it with supporting bucket policy. Users have to create an anonymous account before accessing the resources. Noobaa uses anonymous account's uid and gid or user(distinguished_name) for accessing bucket storage paths. Noobaa can have one anonymous account. Commands for creating anonumous account are
```
noobaa-cli account add --anonymous --uid {uid} --gid {gid}
```
or
```
noobaa-cli account add --anonymous --user {user}
```

Update :
```
noobaa-cli account update --anonymous  --uid {new_uid} --gid {new_gid}
```
or 

```
noobaa-cli account update --anonymous  --user {user}
```

Delete: 
```
noobaa-cli account delete --anonymous
```
Status
```
noobaa-cli account status --anonymous
```

Bellow policy will allow anonymous user access and you can control the anonymous access using different policy configuration.

```
AWS_ACCESS_KEY_ID={access_key} AWS_SECRET_ACCESS_KEY={secret_key} aws s3api put-bucket-policy --endpoint {endpoint} --bucket {bucket_name} --policy file:///tmp/policy.json;
```

policy.json:

```
{
  "Version": "2012-10-17",
  "Statement": [ 
    { 
     "Effect": "Allow", 
     "Principal": { "AWS": [ "*" ] }, 
     "Action": [ "s3:*" ], 
     "Resource": [ "arn:aws:s3:::{bucket_name}/*", 
     "arn:aws:s3:::{bucket_name}" ] 
    }
  ]
}
```

User can perform all the actions on above bucket resource without providing access and secret key(not recommended).

`aws s3api list-objects --bucket {bucket_name} --endpoint {endpoint} --no-sign-request`