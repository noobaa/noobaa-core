
#!/bin/bash

if [ ${container_dbg} ] ;
then
  debug="bash -x"
  export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'
  set -x
fi

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
  local file
  local files=(deploy_base.sh noobaa-NVA.tar.gz noobaa.rpm)
  if [ "${container}" == "docker" ] ; then
    cd /tmp/
    rpm2cpio noobaa.rpm | cpio -idmv
    rm -rf /tmp/deploy_base.sh
    mv noobaa-NVA-*.tar.gz noobaa-NVA.tar.gz
    cd /root/node_modules
    tar -xzf /tmp/noobaa-NVA.tar.gz
    cd ~
    for file in ${files[@]} ; do
      rm -rf /tmp/${file}
    done
  fi
}

run_kube_pv_chown() {
  # change ownership and permissions of /data and /log. assuming that uid is not changed between reboots
  local path="/root/node_modules/noobaa-core/build/Release/"
  if [ "${container}" == "docker" ] ; then
      path="/noobaa_init_files/"
  fi
  ${path}/kube_pv_chown server
}

run_init_scripts() {
  local script
  local scripts=(fix_server_plat.sh fix_mongo_ssl.sh setup_server_swap.sh)
  local path="/root/node_modules/noobaa-core/src/deploy/NVA_build/"
  ############## run init scripts
  run_kube_pv_chown
  cd ${path}
  for script in ${scripts[@]} ; do
    ${debug} ./${script}
    if [ $? -ne 0 ] ; then
      #Providing in the yaml env variable with the name "container_dbg" 
      #will trigger the condition below.
      [ ${container_dbg} ] && sleep 120m
      echo "Failed to run ${script}"
      exit 1
    fi
  done
  cd - > /dev/null
}

init_noobaa_server() {
  fix_non_root_user
  extract_noobaa_in_docker
  run_init_scripts

  #check if unmamnaged upgrade is required
  handle_unmanaged_upgrade
}

init_noobaa_server
