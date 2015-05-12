#!/bin/bash

. ./deploy_base.sh

TMP_PACKAGE_FILE="new_version.tgz"
TMP_PACKAGE="/tmp/${TMP_PACKAGE_FILE}"
VER_CHECK="./version_check.js"


function disable_supervisord {
  #services under supervisord
  local services=$($SUPERCTL status | grep pid | sed 's:.*pid \(.*\),.*:\1:')
  #disable the supervisord
  ${SUPERCTL} shutdown
  #kill services
  for s in ${services}; do
    kill -9 ${s}
  done
}

function enable_supervisord {
  ${SUPERD}
}

function check_latest_version {
  local current=$(grep CURRENT_VERSION $ENV_FILE | sed 's:.*=\(.*\):\1:')
  local path=$(node $VER_CHECK $current)

  if [ "$path" != "" ]; then
    deploy_log "Upgrade needed, path ${path}"
    curl -sL ${path} > ${TMP_PACKAGE} || true
    exit 1
  else
    deploy_log "Version is up to date"
    exit 0
  fi
}

function do_upgrade {
  #Verify package integrity
  cd /tmp
  cp ${TMP_PACKAGE} .
  local rc=$(tar -xzvf ./${TMP_PACKAGE_FILE})

  if [ $rc -ne 0 ]; then
    deploy_log "Corrupted package file, could not open"
    enable_supervisord
    exit 1
  fi

  deploy_log "Tar extracted successfully, backup of current version"
  #Backup and extract
  mv ${CORE_DIR} /backup
  mkdir ${CORE_DIR}
  mv ${TMP_PACKAGE} ${CORE_DIR}
  cd ${CORE_DIR}
  deploy_log "Extracting new version"
	tar -xzvf ./${TMP_PACKAGE_FILE}

  # Re-setup Repos
  setup_repos
}

#exit on error, enable supervisor
check_latest_version
should_upgrade=$?
echo $should_upgrade
if [ should_upgrade -eq 1 ]; then
  disable_supervisord
  do_upgrade
  enable_supervisord
  deploy_log "Upgrade finished successfully!"
fi
