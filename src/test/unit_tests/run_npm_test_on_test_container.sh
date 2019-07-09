#!/bin/bash

function cleanup() {
    local rc
    local pid=$1
    if [ -z ${2} ]
    then
        rc=0
    else
        rc=$2
    fi
    echo "$(date) exiting mongod"
    kill -2 ${pid}
    echo "$(date) return code was: ${rc}"
    exit ${rc}
}

function start_mongo() {
    source /opt/rh/rh-mongodb36/enable
    mkdir -p /data/db
    echo "$(date) starting mongod"
    mongod --logpath /dev/null &
    PID=$!
}

trap cleanup 1 2

start_mongo
command="node --allow-natives-syntax ./node_modules/.bin/_mocha src/test/unit_tests/index.js"
echo "$(date) running ${command}"
${command}
cleanup ${PID} ${?}
