#!/bin/bash

# Assumes that a postgresql is already running

# This deployment script just automates the steps in the doc/standalone.md file

# Create a basic config file for standalone
cat >config-local.js <<EOF
/* Copyright (C) 2023 NooBaa */
'use strict';

/** @type {import('./config')} */
const config = exports;

config.DEFAULT_POOL_TYPE = 'HOSTS';
config.AGENT_RPC_PORT = '9999';
config.AGENT_RPC_PROTOCOL = 'tcp';
config.POSTGRES_DEFAULT_MAX_CLIENTS = 10;
EOF

# setup_env is not needed when running inside a container because the container
# environment would already be setup (in case of ceph test for example)
function setup_env() {
    cat >.env <<EOF
    CREATE_SYS_NAME=${CREATE_SYS_NAME:-noobaa}
    CREATE_SYS_EMAIL=${CREATE_SYS_EMAIL:-admin@noobaa.io}
    CREATE_SYS_PASSWD=${CREATE_SYS_PASSWD:-123456789}
    JWT_SECRET=${JWT_SECRET:-123456789}
    NOOBAA_ROOT_SECRET=${NOOBAA_ROOT_SECRET:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}
    LOCAL_MD_SERVER=${LOCAL_MD_SERVER:-true}

    POSTGRES_HOST=${POSTGRES_HOST:-localhost}
    MGMT_ADDR=${MGMT_ADDR:-wss://localhost:5443}
    BG_ADDR=${BG_ADDR:-wss://localhost:5445}
    HOSTED_AGENTS_ADDR=${HOSTED_AGENTS_ADDR:-wss://localhost:5446}
EOF
}

function execute() {
    if [[ -z "${CEPH_TEST_LOGS_DIR}" ]]; then
        $1 &
    else
        $1 2>&1 | tee "${CEPH_TEST_LOGS_DIR}/${2}" &
    fi
}

function sigterm() {
    echo "SIGTERM received"
    kill -TERM $(jobs -p)
    exit 0
}

function main() {
    if [ "${STANDALONE_SETUP_ENV}" = "true" ]; then
        setup_env
    fi

    trap sigterm SIGTERM

    # Start NooBaa processes
    execute "npm run web" web.log
    sleep 10

    execute "npm run bg" bg.log
    sleep 10

    execute "npm run hosted_agents" hosted_agents.log
    sleep 10

    execute "npm run s3" s3.log
    sleep 10

    mkdir -p storage/backingstores/drive1
    execute "npm -- run backingstore storage/backingstores/drive1 --port 9991" backingstore1.log
    sleep 30

    wait
}

main
