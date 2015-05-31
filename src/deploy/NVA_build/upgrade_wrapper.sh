#!/bin/bash

EXTRACTION_PATH="/tmp/test/"
. ${EXTRACTION_PATH}/noobaa-core/src/deploy/NVA_build/deploy_base.sh

function pre_upgrade {
  #yum install -y lsof

  deploy_log "fixing IPtables"
  #fix iptables
  #TODO: CHECK if rules already exist, is so skip this part
  iptables -I INPUT 1 -i eth0 -p tcp --dport 80 -j ACCEPT
  iptables -I INPUT 1 -i eth0 -p tcp --dport 443 -j ACCEPT
  #/sbin/iptables -A INPUT -m limit --limit 15/minute -j LOG --log-level 2 --log-prefix "Dropped by firewall: "
  #/sbin/iptables -A OUTPUT -m limit --limit 15/minute -j LOG --log-level 2 --log-prefix "Dropped by firewall: "
  service iptables save

  fixbashrc=$(grep services_status ~/.bashrc | wc -l)
  if [ ${fixbashrc} -eq 0 ]; then
    deploy_log "Fixing .bashrc"
    #set locale
    echo "export LC_ALL=C" >> ~/.bashrc

    #helper aliases
    echo "alias services_status='/usr/bin/supervisorctl status'" >> ~/.bashrc
    echo "alias ll='ls -lha'" >> ~/.bashrc
    echo "alias less='less -R'" >> ~/.bashrc
    echo "alias zless='zless -R'" >> ~/.bashrc
    echo "export GREP_OPTIONS='--color=auto'" >> ~/.bashrc
  fi

  if grep -Fxq "* hard nofile" /etc/security/limits.conf
  then
    deploy_log "hard limit already exists"
  else
    deploy_log "fixing hard limit"
    echo "* hard nofile 102400" >> /etc/security/limits.conf
  fi

  if grep -Fxq "* soft nofile" /etc/security/limits.conf
  then
    deploy_log "fixing soft limit"
    deploy_log "soft limit already exists"
  else
    echo "* soft nofile 102400" >> /etc/security/limits.conf
  fi

  sysctl -w fs.file-max=102400
  sysctl -p
}

function post_upgrade {
  #.env changes
  #bump agent version.
  #TODO: do it only if md5 of the executable is different
  local curmd=$(md5sum /tmp/noobaa-NVA.tar.gz  | cut -f 1 -d' ')
  local prevmd=$(grep "#packmd" /backup/.env | cut -f 2 -d' ')

  cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig ${CORE_DIR}/.env

  local AGENT_VERSION_VAR=$(grep AGENT_VERSION /backup/.env)
  if [ "${curmd}" != "${prevmd}" ]; then
    deploy_log "Previous md differs from current, bumping agent version"
    if [ "${AGENT_VERSION_VAR}" != "" ]; then
      AGENT_VERSION_NUMBER=${AGENT_VERSION_VAR:14}
      AGENT_VERSION_NUMBER=$((AGENT_VERSION_NUMBER+1))
      AGENT_VERSION_VAR="AGENT_VERSION=${AGENT_VERSION_NUMBER}"
    else
      AGENT_VERSION_VAR='AGENT_VERSION=1'
    fi
  fi
  echo "${AGENT_VERSION_VAR}" >> ${CORE_DIR}/.env

  #NooBaa supervisor services configuration changes
  cp -f ${CORE_DIR}/src/deploy/NVA_build/supervisord.orig /etc/rc.d/init.d/supervisord
  chmod 777 /etc/rc.d/init.d/supervisord

  #save MD5 of current package
  echo "#packmd ${curmd}" >> ${CORE_DIR}/.env
  rm -f /tmp/*.tar.gz
}


case $1 in
  pre)
    pre_upgrade
    ;;
  post)
    post_upgrade
    ;;
  *)
    exit 1
    ;;
esac
