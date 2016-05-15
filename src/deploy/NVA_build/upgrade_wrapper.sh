#!/bin/bash

EXTRACTION_PATH="/tmp/test/"
. ${EXTRACTION_PATH}/noobaa-core/src/deploy/NVA_build/deploy_base.sh

LOG_FILE="/var/log/noobaa_deploy_wrapper.log"

function deploy_log {
	if [ "$1" != "" ]; then
			local now=$(date)
			echo "${now} ${1}" >> ${LOG_FILE}
	fi
}

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
  fixbashrc=$(grep servicesstatus ~/.bashrc | wc -l)
  if [ ${fixbashrc} -eq 0 ]; then
    deploy_log "Fixing .bashrc"
    #set locale
    echo "export LC_ALL=C" >> ~/.bashrc

    #helper aliases
    echo "alias servicesstatus='/usr/bin/supervisorctl status'" >> ~/.bashrc
		echo "alias reloadservices='/usr/bin/supervisorctl reread && /usr/bin/supervisorctl reload'" >> ~/.bashrc
    echo "alias ll='ls -lha'" >> ~/.bashrc
    echo "alias less='less -R'" >> ~/.bashrc
    echo "alias zless='zless -R'" >> ~/.bashrc
    echo "export GREP_OPTIONS='--color=auto'" >> ~/.bashrc
  fi

  fixfornvm=$(grep NVM_DIR ~/.bashrc | wc -l)
  if [ ${fixfornvm} -eq 0 ]; then
    deploy_log "Adding NVM to .bashrc"
		echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
		echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" # This loads nvm' >> ~/.bashrc
  fi
}

