#!/bin/bash

COMMON_FUNCS_PATH="/root/node_modules"
. ${COMMON_FUNCS_PATH}/noobaa-core/src/deploy/NVA_build/common_funcs.sh
MONGO_WRAPPER_PID=$$
set_deploy_log_topic "mongo_wrapper[${MONGO_WRAPPER_PID}]"
MONGO_SHELL="/usr/bin/mongo nbcore"
deploy_log "MONGO_EXEC is: ${MONGO_EXEC}"
MONGO_PORT=$(echo $@ | sed -n -e 's/^.*port //p' | awk '{print $1}')
deploy_log "MONGO_PORT is: ${MONGO_PORT}"
BACKOFF_FILE="/tmp/mongo_wrapper_backoff"
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
  proc=$(lsof -i TCP:27017,27000 -s TCP:LISTEN | awk '{print $2}' | grep -v PID)
  #kill pids
  for p in ${proc}; do
    deploy_log "Killing process that listens on mongo ports - pid ${p} - $(cat /proc/${p}/cmdline)"
    kill -9 ${p}
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
  while check_mongo_status $1 ${MONGO_PORT}
  do
    echo 1 > ${BACKOFF_FILE}
    sleep 10
  done
  deploy_log "mongo_sanity_check: Failed"
  if [ ${backoff} -lt 300 ]; then
    echo $((backoff*2)) > ${BACKOFF_FILE}
  fi
  return 1
}

#MONGO_EXEC varies and can be either for cluster or single mongo
function run_mongo {
  local proc
  deploy_log "run_mongo: Starting mongo process"
  # running MONGO_EXEC & makes mongod son of init (ppid=1). this is ok (probably?) and it is still killed 
  # when mongo_wrapper is killed by supervisord
  proc=$($MONGO_EXEC &)
  deploy_log "run_mongo: Mongo process pid: ${proc}"
  wait_for_mongo
  deploy_log "run_mongo: Mongo started"
}

case $1 in
  --testsystem)
    testsys="--testsystem"
    shift
    ;;
  *)
    ;;
esac

MONGO_EXEC="$@"
deploy_log "mongo_wrapper was run with args ${MONGO_EXEC}"
backoff=$(cat $BACKOFF_FILE)
deploy_log "backoff is ${backoff}, sleeping"
sleep ${backoff}
#First of all we kill proc that hold the desired port
kill_services_on_mongo_ports
#Limit run time so it won't get stuck in infinite loop on waiting for mongo
timeout --signal=SIGINT 60 cat <( run_mongo )
#Test sanity of mongo in order to catch problems and reload
mongo_sanity_check ${testsys}
if [ $? -eq 1 ]; then
  deploy_log "mongo_sanity_check failure: Killing services"
  kill_services_on_mongo_ports
  exit 1
fi
