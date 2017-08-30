#!/bin/bash

# redirect the output log file to syslog (http://urbanautomaton.com/blog/2014/09/09/redirecting-bash-script-output-to-syslog)
exec 1> >(logger -t UPGRADE -p local0.warn) 2>&1

EXTRACTION_PATH="/tmp/test/"

#TODO do we want to load base on /tmp/test? maybe load common_funcs differenetly
if [ -d /tmp/test/ ]; then
  COMMON_FUNCS_PATH="/tmp/test/"
else
  COMMON_FUNCS_PATH="/root/node_modules"
fi


. ${COMMON_FUNCS_PATH}/noobaa-core/src/deploy/NVA_build/deploy_base.sh
. ${COMMON_FUNCS_PATH}/noobaa-core/src/deploy/NVA_build/common_funcs.sh

PACKAGE_FILE_NAME="new_version.tar.gz"
WRAPPER_FILE_NAME="upgrade_wrapper.sh"
WRAPPER_FILE_PATH="/tmp/test/noobaa-core/src/deploy/NVA_build/"
TMP_PATH="/tmp/"
VER_CHECK="/root/node_modules/noobaa-core/src/deploy/NVA_build/version_check.js"
NEW_UPGRADE_SCRIPT="${EXTRACTION_PATH}noobaa-core/src/deploy/NVA_build/upgrade.sh"
MONGO_SHELL="/usr/bin/mongo nbcore"

function disable_autostart {
  deploy_log "disable_autostart"
  # we need to start supervisord, but we don't want to start all services.
  # use sed to set autostart to false. replace back when finished.
  sed -i "s:autostart=true:autostart=false:" /etc/noobaa_supervisor.conf
  #web_server doesn't specify autostart. a hack to prevent it from loading
  sed -i "s:web_server.js:WEB.JS:" /etc/noobaa_supervisor.conf
}

function enable_autostart {
  deploy_log "enable_autostart"
  # restore autostart and web_server.js
  sed -i "s:autostart=false:autostart=true:" /etc/noobaa_supervisor.conf
  #web_server doesn't specify autostart. a hack to prevent it from loading
  sed -i "s:WEB.JS:web_server.js:" /etc/noobaa_supervisor.conf
}

