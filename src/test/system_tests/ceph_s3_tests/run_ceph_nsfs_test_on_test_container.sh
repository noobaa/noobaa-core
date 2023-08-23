#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

set -e

# ====================================================================================
# Set the environment variables
export email='admin@noobaa.io'
export password=123456789

export PORT=8080
export SSL_PORT=5443
export ENDPOINT_PORT=80 # This is the port that is set in the ceph tests config file
export ENDPOINT_SSL_PORT=443
export NOOBAA_MGMT_SERVICE_HOST=localhost
export NOOBAA_MGMT_SERVICE_PORT=${SSL_PORT}
export NOOBAA_MGMT_SERVICE_PROTO=wss
export S3_SERVICE_HOST=localhost

export CEPH_TEST_LOGS_DIR=/logs/ceph-nsfs-test-logs

# ====================================================================================

# Create the logs directory
mkdir -p ${CEPH_TEST_LOGS_DIR}
# Create root directory for bucket creation
mkdir -p ./standalone/nsfs_root
# Deploy standalone NooBaa on the test container
./src/deploy/NVA_build/standalone_deploy_nsfs.sh

# ====================================================================================

# Run the tests
./src/test/system_tests/ceph_s3_tests/test_ceph_nsfs_s3_config_and_run_s3_tests.sh
