# NooBaa Spectrum Scale/Archive Deployment Guide
This deployment guide goes over the steps that needs to be taken to get NooBaa running on GPFS filesystem. The steps in this guide should be followed in the same order as mentioned in the guide.

## NooBaa Installation
NooBaa is packaged as a RPM which needs to be installed in order to be able to use NooBaa.

1. Install by using `dnf`, `yum` or `rpm`.
	1. Have Node already installed? <-- FIX THIS
2. NooBaa RPM installation should provide the following things
	1. `nsfs.service` file located (soft link) at `/etc/systemd/systemd/nsfs.service`.
	2. NooBaa source available at `/usr/local/noobaa-core`.

## NooBaa Configuration

### Configure NooBaa User
In order to be able to access NooBaa, the user should create a account. This can be done in the following way.
```console
$ cd /usr/local/noobaa-core
$ bin/node src/cmd/manage_nsfs.js account add --email <email-address-of-user> --access_key <access-key> --secret_key <secret-key> --name <name-of-user> --new_buckets_path <path-to-store-bucket-data>
```

NOTE: `<path-to-store-bucket-data>` should already exist or else the above command will throw error.

Following the above steps we will create a new user for NooBaa with the given name and email. The user will be able to access the NooBaa S3 endpoint with the access key and secret key pair.

#### Example
```console
$ cd /usr/local/noobaa-core
$ mkdir /ibm/gpfs/noobaadata #Bucket Data Path should already exist
$ export AWS_ACCESS_KEY_ID=$(openssl rand -hex 20)
$ export AWS_SECRET_ACCESS_KEY=$(openssl rand -hex 20)
$ bin/node src/cmd/manage_nsfs.js account add --email noobaa@noobaa.io --access_key $AWS_ACCESS_KEY_ID --secret_key $AWS_SECRET_ACCESS_KEY --name noobaa --new_buckets_path /ibm/gpfs/noobaadata
```

### Configure NooBaa
```console
$ cat >/usr/local/noobaa-core/.env <<EOF
ENDPOINT_PORT=80
ENDPOINT_SSL_PORT=443
ENDPOINT_FORKS=8
UV_THREADPOOL_SIZE=64

EOF
```

```console
$ cat >/usr/local/noobaa-core/config-local.js <<EOF
/* Copyright (C) 2023 NooBaa */
'use strict';

/** @type {import('./config')} */
const config = exports;

config.NSFS_RESTORE_ENABLED = true;
EOF
```

### Configure Archiving
The following will setup appropriate spectrum scale policies which will assist NooBaa in moving data between different pools.

```console
$ cd /usr/local/noobaa-core
$ ./src/deploy/spectrum_archive/setup_policies.sh <device-or-directory-name> <noobaa-bucket-data-path> <tape-pool-name>
```
Here,
- `device-or-directory-name` is the name of the GPFS device or directory name. You may be able to find this by running `mount | grep gpfs`.
- `noobaa-bucket-data-path` is the path on GPFS where NooBaa is storing the data. This path should be the same as we passed in the [Configure NooBaa User](#configure-noobaa-user)'s `<path-to-store-bucket-data>`.
- `tape-pool-name` should be a valid tape pool name. You can find this by running `eeadm pool list`.
 
#### Example
```console
$ cd /usr/local/noobaa-core
$ ./src/deploy/spectrum_archive/setup_policies.sh /ibm/gpfs /ibm/gpfs/noobaadata pool1
```

## Start NooBaa
```console
$ systemctl start nsfs
$ systemctl enable nsfs #optional
$ systemctl status nsfs
```

## Test NooBaa
```console
$ aws s3 mb s3://first.bucket # Create a bucket named first.bucket
make_bucket: first.bucket
$ aws s3 ls
2023-10-05 21:18:45 first.bucket
```