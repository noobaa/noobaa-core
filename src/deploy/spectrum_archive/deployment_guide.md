# NooBaa Spectrum Scale/Archive Deployment Guide
This deployment guide goes over the steps that needs to be taken to get NooBaa running on GPFS filesystem. The steps in this guide should be followed in the same order as mentioned in the guide.

## NooBaa Prerequisites
NooBaa has the following prerequisites and expects them to be in place before proceeding with its installation and deployment.
1. Host is a Red Hat OS like Centos/RHEL.
2. Spectrum Scale along with Spectrum Archive must be in installed on the host machine.
3. libboost RPM packages must be already installed. In particular, `boost-system` and `boost-thread` packages are required. Without them in place, NooBaa installation will fail.

## NooBaa Installation
NooBaa is packaged as a RPM which needs to be installed in order to be able to use NooBaa.

1. Install by using `dnf`, `yum` or `rpm`.
   - Example: `rpm -i noobaa-core-5.15.0-1.el8.x86_64.20231009`.
2. NooBaa RPM installation should provide the following things
	1. `noobaa_nsfs.service` file located at `/usr/lib/systemd/system/noobaa_nsfs.service`.
	2. NooBaa source available at `/usr/local/noobaa-core`.

## NooBaa Configuration
NooBaa needs some configurations to be in place before we start up the NooBaa process and it is important to ensure that this is done before starting up the service.

### Configure NooBaa User
In order to be able to access NooBaa, the user should create a account. This can be done in the following way.
```console
$ cd /usr/local/noobaa-core
$ bin/node src/cmd/manage_nsfs.js account add --access_key <access-key> --secret_key <secret-key> --name <name-of-user> --new_buckets_path <path-to-store-bucket-data>
```

NOTE: `<path-to-store-bucket-data>` should already exist or else the above command will throw error.

Following the above steps we will create a new user for NooBaa with the given name. The user will be able to access the NooBaa S3 endpoint with the access key and secret key pair.

#### Example
```console
$ cd /usr/local/noobaa-core
$ mkdir /ibm/gpfs/noobaadata #Bucket Data Path should already exist
$ export AWS_ACCESS_KEY_ID=$(openssl rand -hex 20)
$ export AWS_SECRET_ACCESS_KEY=$(openssl rand -hex 20)
$ bin/node src/cmd/manage_nsfs.js account add --access_key $AWS_ACCESS_KEY_ID --secret_key $AWS_SECRET_ACCESS_KEY --name noobaa --new_buckets_path /ibm/gpfs/noobaadata
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
$ chmod +x ./src/deploy/spectrum_archive/setup_policies.sh
$ ./src/deploy/spectrum_archive/setup_policies.sh <device-or-directory-name> <noobaa-bucket-data-path> <tape-pool-name>
```
Here,
- `device-or-directory-name` is the name of the GPFS device or directory name. You may be able to find this by running `mount | grep gpfs`.
- `noobaa-bucket-data-path` is the path on GPFS where NooBaa is storing the data. This path should be the same as we passed in the [Configure NooBaa User](#configure-noobaa-user)'s `<path-to-store-bucket-data>`.
- `tape-pool-name` should be a valid tape pool name. You can find this by running `eeadm pool list`.

#### Example
```console
$ cd /usr/local/noobaa-core
$ chmod +x ./src/deploy/spectrum_archive/setup_policies.sh
$ ./src/deploy/spectrum_archive/setup_policies.sh /ibm/gpfs /ibm/gpfs/noobaadata pool1
```

## Start NooBaa
```console
$ systemctl start noobaa_nsfs
$ systemctl enable noobaa_nsfs #optional
$ systemctl status noobaa_nsfs # You should see status "Active" in green color
```

## Test NooBaa Installation
Now that NooBaa has been installed and is active, we can test out the deployment.
These AWS commands will read `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from the environment, ensure that these are available in the environment and should be the same that we used in [configure NooBaa user](#configure-noobaa-user).

```console
$ aws s3 --endpoint https://localhost:443 --no-verify-ssl mb s3://first.bucket # Create a bucket named first.bucket
make_bucket: first.bucket
$ aws s3 --endpoint https://localhost:443 --no-verify-ssl ls # List all of the buckets
2023-10-05 21:18:45 first.bucket
```

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

# FAQ
- What happens if I forget the credentials used to generate NooBaa User?
  - You can find all of the NooBaa accounts details here: `/etc/noobaa.conf.d/accounts`.
- How do I add new users?
  - You can repeat the command that we ran in the section [configure NooBaa User](#configure-noobaa-user). You need to make sure that the access key **must not be reused**.
- My migrations/restores aren't working!
  - You can find the migration/restore related logs in your crontab logs.
