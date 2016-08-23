#!/bin/bash

TURN_DL="http://turnserver.open-sys.org/downloads/v4.3.1.3/turnserver-4.3.1.3-CentOS6.6-x86_64.tar.gz"
CORE_DIR="/root/node_modules/noobaa-core"
CONFIG_JS="${CORE_DIR}/config.js"
ENV_FILE="${CORE_DIR}/.env"
LOG_FILE="/var/log/noobaa_deploy.log"
SUPERD="/usr/bin/supervisord"
SUPERCTL="/usr/bin/supervisorctl"
NOOBAASEC="/etc/noobaa_sec"

function deploy_log {
	if [ "$1" != "" ]; then
		local now=$(date)
		echo "${now} ${1}" >> ${LOG_FILE}
		echo "${now} ${1}"
	fi
}

#Add noobaa to suduers list
function add_sudoers {
	t=$(eval 'sudo grep -q noobaa /etc/sudoers; echo $? ')
	if [ $t -ne 0 ]; then
		deploy_log "adding noobaa to sudoers"
		sudo echo "noobaa ALL=(ALL)	NOPASSWD:ALL" >> /etc/sudoers
		tt=$(eval 'sudo grep –q noobaa /etc/sudoers; echo $? ')
		if [ $tt -ne 0 ]; then
			deploy_log "failed to add noobaa to sudoers"
		fi
	fi
	useradd noobaa
	echo Passw0rd | passwd noobaa --stdin
}

function build_node {
	deploy_log "build_node start"
	yum -y groupinstall "Development Tools"
	export PATH=$PATH:/usr/local/bin

	#Install Node.js / NPM
	cd /usr/src

	#install nvm use v4.4.4
  curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.30.2/install.sh | bash
	export NVM_DIR="$HOME/.nvm"
	source /root/.nvm/nvm.sh
	nvm install 4.4.4
  nvm alias default 4.4.4
	nvm use 4.4.4
	cd ~
	deploy_log "build_node done"
}

function install_aux {
	deploy_log "install_aux start"
	yum install -y lsof dialog tcpdump iperf nc

	# Install Supervisord
	yum install -y python-setuptools
	easy_install supervisor

	# Install STUN/TURN
  cd /tmp
  curl -sL ${TURN_DL} | tar -xzv
  cd /tmp/turnserver-4.3.1.3
	/tmp/turnserver-4.3.1.3/install.sh
	cd ~
	deploy_log "install_aux done"

	# Install Expect
	yum install -y expect

	# install NTP server
	yum install -y ntp
	# By Default, NTP is disabled, set local TZ to US Pacific
	echo "#NooBaa Configured NTP Server"	 >> /etc/ntp.conf
	echo "#NooBaa Configured Primary DNS Server" >> /etc/resolv.conf
	echo "#NooBaa Configured Secondary DNS Server" >> /etc/resolv.conf
	sed -i 's:\(^server.*\):#\1:g' /etc/ntp.conf
	ln -sf /usr/share/zoneinfo/US/Pacific /etc/localtime

}

#install noobaa repos
function install_repos {
	deploy_log "install_repos start"
	mkdir -p /root/node_modules
	mv /tmp/noobaa-NVA.tar.gz /root/node_modules
	cd /root/node_modules
	tar -xzvf ./noobaa-NVA.tar.gz
	cd ~
	deploy_log "install_repos done"
}

#npm install
function setup_repos {
	deploy_log "setup_repos start"
	cd ~
	# Setup Repos
	cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig ${CORE_DIR}/.env

	deploy_log "setup_repos done"
}

function setup_makensis {
	#Download
	mkdir /nsis
	cd /nsis
	curl -L "http://downloads.sourceforge.net/project/nsis/NSIS%203%20Pre-release/3.0b1/nsis-3.0b1-src.tar.bz2?r=http%3A%2F%2Fsourceforge.net%2Fprojects%2Fnsis%2Ffiles%2FNSIS%25203%2520Pre-release%2F3.0b1%2F&ts=1423381229&use_mirror=garr" > nsis-3.0b1-src.tar.bz2
	curl -L "http://downloads.sourceforge.net/project/nsis/NSIS%203%20Pre-release/3.0b1/nsis-3.0b1.zip?r=http%3A%2F%2Fsourceforge.net%2Fprojects%2Fnsis%2Ffiles%2FNSIS%25203%2520Pre-release%2F3.0b1%2F&ts=1423381286&use_mirror=garr" >> nsis-3.0b1.zip
	unzip nsis-3.0b1.zip
	bzip2 -dk nsis-3.0b1-src.tar.bz2
	tar -xvf nsis-3.0b1-src.tar
	yum -y install zlib-devel
	yum -y install gcc-c++

	#update SConstruct
	sed -i "s:\(.*STRIP_CP.*as symbols', '\)yes')):\1no')):" ./nsis-3.0b1-src/SConstruct

	#build
	cd nsis-3.0b1-src
	scons SKIPSTUBS=all SKIPPLUGINS=all SKIPUTILS=all SKIPMISC=all NSIS_CONFIG_CONST_DATA=no PREFIX=/nsis/nsis-3.0b1 install-compiler
	chmod +x /nsis/nsis-3.0b1/bin/makensis
	ln -s /nsis/nsis-3.0b1/bin/makensis /usr/local/bin/makensis
	mkdir /nsis/nsis-3.0b1/share
	cd /nsis/nsis-3.0b1/share
	ln -s /nsis/nsis-3.0b1 nsis
}

