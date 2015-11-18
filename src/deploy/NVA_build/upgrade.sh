#!/bin/bash

. /root/node_modules/noobaa-core/src/deploy/NVA_build/deploy_base.sh

PACKAGE_FILE_NAME="new_version.tar.gz"
WRAPPER_FILE_NAME="upgrade_wrapper.sh"
WRAPPER_FILE_PATH="/tmp/test/noobaa-core/src/deploy/NVA_build/"
TMP_PATH="/tmp/"
EXTRACTION_PATH="/tmp/test/"
VER_CHECK="/root/node_modules/noobaa-core/src/deploy/NVA_build/version_check.js"
NEW_UPGRADE_SCRIPT="${EXTRACTION_PATH}noobaa-core/src/deploy/NVA_build/upgrade.sh"

function disable_supervisord {
  deploy_log "disable_supervisord"
  #services under supervisord
  local services=$($SUPERCTL status | grep pid | sed 's:.*pid \(.*\),.*:\1:')
  #disable the supervisord
  ${SUPERCTL} shutdown
  #kill services
  for s in ${services}; do
    deploy_log "Killing ${s}"
    kill -9 ${s}
  done

  local mongostatus=$(ps -ef|grep mongod)
  deploy_log "Mongo status after disabling supervisord $mongostatus"
}

function enable_supervisord {
  deploy_log "enable_supervisord"
  local mongostatus_bef=$(ps -ef|grep mongod)
  deploy_log "Mongo status before starting supervisord $mongostatus_bef"
  ${SUPERD}
}

function restart_webserver {
    ${SUPERCTL} stop webserver
    mongodown=true
    while ${mongodown}; do
    if netstat -na|grep LISTEN|grep :27017; then
            deploy_log mongo_${mongodown}
            mongodown=false
            deploy_log ${mongodown}
    else
            echo sleep
            sleep 1
    fi
    done
    ${SUPERCTL} start webserver

}

function restart_s3rver {
    ${SUPERCTL} restart s3rver
}


function check_latest_version {
  local current=$(grep CURRENT_VERSION $ENV_FILE | sed 's:.*=\(.*\):\1:')
  local path=$(node $VER_CHECK $current)
  deploy_log "Current version $current while path is $path"
  if [ "$path" != "" ]; then
    deploy_log "Upgrade needed, path ${path}"
    curl -sL ${path} > ${TMP_PATH}${PACKAGE_FILE_NAME} || true
    exit 1
  else
    deploy_log "Version is up to date"
    exit 0
  fi
}

function extract_package {
  mkdir -p ${EXTRACTION_PATH}
  cd ${EXTRACTION_PATH}
  cp ${TMP_PATH}${PACKAGE_FILE_NAME} .
  tar -xzvf ./${PACKAGE_FILE_NAME} >& /dev/null

  if [ $? -ne 0 ]; then
    deploy_log "Corrupted package file, could not open"
    rm -rf ${EXTRACTION_PATH}*
    exit 1
  fi

  #test if package contains expected locations/files, for example src/deploy/NVA_build/env.orig
  if [ -f "${EXTRACTION_PATH}noobaa-core/src/deploy/NVA_build/env.orig" ]; then
    deploy_log "env.orig exists in temp extraction point, continue with upgrade"
  else
    deploy_log "env.orig does not exists, abort upgrade"
    rm -rf ${EXTRACTION_PATH}*
    exit 1
  fi
}

function do_upgrade {
  disable_supervisord

  unalias cp
  deploy_log "Tar extracted successfully, Running pre upgrade"
  ${WRAPPER_FILE_PATH}${WRAPPER_FILE_NAME} pre ${FSUFFIX}

  deploy_log "Backup of current version and extract of new"
  #Delete old backup
  rm -rf /backup
  #Backup and extract
  mv ${CORE_DIR} /backup
  mkdir ${CORE_DIR}
  mv ${TMP_PATH}${PACKAGE_FILE_NAME} /root/node_modules
  cd /root/node_modules
  deploy_log "Extracting new version"
  tar -xzvf ./${PACKAGE_FILE_NAME} >& /dev/null
  #replace with locally built packages
  cp -rf /backup/node_modules/heapdump  /root/node_modules/noobaa-core/node_modules/
  cp -rf /backup/node_modules/bcrypt  /root/node_modules/noobaa-core/node_modules/

  #temp! build native on target machine
  #TODO: build on centos and use prebuild

  # Re-setup Repos
  setup_repos

  deploy_log "Running post upgrade"
  ${WRAPPER_FILE_PATH}${WRAPPER_FILE_NAME} post ${FSUFFIX}
  deploy_log "Finished post upgrade"

  enable_supervisord
  deploy_log "Enabling supervisor"
  #workaround - from some reason, without sleep + restart, the server starts with odd behavior
  #TODO: understand why and fix.
  sleep 5;
  restart_s3rver
  deploy_log "Restarted s3rver"
  restart_webserver
  deploy_log "Upgrade finished successfully!"
}

#Node.js Cluster chnages the .spawn behavour. On a normal spawn FDs are not inherited,
#on a node cluster they are, which meand the listening ports of the webserver are inherited by this upgrade.
#murder them
fds=`lsof -p $$ | grep LISTEN | awk '{print $4}' | sed 's:\(.*\)u:\1:'`
deploy_log "Detected File Descriptors $fds"
for f in ${fds}; do
  eval "exec ${f}<&-"
done

if [ "$1" == "from_file" ]; then
  allargs="$@"
  shift
  if [ "$1" != "" ]; then
      deploy_log "upgrade.sh called with ${allargs}"
      cp -f $1 ${TMP_PATH}${PACKAGE_FILE_NAME}
      extract_package
      shift
      ${NEW_UPGRADE_SCRIPT} do_upgrade $@
  else
    deploy_log "upgrade.sh called with ${allargs}"
    echo "Must supply path to upgrade package"
    exit 1
  fi
else
  if [ "$1" == "do_upgrade" ]; then
    shift

    if [ "$1" == "fsuffix" ]; then
      shift
      LOG_FILE="/var/log/noobaa_deploy_${1}.log"
      FSUFFIX="$1"
    fi

    deploy_log "upgrade.sh called with ${allargs}"
    do_upgrade
    exit 0
  else
    deploy_log "upgrade.sh called with $@"
    check_latest_version
    should_upgrade=$?
    echo "should upgrade $should_upgrade"
    if [ ${should_upgrade} -eq 1 ]; then
      extract_package
      $(${NEW_UPGRADE_SCRIPT} do_upgrade)
    fi
  fi
fi

exit 0
