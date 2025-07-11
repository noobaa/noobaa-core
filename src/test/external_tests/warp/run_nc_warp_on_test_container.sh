#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

set -e
# It will add to the logs every line that we run
set -x

# ====================================================================================
# Set the environment variables
export email='admin@noobaa.io'
export password=123456789

export ENDPOINT_PORT=6001
export ENDPOINT_SSL_PORT=6443
export S3_SERVICE_HOST=localhost

export CEPH_TEST_LOGS_DIR=/logs/warp-nc-test-logs
export CONFIG_DIR=/etc/noobaa.conf.d/
export FS_ROOT_1=/tmp/nsfs_root1/
export FS_ROOT_2=/tmp/nsfs_root2/
export WARP_BUCKET_PATH=${FS_ROOT_1}/warp-benchmark-bucket/
export CONFIG_JS_allow_anonymous_access_in_test=true # Needed for allowing anon access for tests using ACL='public-read-write'

# ====================================================================================

# 1. Create configuration directory
# 2. Create config.json file
mkdir -p ${CONFIG_DIR}
config='{"ALLOW_HTTP":true, "ENDPOINT_FORKS":2}'
echo "$config" > ${CONFIG_DIR}/config.json

# 1. Create root directory for bucket creation
# 2. Add permission to all users
# this will allow the new accounts to create directories (buckets),
# else we would see [Error: Permission denied] { code: 'EACCES' }
mkdir -p ${FS_ROOT_1}
mkdir -p ${FS_ROOT_2}
mkdir -p ${WARP_BUCKET_PATH}
chmod 777 ${FS_ROOT_1}
chmod 777 ${FS_ROOT_2}
chmod 777 ${WARP_BUCKET_PATH}

# Create the logs directory
mkdir -p ${CEPH_TEST_LOGS_DIR}


# ====================================================================================

# Install warp
curl -L https://github.com/minio/warp/releases/download/v1.1.4/warp_Linux_x86_64.tar.gz -o warp_Linux_x86_64.tar.gz
tar -xzf warp_Linux_x86_64.tar.gz
chmod +x warp
mv warp /usr/local/bin/warp
warp --version

# ====================================================================================

# Deploy standalone NooBaa on the test container
# And create the accounts needed for the Ceph tests
./src/deploy/NVA_build/standalone_deploy_nsfs.sh

# ====================================================================================

cd /root/node_modules/noobaa-core/

# Configure the warp test 
node ./src/test/external_tests/warp/configure_warp.js

# ====================================================================================

# Run the warp tests
node ./src/test/external_tests/warp/run_warp.js

# ====================================================================================
