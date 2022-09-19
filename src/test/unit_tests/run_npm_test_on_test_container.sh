#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

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
    mkdir -p /data/db
    echo "$(date) starting mongod"
    mongod --logpath /dev/null &
    PID=$!
}

PATH=$PATH:/noobaa-core/node_modules/.bin

command="npm test"

function usage() {
    echo -e "Usage:\n\t${0} [options]"
    echo -e "\t-c|--command     -   Replace the unit test command (default: ${command})"
    echo -e "\t-s|--single      -   Get the desired unit test to run and running it,"
    echo -e "\t                     needs to get the file name for example test_object_io.js"
    exit 0
}

while true
do
    if [ -z ${1} ]
    then
        break
    fi

    case ${1} in
        -c|--command)   shift 1
                        command=${*}
                        command_array=(${command})
                        shift ${#command_array[@]};;
        -s|--single)    command="./node_modules/mocha/bin/mocha.js src/test/unit_tests/${2}"
                        shift 2;;
        *)              usage;;
    esac
done

trap cleanup 1 2

start_mongo
echo "$(date) running ${command}"
${command}
cleanup ${PID} ${?}
