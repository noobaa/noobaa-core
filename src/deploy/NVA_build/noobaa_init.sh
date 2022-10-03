#!/bin/bash

RUN_INIT=${1}
NOOBAA_SUPERVISOR="/data/noobaa_supervisor.conf"
NOOBAA_DATA_VERSION="/data/noobaa_version"
NOOBAA_PACKAGE_PATH="/root/node_modules/noobaa-core/package.json"
KUBE_PV_CHOWN="/noobaa_init_files/kube_pv_chown"

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

## upgrade flow if version is changed
handle_server_upgrade() {
  cd /root/node_modules/noobaa-core/
  # env UPGRADE_SCRIPTS_DIR can be used to override the default directory that holds upgrade scripts
  if [ -z ${UPGRADE_SCRIPTS_DIR} ]
  then
    UPGRADE_SCRIPTS_DIR=/root/node_modules/noobaa-core/src/upgrade/upgrade_scripts
  fi
  echo "Running /usr/local/bin/node src/upgrade/upgrade_manager.js --upgrade_scripts_dir ${UPGRADE_SCRIPTS_DIR}"
  /usr/local/bin/node src/upgrade/upgrade_manager.js --upgrade_scripts_dir ${UPGRADE_SCRIPTS_DIR}
  rc=$?
  if [ ${rc} -ne 0 ]; then
    echo "upgrade_manager failed with exit code ${rc}"
    exit ${rc}
  fi
}

fix_non_root_user() {
  # in openshift, when not running as root - ensure that assigned uid has entry in /etc/passwd.
  if [ $(id -u) -ne 0 ]; then
      local NOOBAA_USER=noob
      if ! grep -q ${NOOBAA_USER}:x /etc/passwd; then
        echo "${NOOBAA_USER}:x:$(id -u):$(id -g):,,,:/home/$NOOBAA_USER:/bin/bash" >> /etc/passwd
      fi
  fi
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
  if [ -z ${AGENT_CONFIG} ]
  then
    echo "AGENT_CONFIG is required ENV variable. AGENT_CONFIG is missing. Exit"
    exit 1
  else
    echo "Got base64 agent_conf: ${AGENT_CONFIG}"
    if [ ! -f $AGENT_CONF_FILE ]; then
      openssl enc -base64 -d -A <<<${AGENT_CONFIG} >${AGENT_CONF_FILE}
    fi
    echo "Written agent_conf.json: $(cat ${AGENT_CONF_FILE})"
  fi
}

prepare_server_pvs() {
  # when running in kubernetes\openshift we mount PV under /data and /log
  # ensure existence of folders such as mongo, supervisor, etc.
  mkdir -p /log/supervisor
}

prepare_mongo_pv() {
  local main_dir="/mongo_data"
  local shard_dir="/mongo_data/mongo/cluster/shard1"
  local recursive_file="/mongo_data/recursive_file"
  local dir_id=$(stat -c '%u' ${main_dir})
  local current_id=$(id -u)

  # change ownership and permissions of mongo db path
  if [ "${dir_id}" != "${current_id}" ] || [ ! -f ${recursive_file} ]; then
    echo "uid change has been identified - will change from uid: ${dir_id} to new uid: ${current_id}"
    time ${KUBE_PV_CHOWN} mongo ${current_id}
    touch ${recursive_file}
  fi

  if [ ! -d ${shard_dir} ]; then
    echo "creating shard directory: ${shard_dir}" 
    mkdir -p ${shard_dir}
    chgrp 0 ${shard_dir}
    chmod g=u ${shard_dir}
  fi
}

prepare_postgres_pv() {
  local dir="/var/lib/pgsql"
  local dir_id=$(stat -c '%u' ${dir})    
  local current_id=$(id -u)

  # change ownership and permissions of mongo db path
  if [ "${dir_id}" != "${current_id}" ]
  then
    echo "uid change has been identified - will change from uid: ${dir_id} to new uid: ${current_id}"
    time ${KUBE_PV_CHOWN} postgres ${current_id}
  fi
}

init_endpoint() {
  fix_non_root_user

  # nsfs folder is a root folder of mount points to backing storages.
  # In oder to avoid access denied of sub folders, configure nsfs with full permisions (777)  
  if [ -d "/nsfs" ];then
    chmod 777 /nsfs
  fi

  cd /root/node_modules/noobaa-core/
  run_internal_process node --unhandled-rejections=warn ./src/s3/s3rver_starter.js
}

init_noobaa_server() {
  fix_non_root_user
  prepare_server_pvs

  handle_server_upgrade
}

init_noobaa_agent() {
  fix_non_root_user

  local dir="/noobaa_storage"
  mkdir -p ${dir}
  local dir_id=$(stat -c '%u' ${dir})    
  local current_id=$(id -u)

  # change ownership and permissions of noobaa_storage path
  if [ "${dir_id}" != "${current_id}" ]
  then
    echo "uid change has been identified - will change from uid: ${dir_id} to new uid: ${current_id}"
    time ${KUBE_PV_CHOWN} agent ${current_id}
  fi

  cd /root/node_modules/noobaa-core/
  prepare_agent_conf
  run_internal_process node --unhandled-rejections=warn ./src/agent/agent_cli
}

migrate_dbs() {
  fix_non_root_user
  
  cd /root/node_modules/noobaa-core/
  /usr/local/bin/node --unhandled-rejections=warn src/upgrade/migration_to_postgres.js
}

if [ "${RUN_INIT}" == "agent" ]
then
  init_noobaa_agent
elif [ "${RUN_INIT}" == "init_mongo" ]
then
  prepare_mongo_pv
elif [ "${RUN_INIT}" == "init_postgres" ]
then
  prepare_postgres_pv
elif [ "${RUN_INIT}" == "db_migrate" ]
then
  migrate_dbs
elif [ "${RUN_INIT}" == "init_endpoint" ]
then
  init_endpoint
else
  init_noobaa_server
fi
