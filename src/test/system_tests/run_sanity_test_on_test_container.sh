#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

set -e

# ====================================================================================
# Set the environment variables
export email='demo@noobaa.com'
export password=DeMo1

export PORT=8080
export SSL_PORT=5443
export ENDPOINT_PORT=80
export ENDPOINT_SSL_PORT=443
export NOOBAA_MGMT_SERVICE_HOST=localhost
export NOOBAA_MGMT_SERVICE_PORT=${SSL_PORT}
export NOOBAA_MGMT_SERVICE_PROTO=wss
export S3_SERVICE_HOST=localhost

export CREATE_SYS_NAME=demo
export CREATE_SYS_EMAIL=${email}
export CREATE_SYS_PASSWD=${password}
export JWT_SECRET=123456789
export NOOBAA_ROOT_SECRET='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
export LOCAL_MD_SERVER=true

export POSTGRES_HOST=${POSTGRES_HOST:-localhost}
export MGMT_ADDR=wss://${NOOBAA_MGMT_SERVICE_HOST:-localhost}:${NOOBAA_MGMT_SERVICE_PORT:-5443}
export BG_ADDR=wss://localhost:5445
export HOSTED_AGENTS_ADDR=wss://localhost:5446

export CEPH_TEST_LOGS_DIR=/logs/sanity-test-logs

# ====================================================================================

# Create the logs directory
mkdir -p ${CEPH_TEST_LOGS_DIR}

# Deploy standalone NooBaa on the test container
./src/deploy/NVA_build/standalone_deploy.sh

# ====================================================================================

# Run the tests
node ./src/test/system_tests/sanity_build_test.js --mgmt_ip ${NOOBAA_MGMT_SERVICE_HOST} --mgmt_port ${PORT} --mgmt_port_https ${SSL_PORT} --s3_ip ${S3_SERVICE_HOST} --s3_port ${ENDPOINT_PORT} --s3_port_https ${ENDPOINT_SSL_PORT}

# ====================================================================================