function pre_upgrade {
  yum install -y dialog
  useradd noobaa
  echo Passw0rd | passwd noobaa --stdin

  fix_iptables

  fix_bashrc

  mkdir -p /tmp/supervisor

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

	#install nvm use v4.4.4
	rm -rf ~/.nvm
	mkdir ~/.nvm
	cp ${EXTRACTION_PATH}/noobaa-core/build/public/nvm.sh ~/.nvm/
	chmod 777 ~/.nvm/nvm.sh
	mkdir /tmp/v4.4.4
	cp ${EXTRACTION_PATH}/noobaa-core/build/public/node-v4.4.4-linux-x64.tar.xz /tmp/
	tar -xJf /tmp/node-v4.4.4-linux-x64.tar.xz -C /tmp/v4.4.4 --strip-components 1
	mkdir -p ~/.nvm/versions/node/v4.4.4/
	mv /tmp/v4.4.4/* ~/.nvm/versions/node/v4.4.4/
	export NVM_DIR="$HOME/.nvm"
	. "$NVM_DIR/nvm.sh"
	export PATH=~/.nvm/versions/node/v4.4.4/bin:$PATH
	rm -f /usr/local/bin/node
	ln -s  ~/.nvm/versions/node/v4.4.4/bin/node /usr/local/bin/node
	nvm alias default 4.4.4
	nvm use 4.4.4

}

function post_upgrade {
  #.env changes
  #Bump agent version.
  #TODO: use package version
  local curmd=$(md5sum /root/node_modules/noobaa-core/build/public/noobaa-setup*.exe | cut -f 1 -d' ')
  local prevmd=$(md5sum /backup/build/public/noobaa-setup*.exe | cut -f 1 -d' ')

  deploy_log "Note: installed MD5 was ${prevmd}, new is ${curmd}"

  # copy noobaa_syslog.conf to /etc/rsyslog.d/ which is included by rsyslog.conf
  cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_syslog.conf /etc/rsyslog.d/
  cp -f ${CORE_DIR}/src/deploy/NVA_build/logrotate_noobaa.conf /etc/logrotate.d/noobaa
  service rsyslog restart

  # setup crontab to run logrotate every 15 minutes.
  echo "*/15 * * * * /usr/sbin/logrotate /etc/logrotate.d/noobaa >/dev/null 2>&1" > /var/spool/cron/root

  if [ -f /tmp/agent_conf.json ]; then
    cp -f /tmp/agent_conf.json ${CORE_DIR}/agent_conf.json
  fi

  rm -f ${CORE_DIR}/.env
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
      deploy_log "Note: MDs are the same, not updating agent version"
  fi
  echo "${AGENT_VERSION_VAR}" >> ${CORE_DIR}/.env

	#if noobaa supervisor.conf is pre clustering, fix it
	local FOUND=$(grep endprogram /etc/noobaa_supervisor.conf | wc -l)
	if [ ${FOUND} -eq 0 ]; then
		cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_supervisor.conf /etc/noobaa_supervisor.conf
	fi

	#Fix login message
	fix_etc_issue

  deploy_log "NooBaa supervisor services configuration changes"
  #NooBaa supervisor services configuration changes
  sed -i 's:logfile=.*:logfile=/tmp/supervisor/supervisord.log:' /etc/supervisord.conf
  sed -i 's:;childlogdir=.*:childlogdir=/tmp/supervisor/:' /etc/supervisord.conf
  cp -f ${CORE_DIR}/src/deploy/NVA_build/supervisord.orig /etc/rc.d/init.d/supervisord
  chmod 777 /etc/rc.d/init.d/supervisord
  deploy_log "first install wizard"
  #First Install Wizard
  cp -f ${CORE_DIR}/src/deploy/NVA_build/first_install_diaglog.sh /etc/profile.d/
  chown root:root /etc/profile.d/first_install_diaglog.sh
  chmod 4755 /etc/profile.d/first_install_diaglog.sh

  deploy_log "Installation ID generation if needed"

  #Installation ID generation if needed
  #TODO: Move this into the mongo_upgrade.js
  local id=$(/usr/bin/mongo nbcore --eval "db.clusters.find().shellPrint()" | grep cluster_id | wc -l)
  if [ ${id} -eq 0 ]; then
      id=$(uuidgen)
      /usr/bin/mongo nbcore --eval "db.clusters.insert({cluster_id: '${id}'})"
  fi
	mkdir -p /var/lib/mongo/cluster/shard1

  unset AGENT_VERSION

  #node-gyp install & building
  export PATH=$PATH:/usr/local/bin
  export HOME=/root

  deploy_log "list core dir"
  deploy_log "$(ls -R ${CORE_DIR}/build/)"

  sudo grep noobaa /etc/sudoers
  if [ $? -ne 0 ]; then
      deploy_log "adding noobaa to sudoers"
	  sudo echo "noobaa ALL=(ALL)	NOPASSWD:ALL" >> /etc/sudoers
	  sudo grep noobaa /etc/sudoers
	  if [ $? -ne 0 ]; then
	      deploy_log "failed to add noobaa to sudoers"
   	fi
  fi

  if [ -f "/etc/init.d/mongod" ]
  then
  	  deploy_log "removed mongod service (supervised by supervisord)"
      rm -f /etc/init.d/mongod
  fi

  # temporary - adding NTP package
  yum install -y ntp
  sudo /sbin/chkconfig ntpd on 2345
	sudo /etc/init.d/ntpd start
	local noobaa_ntp=$(grep 'NooBaa Configured NTP Server' /etc/ntp.conf | wc -l)
	if [ ${noobaa_ntp} -eq 0 ]; then #was not configured yet, no tz config as well
			echo "# NooBaa Configured NTP Server"	 >> /etc/ntp.conf
			sed -i 's:\(^server.*\):#\1:g' /etc/ntp.conf
			ln -sf /usr/share/zoneinfo/US/Pacific /etc/localtime
	fi

  rm -f /tmp/*.tar.gz
  rm -rf /tmp/v*

  /etc/rc.d/init.d/supervisord stop
  /etc/rc.d/init.d/supervisord start
}

#Log file name supplied
if [ "$2" != "" ]; then
	LOG_FILE="/var/log/noobaa_deploy_wrapper_${2}.log"
fi

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
