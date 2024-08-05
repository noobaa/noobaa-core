# NooBaa Non Containerized - Configuration

1. [Introduction](#introduction)
2. [Config directory VS Data Base](#config-directory-vs-data-base)
3. [Config Directory](#configuration-directory)
    1. [Default Configuration Directory Location](#default-configuration-directory-location)
    2. [Custom Configuration Directory Setup](#custom-configuration-directory-setup)
    3. [Configuration Files Permissions](#configuration-files-permissions)
    4. [Configuration Directory Structure](#configuration-directory-structure)
    5. [Configuration Directory Components](#configuration-directory-components)
4. [Config File Customizations](#config-file-customizations)
5. [Certificates](#certificates)
6. [NooBaa Environment File (Not Recommended)](#noobaa-environment-file-not-recommended)
## Introduction

This guide offers details about NooBaa Non Containerized updated configuration structure, including its usage instructions, and a comparison between the traditional NooBaa database configuration and the new file system-based configuration.

## Config Directory VS Data Base

The NooBaa Non-Containerized offering uses the file system for configuration management, whereas the traditional NooBaa stores configurations in a PostgreSQL database. File system configurations offer easier access and simpler maintenance.


## Configuration Directory

NooBaa Non Containerized utilizes a file system-based configuration directory, which can reside at either the default location or a custom path specified by the user.

### Default Configuration Directory Location
The default configuration directory location is at `/etc/noobaa.conf.d/`, this path will be created during the RPM installation.  

For developers - While running the nsfs.js file directly (no RPM installation), create the root config directory manually as follows - 
```sh
mkdir -p /etc/noobaa.conf.d/
```

### Custom Configuration Directory Setup
Upon starting the NooBaa service, NooBaa CLI, or NooBaa Health CLI, the process will attempt to locate a text file that specifies the path to a custom configuration directory. 
* The text file located at the fixed location `/etc/noobaa.conf.d/config_dir_redirect`.

* If process could not find a redirect file at `/etc/noobaa.conf.d/config_dir_redirect`, the process will use `/etc/noobaa.conf.d/` as its default configuration directory.

* In order to let NooBaa redirect to the custom configuration directory location, the user must create a redirect file at the fixed location: `/etc/noobaa.conf.d/config_dir_redirect`.  
    Redirect file creation example - 
    ```sh
    echo "/path/to/custom/config/dir" > /etc/noobaa.conf.d/config_dir_redirect
    ```

For Developers - Use `--config_root` flag for specifying a custom configuration directory without creating a redirect file. This is only recommended for dev environment.


### Configuration files permissions
Mode
* Configuration files generated under the `accounts/` or `buckets/` directories will have 600 permissions, granting read and write access exclusively to the owner of each configuration file.

Ownership
* Configuration file created by the NooBaa CLI tool will be owned by the user who ran the NooBaa CLI command.
* Configuration file created by the NooBaa Service will be owned by `root`.

### Configuration Directory Structure
The default config directory structure contains the following files/directories - 

```sh
> sudo ls /etc/noobaa.conf.d/
system.json                 // Required
access_keys/                // Required
accounts/                   // Required
root_accounts/              // Required
buckets/                    // Required
config.json                 // Optional
master_keys.json            // Optional
certificates/               // Optional
```

When using custom config directory, the config files/directories tree is as follows - 

```sh
> sudo ls /etc/noobaa.conf.d/
config_dir_redirect                             // Required

> sudo cat /etc/noobaa.conf.d/config_dir_redirect
/path/to/custom/config/dir/

> sudo ls /path/to/custom/config/dir/
system.json                                     // Required
access_keys/                                    // Required
accounts/                                       // Required
root_accounts/                                  // Required
buckets/                                        // Required
config.json                                     // Optional
master_keys.json                                // Optional
certificates/                                   // Optional
```



### Configuration Directory Components 

`system.json` - 
* <u>Type</u>: File.
* <u>Required</u>: Yes.
* <u>Description</u>: A JSON file that contains information about the system deployed on the machine. 
* <u>Example</u>:
    ```JSON
    { 
        "hostname1": { 
            "current_version":"5.17.0",
            "upgrade_history":{
                "successful_upgrades":[]
            }
        },
        "hostname2": { 
            "current_version":"5.17.0",
            "upgrade_history":{
                "successful_upgrades":[]
            }
        }
    }
    ```
`accounts/` - 
* <u>Type</u>: Directory.
* <u>Required</u>: Yes.
* <u>Description</u>: A directory that contains configuration files for individual accounts, each account configuration file is named {account_id}.json and adheres to the [account schema](../../src/server/system_services/schemas/nsfs_account_schema.js).
* <u>Example</u>:
    ```sh
    > ls /etc/noobaa.conf.d/accounts/
    abcd.json
    1234.json
    ab12.json
    ```
`root_accounts/` -
* <u>Type</u>: Directory.
* <u>Required</u>: Yes.
* <u>Description</u>: A directory that contains a directory per root account, named {root_account_name}.
Inside each such directory, there is a symlink for the root account, named {root_account_name}.symlink.
There will be also the symlinks for the IAM accounts that are owned by the root account, named {account_name}.symlink.
Symlinks link to an account within account/.
The account symlink points to the relative path of the account rather than an absolute path, eg: `../../accounts/abcd.json`.
* <u>Example</u>:
    ```sh
    > ls /etc/noobaa.conf.d/root_accounts/
    alice/
    bob/
    charlie/
    > ls -la /etc/noobaa.conf.d/root_accounts/alice/
    alice.symlink -> ../../accounts/abcd.json
    bob.symlink   -> ../../accounts/1234.json
    ```

`access_keys/` 
* <u>Type</u>: Directory.
* <u>Required</u>: Yes.
* <u>Description</u>: A directory that contains symlinks to accounts configurations, each symlink named {access_key}.symlink, linking to an account within `accounts/` directory. The access key symlink points to a relative path of the account rather than an absolute path, for example: `../accounts/alice.json`.
* <u>Example</u>:
    ```sh
    > ls -la /etc/noobaa.conf.d/access_keys/
    0kbUZlNM9k4SCvrw1pftEXAMPLE.symlink -> ../accounts/abcd.json
    1kbUTlNM9k4SCvrw2pfxEXAMPLE.symlink -> ../accounts/1234.json
    2kbUMlNM9k4SCvrw3pfyEXAMPLE.symlink -> ../accounts/ab12.json
    ```
`buckets/`
* <u>Type</u>: Directory.
* <u>Required</u>: Yes.
* <u>Description</u>: A directory that contains configuration files for individual buckets, each bucket configuration file is named {bucket_name}.json and adheres to the [bucket schema](../../src/server/system_services/schemas/nsfs_bucket_schema.js).
* <u>Example</u>:
    ```sh
    > ls /etc/noobaa.conf.d/buckets/
    bucket1.json
    bucket2.json
    bucket3.json
    ```
`config.json`
* <u>Type</u>: File.
* <u>Required</u>: No.
* <u>Description</u>: A JSON file that contains shared configurations of all nodes on the cluster and machine specific configurations, for more details check - [Config File Customizations](#config-file-customizations)
* <u>Example</u>: 
    ```JSON
    {
        "ENDPOINT_FORKS": 2,
        "host_customization": {
            "{node_name}" : {
                "ENDPOINT_FORKS": 3, 
            }
        }
    }
    ```

`master_keys.json`
* <u>Type</u>: File.
* <u>Required</u>: No.
* <u>Description</u>: A JSON file containing master keys information. The master keys specified in this file used for encryption of sensitive data, such as account's secret key. When using 'executable' master keys store type, the master_keys.json is stored on a different location according to the user's executable files, therefore this file is optional. For more info, See [Config File Customizations](./ConfigFileCustomizations.md).
* <u>Example</u>: 
    ```JSON
    {
        "timestamp":1719143407465,
        "active_master_key":"aaaaaaaa",
        "master_keys_by_id": {
            "aaaaaaaa": {
                "id":"aaaaaaaa",
                "cipher_key":"bbbbbbbb",
                "cipher_iv":"cccccccc",
                "encryption_type":"aes-256-gcm"
            }
        }
    }
    ```

`certificates/`
* <u>Type</u>: Directory.
* <u>Required</u>: No.
* <u>Description</u>: A directory that stores SSL/TLS certificates for secure communication between S3 client and NooBaa Service. For more info, See - [Certificates](#certificates).
* <u>Example</u>: 
    ```sh
    > ls /etc/noobaa.conf.d/certificates/
    tls.crt
    tls.key
    ```

`config_dir_redirect`
* <u>Type</u>: File.
* <u>Required</u>: No.
* <u>Description</u>: A fixed location for setting a custom configuration directory location. For more info, See - [Custom Configuration Directory Setup](#custom-configuration-directory-setup).
* <u>Example</u>: 
    ```sh
    > cat /etc/noobaa.conf.d/config_dir_redirect
    /path/to/custom/config/dir/
    ```

## Config File Customizations

A user can customize NooBaa by creation of config.json file under the configuration directory - `/path/to/config_dir/config.json`.    
`config.json` is a JSON file that contains shared configurations of the cluster, and machine specific configurations.  
The config.json file will be reloaded every 10 seconds automatically, please note that some config.json properties require restart of NooBaa service.  
The following are some of the properties that can be customized -
1. Number of forks
2. Log debug level
3. Ports
4. Allow HTTP
5. GPFS library path
etc...

For more details about the available properties and an example see - [Non Containerized Config File Customizations](./ConfigFileCustomizations.md).

## Certificates

NooBaa Non containerized certificates/ directory stores SSL/TLS certificates for secure communication between S3 client and NooBaa Service. NooBaa will use a cert from certificates/ directory to create a valid HTTPS connection.
* The certificates/ directory contains SSL files `tls.key` and `tls.crt`.
* If a certificate is missing in this directory a self-signed SSL certificate will be generated. 
* Make sure the path to certificates/ directory is valid before running the service, If the path is invalid then cert flow will fail.
* By default, NooBaa Non containerized restrict insecure HTTP connections. Set `ALLOW_HTTP=true` in config.json for allowing HTTP connections.

### Self signed SSL/TLS Certificates Setup Instructions

#### 1. Creating a SAN (Subject Alternative Name) Config File -
**Important**: This step is needed only if S3 Client and NooBaa Service Running on different nodes.

To accommodate S3 requests originating from a different node than the node running the NooBaa service, it is recommended to create a Subject Alternative Name (SAN) configuration file. <br />
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
    ```sh
    sudo openssl genpkey -algorithm RSA -out tls.key
    sudo openssl req -new -key tls.key -out tls.csr
    sudo openssl x509 -req -days 365 -in tls.csr -signkey tls.key -out tls.crt
    ```

* If S3 Client and NooBaa Service Running on Different Nodes, run -
    ```shell
    sudo openssl genpkey -algorithm RSA -out tls.key
    sudo openssl req -new -key tls.key -out tls.csr -config san.cnf -subj "/CN=localhost"
    sudo openssl x509 -req -days 365 -in tls.csr -signkey tls.key -out tls.crt -extfile san.cnf -extensions req_ext
    ```

#### 3. Move tls.key and tls.crt under {config_dir_path}/cerfiticates -
```bash
sudo mv tls.key {config_dir_path}/certificates/
sudo mv tls.crt {config_dir_path}/certificates/
```
#### 4. Restart the NooBaa service -
```bash
sudo systemctl restart noobaa
```
#### 5. Create S3 CLI alias while including tls.crt at the s3 commands via AWS_CA_BUNDLE=/path/to/tls.crt -
* Make sure to replace `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` placeholders with their respective values, and the `endpoint` placeholder either with `localhost` or the domain name or IP of the node which is running the NooBaa service.
    ```bash
    alias s3_ssl='AWS_CA_BUNDLE=/path/to/tls.crt AWS_ACCESS_KEY_ID=add_your_access_key AWS_SECRET_ACCESS_KEY=add_your_secret_key aws --endpoint https://<endpoint>:6443 s3'
    ```

#### 6. Try running an s3 list buckets using the s3 alias -
```bash
s3_ssl ls
```


## NooBaa Environment File (Not Recommended) - 
NooBaa environment file, located at `/etc/sysconfig/noobaa` is used for passing environment variables to NooBaa.    
Most configurations can be set via config.json file, hence, `/etc/sysconfig/noobaa` is not recommended. 
#### Important 
* The env file format is key-value pairs.  
* If another `/usr/local/noobaa-core/.env` environment file exists it should be merged into `/etc/sysconfig/noobaa` carefully for avoiding conflicts.

#### Editing the NooBaa Environment File Steps
```sh
// 1. Edit the env file
vim  /etc/sysconfig/noobaa

// start noobaa service (first time)
systemctl enable noobaa 
systemctl start noobaa

// or restart
systemctl restart noobaa 
```


