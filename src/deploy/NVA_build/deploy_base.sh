#!/bin/bash

NODE_DL="http://nodejs.org/dist/v0.10.33/node-v0.10.33.tar.gz"
TURN_DL="http://turnserver.open-sys.org/downloads/v4.3.1.3/turnserver-4.3.1.3-CentOS6.6-x86_64.tar.gz"
CORE_DIR="/root/node_modules/noobaa-core"
CONFIG_JS="${CORE_DIR}/config.js"
ENV_FILE="${CORE_DIR}/.env"
LOG_FILE="/var/log/noobaa_deploy.log"
SUPERD="/usr/bin/supervisord"
SUPERCTL="/usr/bin/supervisorctl"

function deploy_log {
	if [ "$1" != "" ]; then
			local now=$(date)
			echo "${now} ${1}" >> ${LOG_FILE}
	fi
}

function build_node {
	deploy_log "build_node start"
	yum -y groupinstall "Development Tools"

	#Install Node.js / NPM
	cd /usr/src
	curl ${NODE_DL} > node-v0.10.33.tar.gz || true
	tar zxf node-v0.10.33.tar.gz
	cd node-v0.10.33
	./configure
	make
	make install
	cd ~
	deploy_log "build_node done"
}

function install_aux {
	deploy_log "install_aux start"
	# Install Debug packages
	yum install -y tcpdump
	yum install -y lsof

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
}

function install_repos {
	deploy_log "install_repos start"
	mkdir -p /root/node_modules
	mv /tmp/noobaa-NVA.tar.gz /root/node_modules
	cd /root/node_modules
	tar -xzvf ./noobaa-NVA.tar.gz
	cd ~
	deploy_log "install_repos done"
}

function setup_repos {
	deploy_log "setup_repos start"
	cd ~
	# Setup Repos
	cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig ${CORE_DIR}/.env
	cd ${CORE_DIR}
	$(npm install -dd >> ${LOG_FILE})

	# Setup config.js with on_premise configuration
	cat ${CONFIG_JS} | sed "s:config.on_premise.enabled = false:config.on_premise.enabled = true:" > ${CONFIG_JS}

	deploy_log "setting up crontab"
	# Setup crontab job for upgrade checks
	# once a day at HH = midnight + RAND[0,2], MM = RAND[0,59]
	local hour_skew=$(((RANDOM)%3))
	local minutes=$(((RANDOM)%60))
	crontab -l 2>/dev/null; echo "${minutes} ${hour_skew} * * * ${CORE_DIR}/src/deploy/NVA_build/upgrade.sh" | crontab -
	deploy_log "setup_repos done"
}

function install_mongo {
	deploy_log "install_mongo start"
	# create a Mongo 2.4 Repo file
	cp -f ${CORE_DIR}/src/deploy/NVA_build/mongo.repo /etc/yum.repos.d/mongodb-org-2.4.repo

	# install the needed RPM
	yum install -y mongo-10gen.x86_64 mongo-10gen-server.x86_64

	# pin mongo version in yum, so it won't auto update
	echo "exclude=mongodb-org,mongodb-org-server,mongodb-org-shell,mongodb-org-mongos,mongodb-org-tools" >> /etc/yum.conf
	deploy_log "install_mongo done"
}

function setup_mongo {
	deploy_log "setup_mongo start"
	mkdir -p /data
	mkdir -p /data/db
	deploy_log "setup_mongo done"
}

function general_settings {
	iptables -I INPUT 1 -i eth0 -p tcp --dport 443 -j ACCEPT
	/sbin/iptables -A INPUT -m limit --limit 15/minute -j LOG --log-level 2 --log-prefix "Dropped by firewall: "
	/sbin/iptables -A OUTPUT -m limit --limit 15/minute -j LOG --log-level 2 --log-prefix "Dropped by firewall: "
	service iptables save
	echo "export LC_ALL=C" >> ~/.bashrc
	echo "alias services_status='/usr/bin/supervisorctl status'" >> ~/.bashrc
	echo "alias ll='ls -lha'" >> ~/.bashrc
	echo "alias less='less -R'" >> ~/.bashrc
	echo "alias zless='zless -R'" >> ~/.bashrc
	echo "export GREP_OPTIONS='--color=auto'" >> ~/.bashrc
}

function setup_supervisors {
	deploy_log "setup_supervisors start"
	# Generate default supervisord config
	echo_supervisord_conf > /etc/supervisord.conf

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

if [ "$1" == "runinstall" ]; then
	deploy_log "Running with runinstall"
	set -e
	build_node
	install_aux
	install_repos
	setup_repos
	install_mongo
	setup_mongo
	general_settings
	setup_supervisors
	reboot -fn
fi
