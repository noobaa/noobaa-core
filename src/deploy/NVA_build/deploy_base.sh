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
	yum install -y dialog

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
	local runnpm=0
	if [ "$1" == "runnpm" ]; then
		runnpm=1
	fi

	deploy_log "setup_repos start"
	cd ~
	# Setup Repos
	cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig ${CORE_DIR}/.env
	cd ${CORE_DIR}
	deploy_log "setup_repos before deleted npm install"

	if [ ${runnpm} -eq 1 ]; then
		deploy_log "setup_repos calling npm install"		+	deploy_log "setup_repos after deleted npm install"
		$(npm install sse4_crc32 >> ${LOG_FILE})
		$(npm install -dd >> ${LOG_FILE})

	fi

	#deploy_log "setting up crontab"
	# Setup crontab job for upgrade checks
	# once a day at HH = midnight + RAND[0,2], MM = RAND[0,59]
	#local hour_skew=$(((RANDOM)%3))
	#local minutes=$(((RANDOM)%60))
	#crontab -l 2>/dev/null; echo "${minutes} ${hour_skew} * * * ${CORE_DIR}/src/deploy/NVA_build/upgrade.sh" | crontab -
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
	iptables -I INPUT 1 -i eth0 -p tcp --dport 80 -j ACCEPT
	iptables -I INPUT 1 -i eth0 -p tcp --dport 8080 -j ACCEPT
	iptables -I INPUT 1 -i eth0 -p tcp --dport 8443 -j ACCEPT

	service iptables save
	echo "export LC_ALL=C" >> ~/.bashrc
	echo "alias services_status='/usr/bin/supervisorctl status'" >> ~/.bashrc
	echo "alias ll='ls -lha'" >> ~/.bashrc
	echo "alias less='less -R'" >> ~/.bashrc
	echo "alias zless='zless -R'" >> ~/.bashrc
	echo "export GREP_OPTIONS='--color=auto'" >> ~/.bashrc

	#Fix file descriptor limits
	echo "root hard nofile 102400" >> /etc/security/limits.conf
	echo "root soft nofile 102400" >> /etc/security/limits.conf
	sysctl -w fs.file-max=102400
	sysctl -e -p

	#noobaa user & first install wizard
	useradd noobaa
	echo Passw0rd | passwd noobaa --stdin
	cp -f ${CORE_DIR}/src/deploy/NVA_build/first_install_diaglog.sh /etc/profile.d/
	chown root:root /etc/profile.d/first_install_diaglog.sh
	chmod 4755 /etc/profile.d/first_install_diaglog.sh

	#Fix login message
	echo "Welcome to your NooBaa, host \n" > /etc/issue
	echo "You can use noobaa/Passw0rd login to configure IP & DNS" >>/etc/issue
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

function post_deploy {
	deploy_log "post_deploy start"
	sleep 10 #workaround for mongo starting
	local id=$(uuidgen)
	/usr/bin/mongo nbcore --eval "db.clusters.insert({cluster_id: '${id}'})"
	deploy_log "post_deploy done"
}

if [ "$1" == "runinstall" ]; then
	deploy_log "Running with runinstall"
	set -e
	build_node
	install_aux
	install_repos
	setup_repos runnpm
#	setup_makensis
	install_mongo
	setup_mongo
	general_settings
	setup_supervisors
	post_deploy
	reboot -fn
fi
