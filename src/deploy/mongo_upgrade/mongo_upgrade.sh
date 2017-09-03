#!/bin/bash

if [ -d /tmp/test/ ]; then
  COMMON_FUNCS_PATH="/tmp/test/"
else
  COMMON_FUNCS_PATH="/root/node_modules"
fi

. ${COMMON_FUNCS_PATH}/noobaa-core/src/deploy/NVA_build/deploy_base.sh
. ${COMMON_FUNCS_PATH}/noobaa-core/src/deploy/NVA_build/common_funcs.sh

CLUSTER="$1"
if [ "$CLUSTER" == 'cluster' ]; then
    shift
    # TODO: handle differenet shard
    set_mongo_cluster_mode
fi


while [[ $# -gt 1 ]]; do
    key="$1"
    case $key in
        --param_secret)
            param_secret="$2"
            shift
            ;;
        --param_bcrypt_secret)
            param_bcrypt_secret="$2"
            shift
            ;;
        --param_ip)
            param_ip="$2"
            shift
            ;;
        --param_client_subject)
            param_client_subject="$2"
            shift
            ;;
        *)
            # unknown option
        ;;
    esac
    shift # past argument or value
done

should_mongo_upgrade=$(${MONGO_SHELL} --quiet --eval "db.clusters.find({owner_secret: '$param_secret'}).toArray()[0].upgrade.mongo_upgrade" | tail -n 1)
deploy_log "secret is ${param_secret} - should_mongo_upgrade = ${should_mongo_upgrade}"

if [ "$should_mongo_upgrade" == "true" ]; then
    #Ordered Array of scripts to run
    UPGRADE_SCRIPTS=(
        'mongo_upgrade_15.js' 
        'mongo_upgrade_17.js'
        'mongo_upgrade_18.js'
        'mongo_upgrade_19.js'
        'mongo_upgrade_1_10.js'
        'mongo_upgrade_mark_completed.js'
    )
else 
    UPGRADE_SCRIPTS=(
        'mongo_upgrade_wait_for_master.js'
    )
fi

upgrade_failed=0
for script in "${UPGRADE_SCRIPTS[@]}"; do 
    deploy_log "Running Mongo Upgrade Script ${script}"
    #set mongo audit and debug
    ${MONGO_SHELL} --quiet --eval 'db.setLogLevel(5)'
    

    ${MONGO_SHELL} --eval "var param_secret='${param_secret}', param_bcrypt_secret='${param_bcrypt_secret}', param_ip='${param_ip}', param_client_subject='${param_client_subject}'" ${CORE_DIR}/src/deploy/mongo_upgrade/${script}
    rc=$?
    if [ $rc -ne 0 ]; then
        upgrade_failed=1
        deploy_log "Failed Mongo Upgrade Script ${script}"        
    fi
done

#Set mongo audit and debug back to normal
${MONGO_SHELL} --quiet --eval 'db.setLogLevel(0)'

exit $upgrade_failed