function install_mongo {
	deploy_log "install_mongo start"
	mkdir -p /var/lib/mongo/cluster/shard1
	# create a Mongo 3.2 Repo file
	cp -f ${CORE_DIR}/src/deploy/NVA_build/mongo.repo /etc/yum.repos.d/mongodb-org-3.2.repo

	# install the needed RPM
	yum install -y mongodb-org-3.2.1 mongodb-org-server-3.2.1 mongodb-org-shell-3.2.1 mongodb-org-mongos-3.2.1 mongodb-org-tools-3.2.1

	# pin mongo version in yum, so it won't auto update
	echo "exclude=mongodb-org,mongodb-org-server,mongodb-org-shell,mongodb-org-mongos,mongodb-org-tools" >> /etc/yum.conf
	rm -f /etc/init.d/mongod
	deploy_log "install_mongo done"
}

function general_settings {
	iptables -I INPUT 1 -i eth0 -p tcp --dport 443 -j ACCEPT
	iptables -I INPUT 1 -i eth0 -p tcp --dport 80 -j ACCEPT
	iptables -I INPUT 1 -i eth0 -p tcp --dport 8080 -j ACCEPT
	iptables -I INPUT 1 -i eth0 -p tcp --dport 8081 -j ACCEPT
	iptables -I INPUT 1 -i eth0 -p tcp --dport 8443 -j ACCEPT
	iptables -I INPUT 1 -i eth0 -p tcp --dport 27000 -j ACCEPT
	iptables -I INPUT 1 -i eth0 -p tcp --dport 26050 -j ACCEPT
	#CVE-1999-0524
	iptables -A INPUT -p ICMP --icmp-type timestamp-request -j DROP
	iptables -A INPUT -p ICMP --icmp-type timestamp-reply -j DROP

	service iptables save
	echo "export LC_ALL=C" >> ~/.bashrc
	echo "alias servicesstatus='/usr/bin/supervisorctl status'" >> ~/.bashrc
	echo "alias reloadservices='/usr/bin/supervisorctl reread && /usr/bin/supervisorctl reload'" >> ~/.bashrc
	echo "alias ll='ls -lha'" >> ~/.bashrc
	echo "alias less='less -R'" >> ~/.bashrc
	echo "alias zless='zless -R'" >> ~/.bashrc
	echo "alias nlog='logger -p local0.warn -t NooBaaBash[1]'"
	echo "export GREP_OPTIONS='--color=auto'" >> ~/.bashrc

	#Fix file descriptor limits
	echo "root hard nofile 102400" >> /etc/security/limits.conf
	echo "root soft nofile 102400" >> /etc/security/limits.conf
	sysctl -w fs.file-max=102400
	sysctl -e -p

	#noobaa user & first install wizard
	cp -f ${CORE_DIR}/src/deploy/NVA_build/first_install_diaglog.sh /etc/profile.d/
	chown root:root /etc/profile.d/first_install_diaglog.sh
	chmod 4755 /etc/profile.d/first_install_diaglog.sh

	fix_etc_issue
	fix_security_issues
}


