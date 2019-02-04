
#!/bin/bash

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
    if grep -q PLATFORM=docker /root/node_modules/noobaa-core/.env; then
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
user=root
directory=/root/node_modules/noobaa-core/
stderr_logfile_backups=3
stdout_logfile_backups=3
command=/usr/local/bin/node src/upgrade/upgrade_manager.js --old_version ${data_version} --unmanaged true
#endprogram
EOF
            fi
        fi
    fi
}

init_noobaa_server() {
  # run init scripts
  /root/node_modules/noobaa-core/src/deploy/NVA_build/fix_server_plat.sh
  /root/node_modules/noobaa-core/src/deploy/NVA_build/fix_mongo_ssl.sh

  #check if unmamnaged upgrade is required
  handle_unmanaged_upgrade
}





