#!/bin/bash

COMMON_FUNCS_PATH="/root/node_modules"
. ${COMMON_FUNCS_PATH}/noobaa-core/src/deploy/NVA_build/common_funcs.sh
set_deploy_log_topic "mongo_wrapper"
MONGO_SHELL="/usr/bin/mongo nbcore"
MONGO_EXEC="$@"
deploy_log "MONGO_EXEC is: ${MONGO_EXEC}"
MONGO_PORT=$(echo $@ | sed -n -e 's/^.*port //p' | awk '{print $1}')
deploy_log "MONGO_PORT is: ${MONGO_PORT}"
#Mongo uses two ports
#27000 is currently the port for cluster
#27015 is the port for a single server
if [ ${MONGO_PORT} -eq '27000' ]; then
  set_mongo_cluster_mode
fi

#Killing all of the procs that hold the desired port
#Since mongo has a dedicated port nobody should hold it
#Probably the only procs that will actually hold the ports
#Are non supervised mongos, so we kill them in order to supervise
function kill_services_on_mongo_ports {
  local proc
  proc=$(lsof -i :27017,27000 | awk '{if(NR>1)print $1,"",$2}')
  #kill pids
  for p in ${proc}; do
    local pid=$(echo $proc | awk '{print $2}')
    deploy_log "Killing ${p}"
    kill -9 ${pid}
  done

  proc=$(ps -elf | grep mongo_wrapper | grep -v $$ | awk '{print $4}')
  for p in ${proc}; do
    deploy_log "Killing mongo_wrapper ${p}"
    kill -9 ${p}
  done
}

#Testing mongo for sanity every 10 seconds
#TODO: Maybe change the time?!
function mongo_sanity_check {
  while check_mongo_status
  do
    sleep 10
  done
  deploy_log "mongo_sanity_check: Failed"
  return 1
}

#MONGO_EXEC varies and can be either for cluster or single mongo
function run_mongo {
  local proc
  deploy_log "run_mongo: Starting mongo process"
  proc=$($MONGO_EXEC &)
  deploy_log "run_mongo: Mongo process pid: ${proc}"
  wait_for_mongo
  deploy_log "run_mongo: Mongo started"
}

#First of all we kill proc that hold the desired port
kill_services_on_mongo_ports
#Limit run time so it won't get stuck in infinite loop on waiting for mongo
timeout --signal=SIGINT 60 cat <( run_mongo )
#Test sanity of mongo in order to catch problems and reload
mongo_sanity_check
if [ $? -eq 1 ]; then
  deploy_log "mongo_sanity_check failure: Killing services"
  kill_services_on_mongo_ports
  exit 1
fi