function fix_security_issues {

	local exist=$(grep '#X11Forwarding no' /etc/ssh/sshd_config | wc -l)
	if [ "${exist}" == "0" ]; then
		#CVE-2016-3115
		sed -i -e 's/X11Forwarding yes/#X11Forwarding yes/g' /etc/ssh/sshd_config
		sed -i -e 's/#X11Forwarding no/X11Forwarding no/g' /etc/ssh/sshd_config
		#CVE-2010-5107
		sed -i -e 's/#MaxStartups/MaxStartups/g' /etc/ssh/sshd_config
		sudo /etc/init.d/sshd restart
	fi

	#proxy settings for yum install - for future use
	#http_proxy="http://yum-user:qwerty@mycache.mydomain.com:3128"
	#export http_proxy
	local exist=$(grep timeout /etc/yum.conf | wc -l)
	if [ "${exist}" == "0" ]; then
		echo timeout=20 >> /etc/yum.conf
	fi
	ping 8.8.8.8 -c 3
	if [ $? -ne 0 ]; then
		deploy_log "Missing internet connectivity"
	else
	  /bin/cp -fd /etc/localtime /tmp
		yum clean all
		yum update -y
		if [ $? -ne 0 ]; then
			deploy_log "Failed to update yum packages"
		else
			deploy_log "Updated yum packages"
		fi
	  /bin/cp -fd /tmp/localtime /etc
	fi
}
function setup_supervisors {
	mkdir -p /tmp/supervisor
	deploy_log "setup_supervisors start"
	# Generate default supervisord config
	echo_supervisord_conf > /etc/supervisord.conf
	sed -i 's:logfile=.*:logfile=/tmp/supervisor/supervisord.log:' /etc/supervisord.conf
	sed -i 's:;childlogdir=.*:childlogdir=/tmp/supervisor/:' /etc/supervisord.conf

	# Autostart supervisor
	deploy_log "setup_supervisors autostart"
	cp -f ${CORE_DIR}/src/deploy/NVA_build/supervisord.orig /etc/rc.d/init.d/supervisord
	chmod 777 /etc/rc.d/init.d/supervisord
	chkconfig supervisord on

	# Add NooBaa services configuration to supervisor
	deploy_log "setup_supervisors adding noobaa config to supervisord"
	echo "[include]" >> /etc/supervisord.conf
	echo "files = /etc/noobaa_supervisor.conf" >> /etc/supervisord.conf
	cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_supervisor.conf /etc
	${SUPERD}
	${SUPERCTL} reread
	${SUPERCTL} update
	deploy_log "setup_supervisors done"
}

function setup_users {
	deploy_log "setting up mongo users for admin and nbcore databases"
	/usr/bin/mongo admin ${CORE_DIR}/src/deploy/NVA_build/mongo_setup_users.js
	deploy_log "setup_users done"
}

function install_id_gen {
	deploy_log "install_id_gen start"
	sleep 10 #workaround for mongo starting
	local id=$(uuidgen)
	/usr/bin/mongo nbcore --eval "db.clusters.insert({cluster_id: '${id}'})"
	deploy_log "install_id_gen done"
}

function setup_syslog {
	# copy noobaa_syslog.conf to /etc/rsyslog.d/ which is included by rsyslog.conf
	cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_syslog.conf /etc/rsyslog.d/
	cp -f ${CORE_DIR}/src/deploy/NVA_build/logrotate_noobaa.conf /etc/logrotate.d/noobaa
	service rsyslog restart
	# setup crontab to run logrotate every 15 minutes.
	echo "*/15 * * * * /usr/sbin/logrotate /etc/logrotate.d/noobaa >/dev/null 2>&1" > /var/spool/cron/root
}

function fix_etc_issue {
	local current_ip=$(ifconfig eth0  |grep 'inet addr' | cut -f 2 -d':' | cut -f 1 -d' ')
	local secret
	if [ -f ${NOOBAASEC} ]; then
		secret=$(cat ${NOOBAASEC})
	else
		uuidgen | cut -f 1 -d'-' > ${NOOBAASEC}
		secret=$(cat ${NOOBAASEC})
	fi

	#Fix login message
	echo -e "\x1b[0;35;40m" 																	> /etc/issue
	echo  "  _   _            ______    "   									>> /etc/issue
	echo  " | \\\\ | |           | ___ \\\\   "    								>> /etc/issue
	echo  " |  \\\\| | ___   ___ | |_/ / __ _  __ _    " 				>> /etc/issue
	echo  " | . \` |/ _ \\\\ / _ \\\\| ___ \\\\/ _\` |/ _\` |   " 	>> /etc/issue
	echo  " | |\\\\  | (_) | (_) | |_/ / (_| | (_| |   " 				>> /etc/issue
	echo  " \\\\\_| \\\\_/\\\\___/ \\\\___/\\\\____/ \\\\__,_|\\\\__,_|   "	>> /etc/issue
	echo -e "\x1b[0m" 																				>> /etc/issue

	echo -e "\n\nWelcome to your \x1b[0;35;40mNooBaa\x1b[0m server.\n" >> /etc/issue

  echo -e "\nConfigured IP on this NooBaa Server \x1b[0;32;40m${current_ip}\x1b[0m.\nThis server's secret is \x1b[0;32;40m${secret}\x1b[0m" >> /etc/issue

	echo -e "\nYou can set up a cluster member, configure IP, DNS, GW and Hostname by logging in using \x1b[0;32;40mnoobaa/Passw0rd\x1b[0m" >> /etc/issue
}

if [ "$1" == "runinstall" ]; then
	deploy_log "Running with runinstall"
	acp=$(alias | grep cp | wc -l)
	if [ "${acp}" == "1" ]; then
		unalias cp
	fi
	set -e
	add_sudoers
	build_node
	install_aux
	install_repos
	setup_repos
	install_mongo
	general_settings
	setup_supervisors
	setup_syslog
	install_id_gen
	reboot -fn
fi
