#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

set -e
# It will add to the logs every line that we run
set -x

# ====================================================================================
# Set the environment variables
export email='admin@noobaa.io'
export password=123456789

export SERVER_ADDRESS=localhost
export ENDPOINT_PORT=6001
export ENDPOINT_SSL_PORT=6443
export S3_SERVICE_HOST=localhost

export CEPH_TEST_LOGS_DIR=/logs/mint-nc-test-logs
export CONFIG_DIR=/etc/noobaa.conf.d/
export FS_ROOT_1=/tmp/nsfs_root1/
export FS_ROOT_2=/tmp/nsfs_root2/
export CONFIG_JS_allow_anonymous_access_in_test=true # Needed for allowing anon access for tests using ACL='public-read-write'

# ====================================================================================

# 1. Create configuration directory
# 2. Create config.json file
mkdir -p ${CONFIG_DIR}
config='{"ALLOW_HTTP":true, "ENDPOINT_FORKS":2, "NSFS_CALCULATE_MD5": true}'
echo "$config" > ${CONFIG_DIR}/config.json

# 1. Create root directory for bucket creation
# 2. Add permission to all users
# this will allow the new accounts to create directories (buckets),
# else we would see [Error: Permission denied] { code: 'EACCES' }
mkdir -p ${FS_ROOT_1}
mkdir -p ${FS_ROOT_2}
chmod 777 ${FS_ROOT_1}
chmod 777 ${FS_ROOT_2}

# Create the logs directory
mkdir -p ${CEPH_TEST_LOGS_DIR}
chmod 777 ${CEPH_TEST_LOGS_DIR}

# ====================================================================================

# Deploy standalone NooBaa on the test container
# And create the accounts needed for the Ceph tests
./src/deploy/NVA_build/standalone_deploy_nsfs.sh

# ====================================================================================

cd /root/node_modules/noobaa-core/

# Configure the mint test 
node ./src/test/external_tests/mint/configure_mint.js