function disable_supervisord {
  deploy_log "disable_supervisord"
  #services under supervisord
  local services=$($SUPERCTL status | grep pid | sed 's:.*pid \(.*\), uptime.*:\1:')
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

function packages_upgrade {

    #fix SCL issue (preventing yum install/update)
    deploy_log "fix SCL issue (centos-release-SCL)"
    yum -y remove centos-release-SCL
    yum -y install centos-release-scl

    #update rsyslog to version 8
    deploy_log "update rsyslog - copy src/deploy/NVA_build/rsyslog.repo to /etc/yum.repos.d/rsyslog.repo"
    cp -f ${EXTRACTION_PATH}/noobaa-core/src/deploy/NVA_build/rsyslog.repo /etc/yum.repos.d/rsyslog.repo
    cp -f ${EXTRACTION_PATH}/noobaa-core/src/deploy/NVA_build/RPM-GPG-KEY-Adiscon  ${CORE_DIR}/src/deploy/NVA_build/RPM-GPG-KEY-Adiscon
    deploy_log "yum update rsyslog..."
    yum update rsyslog -y

    deploy_log "install additional packages"
    yum install -y \
        sudo \
        lsof \
        wget \
        curl \
        ntp \
        rsyslog \
        cronie \
        openssh-server \
        dialog \
        expect \
        nc \
        tcpdump \
        iperf \
        iperf3 \
        python-setuptools \
        bind-utils \
        screen \
        strace \
        vim
}

function mongo_upgrade {
  disable_autostart

  ${SUPERD}
  sleep 3

  ${SUPERCTL} start ${MONGO_PROGRAM}
  wait_for_mongo

  #MongoDB nbcore upgrade
  local sec=$(cat /etc/noobaa_sec)
  local bcrypt_sec=$(/usr/local/bin/node ${CORE_DIR}/src/tools/bcrypt_cli.js "${sec}")
  local id=$(uuidgen | cut -f 1 -d'-')
  local ip=$(ifconfig | grep -w 'inet' | grep -v 127.0.0.1 | awk '{print $2}')
  local client_subject=$(openssl x509 -in /etc/mongo_ssl/client.pem -inform PEM -subject -nameopt RFC2253 | grep subject | awk '{sub("subject= ",""); print}')
  deploy_log "starting mongo data upgrade ${bcrypt_sec} ${id} ${ip}"
  ${CORE_DIR}/src/deploy/mongo_upgrade/mongo_upgrade.sh ${CLUSTER} --param_secret ${sec} --param_bcrypt_secret ${bcrypt_sec} --param_ip ${ip} --param_client_subject ${client_subject}  
  local rc=$?
  if [ $rc -ne 0 ]; then
      deploy_log "FAILED mongo data upgrade!"
  else
      deploy_log "finished mongo data upgrade"
  fi

  enable_autostart

  ${SUPERCTL} update
  ${SUPERCTL} start all
  sleep 3
}

function setup_users {
	deploy_log "setting up mongo users for admin and nbcore databases"
	/usr/bin/mongo admin ${CORE_DIR}/src/deploy/NVA_build/mongo_setup_users.js
	deploy_log "setup_users done"
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
  #Clean previous extracted package
  rm -rf ${EXTRACTION_PATH}*
  #Create path and extract package
  mkdir -p ${EXTRACTION_PATH}
  cd ${EXTRACTION_PATH}
  cp ${TMP_PATH}${PACKAGE_FILE_NAME} .
  tar -xzvf ./${PACKAGE_FILE_NAME} >& /dev/null

  #If package can't be extracted, clean
  if [ $? -ne 0 ]; then
    deploy_log "Corrupted package file, could not open"
    rm -rf ${EXTRACTION_PATH}*
    exit 1
  fi

  # #test if package contains expected locations/files, for example build/Release/native_core.node
  # if [ -f "${EXTRACTION_PATH}noobaa-core/build/Release/native_core.node" ]; then
  #         deploy_log "native_core.node exists in temp extraction point, continue with upgrade"
  #         #test if build time is newer than current version build time
  #         if [ "${EXTRACTION_PATH}noobaa-core/build/Release/native_core.node" -nt "/root/node_modules/noobaa-core/build/Release/native_core.node" ]; then
  #             deploy_log "native_core.node exists and its newer than current version, continue with upgrade"
  #        else
  #            deploy_log "build time is older than current version, abort upgrade"
  #            rm -rf ${EXTRACTION_PATH}*
  #            exit 1
  #         fi
  # else
  #   deploy_log "native_core.node does not exists, abort upgrade"
  #   rm -rf ${EXTRACTION_PATH}*
  #   exit 1
  # fi
}


function do_upgrade {
  #Update packages before we stop services, minimize downtime, limit run time for yum update so it won't get stuck
  timeout --signal=SIGINT 360 cat <( packages_upgrade )

  disable_supervisord

  if [ "$CLUSTER" != 'cluster' ]; then
    # remove auth flag from mongo if present
    sed -i "s:mongod --auth:mongod:" /etc/noobaa_supervisor.conf
    # add bind_ip flag to restrict access to local host only.
    local has_bindip=$(grep bind_ip /etc/noobaa_supervisor.conf | wc -l)
    if [ $has_bindip == '0' ]; then
      deploy_log "adding --bind_ip to noobaa_supervisor.conf"
      sed -i "s:--dbpath:--bind_ip 127.0.0.1 --dbpath:" /etc/noobaa_supervisor.conf
    fi
  fi

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

  # move existing internal agnets_storage to new dir
  if [ -d /backup/agent_storage/ ]; then
    mv /backup/agent_storage/ ${CORE_DIR}
  fi
  if [ -d /backup/noobaa_storage/ ]; then
    mv /backup/noobaa_storage/ ${CORE_DIR}
  fi

  # Re-setup Repos
  setup_repos

   if [ ! -d  /var/lib/mongo/cluster/shard1 ] || [ ! "$(ls -A /var/lib/mongo/cluster/shard1)" ]; then
        deploy_log "Moving mongo db files into new location"
        mkdir -p /var/lib/mongo/cluster/shard1
        chmod +x /var/lib/mongo/cluster/shard1
        cp -r /data/db/* /var/lib/mongo/cluster/shard1/
        mv /data/db /backup/old_db
    fi

  deploy_log "Running post upgrade"
  ${WRAPPER_FILE_PATH}${WRAPPER_FILE_NAME} post ${FSUFFIX}
  deploy_log "Finished post upgrade"

  mongo_upgrade
  wait_for_mongo

  #Update Mongo Upgrade status
  deploy_log "Updating system.upgrade on success"
  local id=$(${MONGO_SHELL} --eval "db.systems.find({},{'_id':'1'})" | grep _id | sed 's:.*ObjectId("\(.*\)").*:\1:')
  ${MONGO_SHELL} --eval "db.systems.update({'_id':ObjectId('${id}')},{\$set:{'upgrade':{'path':'','status':'UNAVAILABLE','error':''}}});"

  rm -rf ${EXTRACTION_PATH}/*
  deploy_log "Upgrade finished successfully!"
}

function verify_supported_upgrade {
    local current_ver=$(grep version /root/node_modules/noobaa-core/package.json  | cut -f 2 -d':' | cut -f 2 -d'"')
    local second_digit=$(echo ${current_ver} | cut -f 2 -d'.')

    if [ ${second_digit} == "0" or ${second_digit} == "3" ]; then
        deploy_log "Unspported upgrade path from ${current_version}"
        #delibaratly no auth, this is an old version!
        #/usr/bin/mongo nbcore --eval "db.activitylogs.insert({level: 'info', desc: 'Upgrade is not supported from this version, please contact support'})"
        exit 1
    fi
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
    deploy_log "upgrade.sh called for package extraction"
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
      shift
    fi

    CLUSTER="$1"
    if [ "$CLUSTER" == 'cluster' ]; then
      # TODO: handle differenet shard
      set_mongo_cluster_mode
    else
      CLUSTER=""
    fi


    deploy_log "upgrade.sh called with ${allargs}"
    verify_supported_upgrade #verify upgrade from ver > 0.4.5
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
