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
    mongod &
    PID=$!
}

trap cleanup 1 2

start_mongo
command="npm test"
echo "$(date) running ${command}"
${command}
cleanup ${PID} ${?}
