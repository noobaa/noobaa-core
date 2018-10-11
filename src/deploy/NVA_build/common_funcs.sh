#!/bin/bash

MONGO_PROGRAM="mongo_wrapper"
MONGO_SHELL="/usr/bin/mongo nbcore"
LOG_FILE="/var/log/noobaa_deploy_wrapper.log"
LOG_TOPIC="UPGRADE"
NOOBAANET="/etc/noobaa_network"

function deploy_log {
	if [ "$1" != "" ]; then
        local now=$(date)
        echo "${now} ${LOG_TOPIC} ${1}" >> ${LOG_FILE}
        logger -t ${LOG_TOPIC} -p local0.warn "${1}"
	fi
}

function set_deploy_log_topic {
    if [ "$1" != "" ]; then
        LOG_TOPIC=${1}
    fi
}

function set_mongo_cluster_mode {
	RS_SERVERS=`grep MONGO_RS_URL /root/node_modules/noobaa-core/.env | cut -d'@' -f 2 | cut -d'/' -f 1`
    MONGO_SHELL="/usr/bin/mongors --host mongodb://${RS_SERVERS}/nbcore?replicaSet=shard1"
}

function update_noobaa_net {
    > ${NOOBAANET}
    interfaces=$(ifconfig -a | grep ^eth | awk '{print $1}')
    for int in ${interfaces//:/}; do
        echo "${int}" >> ${NOOBAANET}
    done
}

function check_mongo_status {
    if [ "$2" == '27000' ]; then
      set_mongo_cluster_mode
    fi
    # even if the supervisor reports the service is running try to connect to it
    # beware not to run "local" in the same line changes the exit code
    local mongo_status
    local res=1
    local retries=0
    # don't fail the check on the first try. keep trying for a minute
    while [ $res -ne 0 ]; do
        mongo_status=$(${MONGO_SHELL} --quiet --eval 'quit(!db.serverStatus().ok)')
        res=$?
        if [ $res -ne 0 ]
        then
            # if we keep failing for a minute return failure to the caller
            if [ $retries -eq 12 ]; then
                deploy_log "check_mongo_status FAILED!!! could not connect to mongod for over a minute"
                return 1
            fi
            # if failed to get mongo status sleep 5 seconds and retry
            deploy_log "check_mongo_status: Failed to connect to mongod. sleep 5 seconds and retry: $mongo_status"
            retries=$((retries+1))
            sleep 5
        fi
    done
    deploy_log "check_mongo_status: PASSED! connected succesfully to local mongod"
    return 0
}

function wait_for_mongo {
    while ! check_mongo_status
    do
        deploy_log "wait_for_mongo: Waiting for mongo (sleep 5)"
        sleep 5
    done
}
