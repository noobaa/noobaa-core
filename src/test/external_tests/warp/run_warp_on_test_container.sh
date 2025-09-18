#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

set -e

# ====================================================================================
# Set the environment variables
export email='admin@noobaa.io'
export password=123456789

export PORT=8080
export SSL_PORT=5443
export ENDPOINT_PORT=6001
export ENDPOINT_SSL_PORT=6443
export NOOBAA_MGMT_SERVICE_HOST=localhost
export NOOBAA_MGMT_SERVICE_PORT=${SSL_PORT}
export NOOBAA_MGMT_SERVICE_PROTO=wss
export S3_SERVICE_HOST=localhost

export CREATE_SYS_NAME=noobaa
export CREATE_SYS_EMAIL=${email}
export CREATE_SYS_PASSWD=${password}
export JWT_SECRET=123456789
export NOOBAA_ROOT_SECRET='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
export LOCAL_MD_SERVER=true

#The default max connections for postgres is 100. limit max clients to 10 per pool (per process). 
export CONFIG_JS_POSTGRES_MD_MAX_CLIENTS=10
export CONFIG_JS_POSTGRES_DEFAULT_MAX_CLIENTS=10

export POSTGRES_HOST=${POSTGRES_HOST:-localhost}
export MGMT_ADDR=wss://${NOOBAA_MGMT_SERVICE_HOST:-localhost}:${NOOBAA_MGMT_SERVICE_PORT:-5443}
export BG_ADDR=wss://localhost:5445
export HOSTED_AGENTS_ADDR=wss://localhost:5446
export CEPH_TEST_LOGS_DIR=/logs/warp-test-logs


# ====================================================================================

# Install warp
curl -L https://github.com/minio/warp/releases/download/v1.1.4/warp_Linux_x86_64.tar.gz -o warp_Linux_x86_64.tar.gz
tar -xzf warp_Linux_x86_64.tar.gz
chmod +x warp
mv warp /usr/local/bin/warp
warp --version

# ====================================================================================

# Create the logs directory
mkdir -p ${CEPH_TEST_LOGS_DIR}

# ====================================================================================

# Deploy standalone NooBaa on the test container
./src/deploy/NVA_build/standalone_deploy.sh

# ====================================================================================

cd /root/node_modules/noobaa-core/

# Configure the warp test 
node ./src/test/external_tests/warp/configure_warp.js

# ====================================================================================

# Wait for the system to be up and running
sleep 90

# ====================================================================================

# Run the warp tests
node ./src/test/external_tests/warp/run_warp.js "$@"

# ====================================================================================
