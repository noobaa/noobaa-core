#!/bin/bash

function cleanup() {
    
    if [ -n ${PID} ]; then
        echo "$(date) exiting mongod"
        kill -2 ${PID}
    fi
    echo "$(date) return code was: ${RC}"
    if [ -z ${RC} ]; then
        exit 0
    fi
    exit ${RC}
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
RC=${?}
cleanup
