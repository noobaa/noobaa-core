#!/bin/bash

EXTRACTION_PATH="/tmp/test/"
. ${EXTRACTION_PATH}/noobaa-core/src/deploy/NVA_build/deploy_base.sh
. ${EXTRACTION_PATH}/noobaa-core/src/deploy/NVA_build/common_funcs.sh

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

  local exist=$(iptables -L -n | grep 8444 | wc -l)
  if [ "${exist}" == "0" ]; then
	iptables -I INPUT 1 -i eth0 -p tcp --dport 8444 -j ACCEPT
  fi

  local exist=$(iptables -L -n | grep 26050 | wc -l)
  if [ "${exist}" == "0" ]; then
    iptables -I INPUT 1 -i eth0 -p tcp --dport 26050 -j ACCEPT
  fi

  local exist=$(iptables -L -n | grep 27000 | wc -l)
  if [ "${exist}" == "0" ]; then
    iptables -I INPUT 1 -i eth0 -p tcp --dport 27000 -j ACCEPT
  fi

  local exist=$(iptables -L -n | grep 60100 | wc -l)
  if [ "${exist}" == "0" ]; then
    iptables -I INPUT 1 -i eth0 -p tcp --dport 60100 -j ACCEPT
  fi

  #If logging rules exist, remove them
  /sbin/iptables -D INPUT -m limit --limit 15/minute -j LOG --log-level 2 --log-prefix "Dropped by firewall: "
  /sbin/iptables -D OUTPUT -m limit --limit 15/minute -j LOG --log-level 2 --log-prefix "Dropped by firewall: "

  #CVE-1999-0524
  local exist=$(iptables -L -n | grep icmp | wc -l)
  if [ "${exist}" == "0" ]; then
 	iptables -A INPUT -p ICMP --icmp-type timestamp-request -j DROP
	iptables -A INPUT -p ICMP --icmp-type timestamp-reply -j DROP
  fi
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


function upgrade_mongo_version {
	local ver=$(mongo --version | grep 3.2 | wc -l)
	if [ ${ver} -ne 0 ]; then
		return
	fi

  disable_autostart

 	${SUPERD}
  sleep 3

	deploy_log "RE-Enable mongo upgrades"
	#RE-Enable mongo upgrades
	sed -i 's:exclude=mongodb-org.*::' /etc/yum.conf

	#Upgrade to 3.0
	deploy_log "Upgrade MongoDB to 3.0"
	mv /etc/yum.repos.d/mongodb-org-2.4.repo /etc/yum.repos.d/mongodb-org-3.0.repo
	sed -i 's:\(\[mongodb-org\)-.*\]:\1-3.0]:' /etc/yum.repos.d/mongodb-org-3.0.repo
	sed -i 's:baseurl=.*:baseurl=http\://repo.mongodb.org/yum/redhat/6Server/mongodb-org/3.0/x86_64/:' /etc/yum.repos.d/mongodb-org-3.0.repo
	yum -y install mongodb-org
	deploy_log "Start MongoDB 3.0"


	${SUPERCTL} start mongodb
  wait_for_mongo


	#Export current mongo DB

	deploy_log "Taking MongoDB backup"
	mongodump --out /tmp/mongo_3.2_upgrade

  deploy_log "stopping mongo"
	${SUPERCTL} stop mongodb

  # move mongo folder to /var/lib/mongo/cluster/shard1_old"
	mv /var/lib/mongo/cluster/shard1 /var/lib/mongo/cluster/shard1_old
	mkdir -p /var/lib/mongo/cluster/shard1

	#Upgrade to 3.2
	deploy_log "Upgrade MongoDB to 3.2"
	cp -f ${CORE_DIR}/src/deploy/NVA_build/mongo.repo /etc/yum.repos.d/mongodb-org-3.2.repo
	yum -y install mongodb-org
	rm -f /etc/yum.repos.d/mongodb-org-3.0.repo

  deploy_log "starting mongo"
	${SUPERCTL} start mongodb
	deploy_log "Importing Previous DB"

  wait_for_mongo

  #mongorestore from /tmp/mongo_3.2_upgrade"
	mongorestore /tmp/mongo_3.2_upgrade

  deploy_log "stopping mongo"
	${SUPERCTL} stop mongodb

	#disable mongo upgrades
	echo "exclude=mongodb-org,mongodb-org-server,mongodb-org-shell,mongodb-org-mongos,mongodb-org-tools" >> /etc/yum.conf

  enable_autostart
  ${SUPERCTL} shutdown

}

