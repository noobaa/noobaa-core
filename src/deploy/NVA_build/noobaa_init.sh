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

handle_unmanaged_upgrade() {
    #Container specific logic
    if grep -q PLATFORM=docker /data/.env; then
        code_version=$(grep version ${NOOBAA_PACKAGE_PATH} | awk -F'["|"]' '{print $4}')
        if [ ! -f ${NOOBAA_DATA_VERSION} ]; then 
            #New system, update data version file
            echo ${code_version} > ${NOOBAA_DATA_VERSION}
        else
            data_version=$(cat ${NOOBAA_DATA_VERSION})
            #verify if we need to start an un-managed upgrade
            if [ "${code_version}" != "${data_version}" ]; then
                logger -p local0.warn -t Superd "Code version ${code_version} differs from data version ${data_version}, initiating unmanaged upgrade"

                #code version differs from data version, need to initiate un-managed upgrade
                update_services_autostart
                cat >> ${NOOBAA_SUPERVISOR} << EOF

[program:upgrade_manager]
stopsignal=KILL
priority=1
autostart=true
directory=/root/node_modules/noobaa-core/
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/1
stderr_logfile_maxbytes=0
command=/usr/local/bin/node src/upgrade/upgrade_manager.js --old_version ${data_version} --unmanaged true
#endprogram
EOF
            fi
        fi
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
  # regurdless to the exit code
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
  mkdir -p /mongo_data/mongo/cluster/shard1
  # change ownership and permissions of mongo db path 
  ${KUBE_PV_CHOWN} mongo
}

fix_server_plat() {
NOOBAASEC="/data/noobaa_sec"
CORE_DIR="/root/node_modules/noobaa-core"

# If not sec file, fix it
if [ ! -f ${NOOBAASEC} ]; then
  if [ ! -f /data/noobaa_supervisor.conf ]; then
    # Setup Repos
    sed -i -e "\$aPLATFORM=docker" ${CORE_DIR}/src/deploy/NVA_build/env.orig
    # in a container set the endpoint\ssl ports to 6001\6443 since we are not running as root
    echo "ENDPOINT_PORT=6001" >> ${CORE_DIR}/src/deploy/NVA_build/env.orig
    echo "ENDPOINT_SSL_PORT=6443" >> ${CORE_DIR}/src/deploy/NVA_build/env.orig
    cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig /data/.env &>> /data/mylog
    cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_supervisor.conf /data &>> /data/mylog
  fi

  sec=$(uuidgen | cut -f 1 -d'-')
  echo ${sec} | tee -a ${NOOBAASEC}
  #dev/null to avoid output with user name
  #verify JWT_SECRET exists in .env, if not create it
  if ! grep -q JWT_SECRET /data/.env; then &> /dev/null
    jwt=$(cat /data/noobaa_sec | openssl sha512 -hmac | cut -c10-44)
    echo  "JWT_SECRET=${jwt}" >> /data/.env
  fi
fi

}

init_noobaa_server() {
  fix_non_root_user
  extract_noobaa_in_docker
  prepare_server_pvs
  fix_server_plat

  #commented out handle_unmanaged_upgrade since upgrade flow is depndent on mongo shell that was removed
  ###TODO: restore handle_unmanaged_upgrade once the upgrade script does not rely on mongo shell
  #check if unmamnaged upgrade is required
  # handle_unmanaged_upgrade
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
