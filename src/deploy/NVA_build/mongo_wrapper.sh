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
#27017 is the port for a single server
if [ ${MONGO_PORT} -eq '27000' ]; then
  set_mongo_cluster_mode ${MONGO_PORT}
fi


trap stop_mongo INT

function stop_mongo {
  deploy_log "got SIGINT. stopping mongo and exit"
  kill_mongo_services
  deploy_log "mongo_wrapper exiting with code 0"
  exit 0
}


function kill_mongo_services_with_signal {
  local sig=$1
  shift 1
  local pids=$*
  #only if there are pids to kill then send the signal
  if [ ! -z "${pids}" ]; then 
    deploy_log "killing mongo processes with signal ${sig}. PIDs=${pids}"
    kill ${sig} ${pids}
  fi
}

function get_live_pids {
  local pids=$*
  local live_pids=()
  for pid in ${pids}; do
    kill -0 ${pid} &> /dev/null
    if [ $? -eq 0 ]; then
      #if pid is still alive, make sure it's mongod\mongo_wrapper and add to live_pids
      ps -elf | grep "${pid}.*mongo" | grep -v grep > /dev/null
      if [ $? -eq 0 ]; then
        live_pids+=($pid)
      fi
    fi
  done
  echo "${live_pids[@]}"
}

#Killing all of the procs that hold the desired port
#Since mongo has a dedicated port nobody should hold it
#Probably the only procs that will actually hold the ports
#Are non supervised mongos, so we kill them in order to supervise
function kill_mongo_services {
  # list both mongod and mongo_wrapper processes
  mongo_ports_procs=$(lsof -i TCP:27017,27000 -s TCP:LISTEN | awk '{print $2}' | grep -v PID)
  mongo_wrapper_procs=$(ps -elf | grep "NVA_build/mongo_wrapper" | grep -v $$ | grep -v grep | awk '{print $4}')
  deploy_log "killing mongo_wrapper and mongod processes ${mongo_ports_procs} ${mongo_wrapper_procs} ${MONGO_PID}"
  #first attempt to kill using SIGINT. if process are still alive use SIGKILL
  kill_mongo_services_with_signal -2 ${mongo_ports_procs} ${mongo_wrapper_procs} ${MONGO_PID}
  #sleep for a second and then recheck. if not all mongo\wrappers are dead then wait some more and kill with -9
  sleep 1
  local live_pids=($(get_live_pids ${mongo_ports_procs} ${mongo_wrapper_procs} ${MONGO_PID}))
  if [ ${#live_pids[@]} -ne 0 ]; then
    echo "there are still live mongo services. pids=${live_pids[@]}"
    sleep 5
    kill_mongo_services_with_signal -9 $(get_live_pids ${live_pids[@]})
  fi
}

#Testing mongo for sanity every 10 seconds
#TODO: Maybe change the time?!
function mongo_sanity_check {
  #make sure mongo pid exists
  kill -0 ${MONGO_PID} &> /dev/null
  if [ $? -ne 0 ]; then
      deploy_log "could not find mongo pid ${MONGO_PID}"
      return 1
  fi
  
  #before starting sanity check, make sur mongod is up and listening on its port
  wait_for_mongo_to_start
  if [ $? -eq 1 ]; then
    return 1
  fi

  local backoff=$(cat $BACKOFF_FILE)
  while check_mongo_status ${MONGO_PORT} ${MONGO_PID}
  do
    echo 1 > ${BACKOFF_FILE}
    sleep 10
  done
  deploy_log "mongo_sanity_check: Failed"
  if [ ${backoff} -lt 120 ]; then
    backoff=$((backoff*2))
  fi
  echo ${backoff} > ${BACKOFF_FILE}
  return 1
}

function min {
  echo $(($1>$2?$2:$1))
}

function backoff_before_start {
  local backoff=$(cat $BACKOFF_FILE)
  local time_since_backoff_written=$(( $(date +%s) - $(stat ${BACKOFF_FILE} -c "%Y") ))
  deploy_log "backoff file was written ${time_since_backoff_written} seconds ago. backoff is ${backoff}"
  local sleep_time=$(( backoff - time_since_backoff_written ))
  # sleep the time left since backoff is written
  if [ ${sleep_time} -gt 0 ]; then
    sleep_time=$(min ${sleep_time} ${backoff})
    deploy_log "sleeping for ${sleep_time} seconds"
    sleep ${sleep_time}
  fi
}


function wait_for_mongo_to_start {
  deploy_log "waiting for mongod (pid=${MONGO_PID}) to start listening on port ${MONGO_PORT}"
  local mongo_listening_pid=$(lsof -i TCP:${MONGO_PORT} -s TCP:LISTEN | awk '{print $2}' | grep -v PID)
  local retries=0
  local MAX_RETRIES=120
  local RETRY_DELAY=5
  while [ "$mongo_listening_pid" != "${MONGO_PID}" ]; do
    deploy_log "mongod is still not listening on port ${MONGO_PORT}. test again in 5 seconds"
    retries=$((retries+1))
    if [ $retries -eq ${MAX_RETRIES} ]; then
      deploy_log "mongod failed to start for $((${MAX_RETRIES}*${RETRY_DELAY}/60)) minutes. aborting.."
      return 1
    fi
    sleep ${RETRY_DELAY}
    mongo_listening_pid=$(lsof -i TCP:${MONGO_PORT} -s TCP:LISTEN | awk '{print $2}' | grep -v PID)
  done
  deploy_log "mongod (pid=${MONGO_PID}) is now listening on port ${MONGO_PORT}"
}

MONGO_EXEC="$@"
deploy_log "mongo_wrapper was run with args ${MONGO_EXEC}"

backoff_before_start

#First of all we kill proc that hold the desired port
kill_mongo_services

# run mongod as mongod user and store its pid in tempfile
MONGO_PID_FILE=/tmp/mongo_wrapper_$$_mongod.pid
su - mongod -s /bin/bash -c "${MONGO_EXEC} & echo -n \$! > $MONGO_PID_FILE"
MONGO_PID=$(cat ${MONGO_PID_FILE})
deploy_log "mongod pid is ${MONGO_PID}"
rm -f ${MONGO_PID_FILE}
#Test sanity of mongo in order to catch problems and reload
mongo_sanity_check
if [ $? -eq 1 ]; then
  deploy_log "mongo_sanity_check failure: Killing services"
  kill_mongo_services
  deploy_log "mongo_wrapper exiting with code 1"
  exit 1
fi