function pre_upgrade {
	if getent passwd noobaa > /dev/null 2>&1; then
		echo "noobaa user exists"
	else
		useradd noobaa
		echo Passw0rd | passwd noobaa --stdin
	fi

	if getent passwd noobaaroot > /dev/null 2>&1; then
		echo "noobaaroot user exists"
	else
    #add noobaaroot user
    t=$(eval 'grep -q noobaaroot /etc/sudoers; echo $? ')
    if [ $t -ne 0 ]; then
      deploy_log "adding noobaaroot to sudoers"
      echo "noobaaroot ALL=(ALL)	NOPASSWD:ALL" >> /etc/sudoers
      tt=$(eval 'grep -q noobaaroot /etc/sudoers; echo $? ')
      if [ $tt -ne 0 ]; then
        deploy_log "failed to add noobaaroot to sudoers"
      fi
    fi

    # add noobaaroot with temp password - will be changed in fix_etc_issue
	useradd noobaaroot
	echo Passw0rd | passwd noobaaroot --stdin
	fi

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

  # CVE-2016-5696
  if ! grep -q 'net.ipv4.tcp_challenge_ack_limit = 999999999' /etc/sysctl.conf; then
    echo "net.ipv4.tcp_challenge_ack_limit = 999999999" >> etc/sysctl.conf
  fi

  echo "64000" > /proc/sys/kernel/threads-max
  sysctl -w fs.file-max=102400
  sysctl -w net.ipv4.tcp_keepalive_time=120
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

	# copy fix_server_sec to
    if ! grep -q 'fix_server_sec' /etc/rc.local; then
        echo "bash /root/node_modules/noobaa-core/src/deploy/NVA_build/fix_server_sec.sh" >> /etc/rc.local
    fi

	#install nvm use v6.9.1
	rm -rf ~/.nvm
	mkdir ~/.nvm
	cp ${EXTRACTION_PATH}/noobaa-core/build/public/nvm.sh ~/.nvm/
	chmod 777 ~/.nvm/nvm.sh
	mkdir /tmp/v6.9.1
	cp ${EXTRACTION_PATH}/noobaa-core/build/public/node-v6.9.1-linux-x64.tar.xz /tmp/
	tar -xJf /tmp/node-v6.9.1-linux-x64.tar.xz -C /tmp/v6.9.1 --strip-components 1
	mkdir -p ~/.nvm/versions/node/v6.9.1/
	mv /tmp/v6.9.1/* ~/.nvm/versions/node/v6.9.1/
	export NVM_DIR="$HOME/.nvm"
	. "$NVM_DIR/nvm.sh"
	export PATH=~/.nvm/versions/node/v6.9.1/bin:$PATH
	rm -f /usr/local/bin/node
	ln -s  ~/.nvm/versions/node/v6.9.1/bin/node /usr/local/bin/node
	nvm alias default 6.9.1
	nvm use 6.9.1
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

  # setup crontab to run logrotate every 15 minutes.
  echo "*/15 * * * * /usr/sbin/logrotate /etc/logrotate.d/noobaa >/dev/null 2>&1" > /var/spool/cron/root

  if [ -f /tmp/agent_conf.json ]; then
    cp -f /tmp/agent_conf.json ${CORE_DIR}/agent_conf.json
  fi

  # same as setup_repos in upgrade.sh. do we really need to perform it again?
  rm -f ${CORE_DIR}/.env
  cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig ${CORE_DIR}/.env
  #fix JWT_SECRET from previous .env
  if grep -q JWT_SECRET /backup/.env; then
      local jwt=$(grep JWT_SECRET /backup/.env)
      echo "${jwt}" >> ${CORE_DIR}/.env
  fi

  #copy MONGO_RS_URL from previous .env
  if grep -q MONGO_RS_URL /backup/.env; then
      local mongo_url=$(grep MONGO_RS_URL /backup/.env)
      echo "${mongo_url}" >> ${CORE_DIR}/.env
  fi

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

  #if noobaa supervisor.conf is pre hosted_agents
  local FOUND=$(grep "bg_workers_starter" /etc/noobaa_supervisor.conf | wc -l)
  if [ ${FOUND} -eq 1 ]; then
    cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_supervisor.conf /etc/noobaa_supervisor.conf
  fi

  #fix and upgrade security
  fix_security_issues

  deploy_log "NooBaa supervisor services configuration changes"
  #NooBaa supervisor services configuration changes
  sed -i 's:logfile=.*:logfile=/tmp/supervisor/supervisord.log:' /etc/supervisord.conf
  sed -i 's:;childlogdir=.*:childlogdir=/tmp/supervisor/:' /etc/supervisord.conf
  sed -i 's:src/bg_workers/bg_workers_starter.js:src/server/bg_workers.js:' /etc/supervisord.conf
  cp -f ${CORE_DIR}/src/deploy/NVA_build/supervisord.orig /etc/rc.d/init.d/supervisord
  chmod 777 /etc/rc.d/init.d/supervisord
  deploy_log "first install wizard"
  #First Install Wizard
  cp -f ${CORE_DIR}/src/deploy/NVA_build/first_install_diaglog.sh /etc/profile.d/
  chown root:root /etc/profile.d/first_install_diaglog.sh
  chmod 4755 /etc/profile.d/first_install_diaglog.sh

  # seems unnecessary - cluster_id is added in mongo_upgrade
  # deploy_log "Installation ID generation if needed"
  # #Installation ID generation if needed
  # #TODO: Move this into the mongo_upgrade.js
  # local id=$(/usr/bin/mongo admin -u nbadmin -p roonoobaa --eval "db.getSiblingDB('nbcore').clusters.find().shellPrint()" | grep cluster_id | wc -l)
  # if [ ${id} -eq 0 ]; then
  #     id=$(uuidgen)
  #     /usr/bin/mongo admin -u nbadmin -p roonoobaa --eval "db.getSiblingDB('nbcore').clusters.insert({cluster_id: '${id}'})"
  # fi

  unset AGENT_VERSION

  #node-gyp install & building
  export PATH=$PATH:/usr/local/bin
  export HOME=/root

  deploy_log "list core dir"
  deploy_log "$(ls -R ${CORE_DIR}/build/)"

  grep noobaa /etc/sudoers
  if [ $? -ne 0 ]; then
      deploy_log "adding noobaa to sudoers"
	    echo "noobaa ALL=(ALL)	NOPASSWD:ALL" >> /etc/sudoers
	    grep noobaa /etc/sudoers
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
	if yum list installed ntp >/dev/null 2>&1; then
		deploy_log "ntp installed"
	else
		deploy_log "installing ntp"
		yum install -y ntp
		/sbin/chkconfig ntpd on 2345
		/etc/init.d/ntpd start
		sed -i 's:\(^server.*\):#\1:g' /etc/ntp.conf
		ln -sf /usr/share/zoneinfo/US/Pacific /etc/localtime

	fi

	local noobaa_ntp=$(grep 'NooBaa Configured NTP Server' /etc/ntp.conf | wc -l)
	if [ ${noobaa_ntp} -eq 0 ]; then #was not configured yet, no tz config as well
		echo "# NooBaa Configured NTP Server"	 >> /etc/ntp.conf
	fi

	local noobaa_dns=$(grep 'NooBaa Configured Primary DNS Server' /etc/resolv.conf | wc -l)
	if [ ${noobaa_dns} -eq 0 ]; then #was not configured yet
			echo "#NooBaa Configured Primary DNS Server" >> /etc/resolv.conf
			echo "#NooBaa Configured Secondary DNS Server" >> /etc/resolv.conf
	fi

	#Upgrade mongo to 3.2 if needed
	upgrade_mongo_version

  rm -f /tmp/*.tar.gz
  rm -rf /tmp/v*

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
