#!/bin/bash

RUN_INIT=${1}
NOOBAA_SUPERVISOR="/data/noobaa_supervisor.conf"
NOOBAA_DATA_VERSION="/data/noobaa_version"
NOOBAA_PACKAGE_PATH="/root/node_modules/noobaa-core/package.json"

update_services_autostart() {
  local programs=(webserver bg_workers hosted_agents s3rver)
  local will_replace=false
    while read line; do
      if [[ ${line} =~ "program" ]]; then
        for program in ${programs[@]}; do
          if [[ ${line} =~ ${program} ]]; then
            will_replace=true
          fi
        done
      fi

      if [[ ${line} =~ "autostart" ]] && ${will_replace}; then
        echo ${line//true/false} >> ${NOOBAA_SUPERVISOR}.tmp
      else
        echo ${line} >> ${NOOBAA_SUPERVISOR}.tmp
      fi

      if [ "${line}" == "#endprogram" ]; then
        will_replace=false
      fi
    done < ${NOOBAA_SUPERVISOR}

  rm -rf ${NOOBAA_SUPERVISOR}
  mv ${NOOBAA_SUPERVISOR}.tmp ${NOOBAA_SUPERVISOR}
}

# run_internal_process runs a process and handles NOOBAA_INIT_MODE.
#
# NOOBAA_INIT_MODE allows devs to set how the container behaves when the process exits.
# Possible mode values are:
# - "" (no env/file or empty string) is the default and means to exit the container
# - "auto" restart the process without letting the container die to allow reloading code.
# - "manual" the container will loop and wait for manual intervention to change the mode.
#
# Usage: set env NOOBAA_INIT_MODE on the deployment pod spec
#   or write the value to /root/node_modules/noobaa-core/NOOBAA_INIT_MODE
#   (the file will override the env).
#
run_internal_process() {
  while true
  do
    local package_path="/root/node_modules/noobaa-core/package.json"
    local version=$(cat ${package_path} | grep version | awk '{print $2}' | sed 's/[",]//g')
    echo "Version is: ${version}"
    echo "Running: $*"
    $*
    rc=$?
    echo -e "\n\n\n"
    echo "######################################################################"
    echo "$(date) NooBaa: Process exited RIP (RC=$rc)"
    echo "######################################################################"
    echo -e "\n\n\n"

    mode="manual" # initial value just to start the loop
    while [ "$mode" == "manual" ]
    do
      # load mode from file/env
      if [ -f "./NOOBAA_INIT_MODE" ]
      then
        mode="$(cat ./NOOBAA_INIT_MODE)"
      else
        mode="$NOOBAA_INIT_MODE"
      fi

      if [ "$mode" == "auto" ]
      then
        echo "######################################################################"
        echo "$(date) NooBaa: Restarting process (NOOBAA_INIT_MODE=auto)"
        echo "######################################################################"
        echo -e "\n\n\n"
        # will break from the inner loop and re-run the process
      elif [ "$mode" == "manual" ]
      then
        echo "######################################################################"
        echo "$(date) NooBaa: Waiting for manual intervention (NOOBAA_INIT_MODE=manual)"
        echo "######################################################################"
        echo -e "\n"
        sleep 10
        # will re-enter the inner loop and reload the mode
      else
        [ ! -z "$mode" ] && echo "NooBaa: unrecognized NOOBAA_INIT_MODE = $mode"
        return $rc
      fi
    done
  done
}

prepare_agent_conf() {
  AGENT_CONF_FILE="/noobaa_storage/agent_conf.json"

  [ -f "$AGENT_CONF_FILE" ] && return 0

  # get AGENT_CONFIG from env var or file
  AGENT_CONFIG_PATH=${AGENT_CONFIG_PATH:-"/etc/agent-config/agent_config"}
  AGENT_CONFIG=${AGENT_CONFIG:-$(cat "$AGENT_CONFIG_PATH" 2>/dev/null || echo "")}

  if [ -z "${AGENT_CONFIG}" ]; then
    echo "AGENT_CONFIG is required. AGENT_CONFIG is not found in env or $AGENT_CONFIG_PATH. Exit"
    exit 1
  fi

  # write agent config - decode base64 if not a valid JSON format
  if ! echo "${AGENT_CONFIG}" | jq . >"$AGENT_CONF_FILE" 2>/dev/null; then
    openssl enc -base64 -d -A <<<"${AGENT_CONFIG}" >"$AGENT_CONF_FILE" || {
      echo "AGENT_CONFIG format is invalid. AGENT_CONFIG must be valid JSON or base64 encoded JSON. Exit"
      exit 1
    }
  fi
}

prepare_mongo_pv() {
  local shard_dir="/mongo_data/mongo/cluster/shard1"

  if [ ! -d ${shard_dir} ]; then
    echo "creating shard directory: ${shard_dir}" 
    mkdir -p ${shard_dir}
    chgrp 0 ${shard_dir}
    chmod g=u ${shard_dir}
  fi
}

init_endpoint() {

  # nsfs folder is a root folder of mount points to backing storages.
  # In oder to avoid access denied of sub folders, configure nsfs with full permisions (777)  
  if [ -d "/nsfs" ];then
    chmod 777 /nsfs
  fi

  cd /root/node_modules/noobaa-core/
  run_internal_process node --unhandled-rejections=warn ./src/s3/s3rver_starter.js
}

init_noobaa_agent() {

  cd /root/node_modules/noobaa-core/
  prepare_agent_conf
  run_internal_process node --unhandled-rejections=warn ./src/agent/agent_cli
}

if [ "${RUN_INIT}" == "agent" ]
then
  init_noobaa_agent
elif [ "${RUN_INIT}" == "init_mongo" ]
then
  prepare_mongo_pv
elif [ "${RUN_INIT}" == "init_endpoint" ]
then
  init_endpoint
else
  echo "noobaa_init.sh: unknown or missing RUN_INIT arg '${RUN_INIT}'"
  exit 1
fi
