#!/bin/bash

EXTRACTION_PATH="/tmp/test/"
. ${EXTRACTION_PATH}/noobaa-core/src/deploy/NVA_build/deploy_base.sh

function fix_iptables {
  deploy_log "fixing IPtables"
  #fix iptables
  local exist=$(iptables -L -n | grep 80 | wc -l)
  if [ "${exist}" == "0" ]; then
    iptables -I INPUT 1 -i eth0 -p tcp --dport 80 -j ACCEPT
  fi

  local exist=$(iptables -L -n | grep 443 | wc -l)
  if [ "${exist}" == "0" ]; then
    iptables -I INPUT 1 -i eth0 -p tcp --dport 443 -j ACCEPT
  fi

  local exist=$(iptables -L -n | grep 8080 | wc -l)
  if [ "${exist}" == "0" ]; then
    iptables -I INPUT 1 -i eth0 -p tcp --dport 8080 -j ACCEPT
  fi

  local exist=$(iptables -L -n | grep 8443 | wc -l)
  if [ "${exist}" == "0" ]; then
    iptables -I INPUT 1 -i eth0 -p tcp --dport 8443 -j ACCEPT
  fi

  #If logging rules exist, remove them
  /sbin/iptables -D INPUT -m limit --limit 15/minute -j LOG --log-level 2 --log-prefix "Dropped by firewall: "
  /sbin/iptables -D OUTPUT -m limit --limit 15/minute -j LOG --log-level 2 --log-prefix "Dropped by firewall: "

  service iptables save
}

function fix_bashrc {
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
}

function pre_upgrade {
  yum install -y dialog
  useradd noobaa
  echo Passw0rd | passwd noobaa --stdin

  fix_iptables

  fix_bashrc

  if grep -Fxq "root hard nofile" /etc/security/limits.conf
  then
    deploy_log "hard limit already exists"
  else
    deploy_log "fixing hard limit"
    echo "root hard nofile 102400" >> /etc/security/limits.conf
  fi

  if grep -Fxq "root soft nofile" /etc/security/limits.conf
  then
    deploy_log "fixing soft limit"
    deploy_log "soft limit already exists"
  else
    echo "root soft nofile 102400" >> /etc/security/limits.conf
  fi

  sysctl -w fs.file-max=102400
  sysctl -e -p
  agent_conf=${CORE_DIR}/agent_conf.json
  if [ -f "$agent_conf" ]
    then
        deploy_log "$agent_conf found. Save to /tmp and restore"
        rm -f /tmp/agent_conf.json
        cp ${agent_conf} /tmp/agent_conf.json
    else
        deploy_log "$agent_conf not found."
    fi
}

function post_upgrade {
  #.env changes
  #bump agent version.
  #TODO: do it only if md5 of the executable is different
  local curmd=$(md5sum /root/node_modules/noobaa-core/build/public/noobaa-setup.exe | cut -f 1 -d' ')
  local prevmd=$(md5sum /backup/build/public/noobaa-setup.exe | cut -f 1 -d' ')

  deploy_log "Installed MD5 was ${prevmd}, new is ${curmd}"

  cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_supervisor.conf /etc/noobaa_supervisor.conf
  if [ -f /tmp/agent_conf.json ]; then
    cp -f /tmp/agent_conf.json ${CORE_DIR}/agent_conf.json
  fi

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
  else
      deploy_log "MDs are the same, not updating agent version"
  fi
  echo "${AGENT_VERSION_VAR}" >> ${CORE_DIR}/.env

  echo "Welcome to your NooBaa, host \n" > /etc/issue
  echo "You can use noobaa/Passw0rd login to configure IP & DNS" >>/etc/issue

  #NooBaa supervisor services configuration changes
  cp -f ${CORE_DIR}/src/deploy/NVA_build/supervisord.orig /etc/rc.d/init.d/supervisord
  chmod 777 /etc/rc.d/init.d/supervisord

  cp -f ${CORE_DIR}/src/deploy/NVA_build/first_install_diaglog.sh /etc/profile.d/

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
