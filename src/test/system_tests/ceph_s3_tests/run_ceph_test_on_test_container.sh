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

export CEPH_TEST_LOGS_DIR=/logs/ceph-test-logs

export CONFIG_JS_OBJECT_SDK_BUCKET_CACHE_EXPIRY_MS=0 # Needed for disabling cache for ceph cors test and maybe some more
export CONFIG_JS_allow_anonymous_access_in_test=true # Needed for allowing anon access for tests using ACL='public-read-write'
export CONFIG_JS_S3_CORS_DEFAULTS_ENABLED=false # Needed for disabling cors defaults for ceph cors test

# ====================================================================================

# Create the logs directory
mkdir -p ${CEPH_TEST_LOGS_DIR}

# Deploy standalone NooBaa on the test container
./src/deploy/NVA_build/standalone_deploy.sh

# ====================================================================================

# Run the tests
./src/test/system_tests/ceph_s3_tests/test_ceph_s3_config_and_run_s3_tests.sh

# ====================================================================================
