#!/bin/bash

if [ "${LOOP_ON_FAIL}" == "true" ]
then
  debug="bash -x"
  export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'
  set -x
fi

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

extract_noobaa_in_docker() {
  local tar="noobaa-NVA.tar.gz"
  local noobaa_core_path="/root/node_modules/noobaa-core/"
  if [ ! -d ${noobaa_core_path} ] ; then
    cd /root/node_modules
    tar -xzf /tmp/noobaa-NVA.tar.gz
    cd ~
  fi
}

run_agent_container() {
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
  node ./src/agent/agent_cli
  # Providing an env variable with the name "LOOP_ON_FAIL=true" 
  # will trigger the condition below.
  # Currently we will loop on any exit of the agent_cli 
  # regardless to the exit code
  while [ "${LOOP_ON_FAIL}" == "true" ] 
  do
    echo "$(date) Failed to run agent_cli" 
    sleep 10
  done
}

prepare_server_pvs() {
  # change ownership and permissions of /data and /log. 
  ${KUBE_PV_CHOWN} server
  # when running in kubernetes\openshift we mount PV under /data and /log
  # ensure existence of folders such as mongo, supervisor, etc.
  mkdir -p /log/supervisor
}

prepare_mongo_pv() {
  local dir="/mongo_data/mongo/cluster/shard1"

  # change ownership and permissions of mongo db path 
  ${KUBE_PV_CHOWN} mongo

  mkdir -p ${dir}
  chgrp 0 ${dir} 
  chmod g=u ${dir}
}

init_noobaa_server() {
  fix_non_root_user
  extract_noobaa_in_docker
  prepare_server_pvs

  handle_server_upgrade
}

init_noobaa_agent() {
  fix_non_root_user
  extract_noobaa_in_docker
  
  mkdir -p /noobaa_storage
  ${KUBE_PV_CHOWN} agent

  cd /root/node_modules/noobaa-core/
  run_agent_container
}


# init phase
init_pod() {
  prepare_mongo_pv
}

if [ "${RUN_INIT}" == "agent" ]
then
  init_noobaa_agent
elif [ "${RUN_INIT}" == "init_mongo" ]
then
  init_pod
else
  init_noobaa_server
fi
