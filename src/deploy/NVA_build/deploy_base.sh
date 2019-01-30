#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'

CORE_DIR="/root/node_modules/noobaa-core"
LOG_FILE="/log/noobaa_deploy.log"
SUPERD="/usr/bin/supervisord"
SUPERCTL="/usr/bin/supervisorctl"
NOOBAA_ROOTPWD="/etc/nbpwd"

mkdir -p /log
mkdir -p /data/

function deploy_log {
    local now=$(date)
    echo "${now} $*" >> ${LOG_FILE}
    echo "${now} $*"
    logger -t UPGRADE -p local0.warn "$*"
}

function verify_noobaa_pre_requirements() {
    if [ ! -f /tmp/noobaa-NVA.tar.gz ]
    then
        echo "There is no noobaa-NVA.tar.gz under /tmp/"
        exit 1
    fi
}

function clean_ifcfg() {
    local interfaces=$(ip addr | grep "state UP\|state DOWN" | awk '{print $2}' | sed 's/:/ /g')
    for interface in ${interfaces//:/}; do
        sudo rm -f /etc/sysconfig/network-scripts/ifcfg-${interface}
    done
    sudo echo -n > /etc/sysconfig/network
    if [ "${container}" != "docker" ]; then
        interfaces=$(ifconfig | grep ^eth | awk '{print $1}')
        for int in ${interfaces//:/}; do
            sudo rm -f /etc/sysconfig/network-scripts/ifcfg-${int}
        done
        sudo echo "HOSTNAME=noobaa" > /etc/sysconfig/network
        sudo echo "DNS1=127.0.0.1" >> /etc/sysconfig/network
    fi
}

function install_platform {
    deploy_log install_platform start
   
    # make iptables run on boot instead of firewalld
    if [ "${container}" != "docker" ]; then
        systemctl disable firewalld
        systemctl disable NetworkManager
        systemctl enable iptables
    fi 

    # make network service run on boot
    systemctl enable network
    # enable random number generator daemon
    # see https://www.certdepot.net/rhel7-get-started-random-number-generator/
    systemctl enable rngd

	# make crontab start on boot
	chkconfig crond on


    if [ "${container}" != "docker" ]; then
        #start services
        systemctl start rngd
	    systemctl start crond

        # disable grub menu selection
        sed -i 's:GRUB_HIDDEN_TIMEOUT_QUIET.*::' /etc/default/grub
        sed -i 's:GRUB_HIDDEN_TIMEOUT.*::' /etc/default/grub
        sed -i 's:GRUB_FORCE_HIDDEN_MENU.*::' /etc/default/grub
        echo "GRUB_HIDDEN_TIMEOUT_QUIET=true" >> /etc/default/grub
        echo "GRUB_HIDDEN_TIMEOUT=0" >> /etc/default/grub
        echo "GRUB_FORCE_HIDDEN_MENU=true" >> /etc/default/grub
        grub2-mkconfig --output=/boot/grub2/grub.cfg
        #making sure that we have GRUB_TIMEOUT in the /etc/default/grub
        set +e
        grep GRUB_TIMEOUT /etc/default/grub &> /dev/null
        if [ $? -eq 0 ]
        then
                sed -i 's/GRUB_TIMEOUT=5/GRUB_TIMEOUT=0' /etc/default/grub
        else
                echo GRUB_TIMEOUT=0 >> /etc/default/grub
        fi
        set -e
        grub2-mkconfig –o /boot/grub2/grub.cfg
    fi

	# easy_install is for Supervisord and comes from python-setuptools
	easy_install supervisor

    # By Default, NTP is disabled, set local TZ to US Pacific
    echo "#NooBaa Configured NTP Server"     >> /etc/ntp.conf
    echo "#NooBaa Configured Proxy Server"     >> /etc/yum.conf
    sed -i 's:\(^server.*\):#\1:g' /etc/ntp.conf
    ln -sf /usr/share/zoneinfo/GMT /etc/localtime

	deploy_log install_platform done
}

function setup_linux_users {
    if [ "${container}" != "docker" ]; then
        deploy_log setup_linux_users start

        if ((`id -u`)); then
            deploy_log "Must run with root"
            exit 1
        fi
        if ! grep -q root /etc/sudoers; then
            deploy_log "adding root to sudoers"
            echo "root ALL=(ALL) ALL" >> /etc/sudoers
        fi

        # create noobaa user
        if ! id -u noobaa; then
            deploy_log "adding user noobaa"
            useradd noobaa
            echo Passw0rd | passwd noobaa --stdin
        fi
        if ! grep -q noobaa /etc/sudoers; then
            deploy_log "adding user noobaa to sudoers"
            echo "noobaa ALL=(ALL)    NOPASSWD:ALL" >> /etc/sudoers
            if ! grep -q noobaa /etc/sudoers; then
                deploy_log "failed to add noobaa to sudoers"
                exit 1
            fi
        fi 

        # create noobaaroot user
        if ! id -u noobaaroot; then
            deploy_log "adding user noobaaroot"
            useradd noobaaroot
            echo Passw0rd | passwd noobaaroot --stdin
        fi
        if ! grep -q noobaaroot /etc/sudoers; then
            deploy_log "adding user noobaaroot to sudoers"
            echo "noobaaroot ALL=(ALL)    NOPASSWD:ALL" >> /etc/sudoers
            if ! grep -q noobaaroot /etc/sudoers; then
                deploy_log "failed to add noobaaroot to sudoers"
                exit 1
            fi
        fi

        #Fix login message
        echo -e "\x1b[0;35;40m" > /etc/issue
        echo  '  _   _            ______              ' >> /etc/issue
        echo  ' | \\ | |           | ___ \\             ' >> /etc/issue
        echo  ' |  \\| | ___   ___ | |_/ / __ _  __ _  ' >> /etc/issue
        echo  ' | . ` |/ _ \\ / _ \\| ___ \\/ _` |/ _` | ' >> /etc/issue
        echo  ' | |\\  | (_) | (_) | |_/ / (_| | (_| | ' >> /etc/issue
        echo  ' \\_| \\_/\\___/ \\___/\\____/ \\__,_|\\__,_| ' >> /etc/issue
        echo -e "\x1b[0m" >> /etc/issue

        echo -e "\n\nWelcome to your \x1b[0;35;40mNooBaa\x1b[0m server.\n" >> /etc/issue

        echo -e "\nConfigured IP on this NooBaa Server \x1b[0;32;40mNONE\x1b[0m." >> /etc/issue

        echo -e "\nNo Server Secret" >> /etc/issue

        echo -e "\nYou can set up a cluster member, configure IP, DNS, GW and Hostname by logging in using \x1b[0;32;40mnoobaa/Passw0rd\x1b[0m" >> /etc/issue
        deploy_log "setup_linux_users done"
    fi
    #chmoding the rc.local to be executable
    chmod 755 /etc/rc.local
}

function install_nodejs {
    deploy_log "install_nodejs start"
: '    
    . /opt/rh/rh-nodejs10/enable
    echo ". /opt/rh/rh-nodejs10/enable" >> ~/.bashrc

    verify_node_ver=$(node -v)
    expected_node_ver=$(cat ${CORE_DIR}/.nvmrc)
    if [ ${verify_node_ver//[A-Za-z]/} != ${expected_node_ver} ]
    then
        echo -e "\e[31mnode ver is ${verify_node_ver}, expected ${expected_node_ver}, Exiting.\e[0m"
        exit 1
    fi
    deploy_log "install_nodejs done"
'

: '
    yum -y groupinstall "Development Tools"
'
    export PATH=$PATH:/usr/local/bin

    #Install Node.js / NPM
    cd /usr/src
	curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.6/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    source /root/.nvm/nvm.sh
  
    NODE_VER=$(cat ${CORE_DIR}/.nvmrc)
    nvm install ${NODE_VER}
    nvm alias default $(nvm current)

    cd ~

    ln -sf $(which node) /usr/local/bin/node

}

function install_noobaa_repos {
    deploy_log "install_noobaa_repos start"

    mkdir -p /root/node_modules
    mv /tmp/noobaa-NVA.tar.gz /root/node_modules
    cd /root/node_modules
    tar -xzf ./noobaa-NVA.tar.gz
    cd ~

	# Setup Repos
    if [ "${container}" == "docker" ]; then
        sed -i -e "\$aPLATFORM=docker" ${CORE_DIR}/src/deploy/NVA_build/env.orig
    fi
	cp -f ${CORE_DIR}/src/deploy/NVA_build/env.orig /data/.env

    deploy_log "install_noobaa_repos done"
}

function install_mongo {
    deploy_log "install_mongo start"

    # mongodb will probably run as root after yum (if not docker) - we need to fix it if we want to use deploy_base
    chown -R mongod:mongod /data/mongo/

    # pin mongo version in yum, so it won't auto update
    echo "exclude=mongodb-org,mongodb-org-server,mongodb-org-shell,mongodb-org-mongos,mongodb-org-tools" >> /etc/yum.conf
    rm -f /etc/init.d/mongod
    systemctl disable mongod

    if [ "${container}" != "docker" ]; then
        systemctl stop mongod
        deploy_log "adding mongo ssl user"
        add_mongo_ssl_user
    fi

    deploy_log "install_mongo done"
}

function general_settings {
	deploy_log "general_settings start"

    if [ "${container}" != "docker" ]; then
        #Open n2n ports
        iptables -I INPUT 1 -p tcp --match multiport --dports 60100:60600 -j ACCEPT 
        
        iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
        iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
        iptables -I INPUT 1 -p tcp --dport 8080 -j ACCEPT
        iptables -I INPUT 1 -p tcp --dport 8443 -j ACCEPT
        iptables -I INPUT 1 -p tcp --dport 8444 -j ACCEPT
        iptables -I INPUT 1 -p tcp --dport 27000 -j ACCEPT
        iptables -I INPUT 1 -p tcp --dport 26050 -j ACCEPT

        #CVE-1999-0524
        iptables -A INPUT -p ICMP --icmp-type timestamp-request -j DROP
        iptables -A INPUT -p ICMP --icmp-type timestamp-reply -j DROP
        service iptables save
    fi


    echo "export LC_ALL=C" >> ~/.bashrc
    echo "export TERM=xterm" >> ~/.bashrc
    echo "export PATH=$PATH:/usr/local/bin:/data/bin" >> ~/.bashrc
    echo "alias servicesstatus='/usr/bin/supervisorctl status'" >> ~/.bashrc
    echo "alias reloadservices='/usr/bin/supervisorctl reread && /usr/bin/supervisorctl reload'" >> ~/.bashrc
    echo "alias ll='ls -lha'" >> ~/.bashrc
    echo "alias less='less -R'" >> ~/.bashrc
    echo "alias zless='zless -R'" >> ~/.bashrc
    echo "alias nlog='logger -p local0.warn -t NooBaaBash[1]'"
    echo "export GREP_OPTIONS='--color=auto'" >> ~/.bashrc
    echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
    echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" # This loads nvm' >> ~/.bashrc

    #Fix file descriptor limits, tcp timeout
    echo "root hard nofile 102400" >> /etc/security/limits.conf
    echo "root soft nofile 102400" >> /etc/security/limits.conf
    if [ "${container}" != "docker" ]; then
        echo "64000" > /proc/sys/kernel/threads-max
        sysctl -w fs.file-max=102400
        sysctl -w net.ipv4.tcp_keepalive_time=120
        sysctl -e -p

        # noobaa user & first install wizard
        cp -f ${CORE_DIR}/src/deploy/NVA_build/first_install_dialog.sh /etc/profile.d/
        chown root:root /etc/profile.d/first_install_dialog.sh
        chmod 4755 /etc/profile.d/first_install_dialog.sh
    fi

    fix_security_issues

	deploy_log "general_settings done"
}


function fix_security_issues {

    local exist=$(grep '#X11Forwarding no' /etc/ssh/sshd_config | wc -l)
    if [ "${exist}" == "0" ]; then
        #CVE-2016-3115
        sed -i -e 's/X11Forwarding yes/#X11Forwarding yes/g' /etc/ssh/sshd_config
        sed -i -e 's/#X11Forwarding no/X11Forwarding no/g' /etc/ssh/sshd_config
        #CVE-2010-5107
        sed -i -e 's/#MaxStartups/MaxStartups/g' /etc/ssh/sshd_config
        if [ "${container}" != "docker" ]; then
            /bin/systemctl restart sshd.service
        fi
     fi

    #export http_proxy
    local exist=$(grep timeout /etc/yum.conf | wc -l)
    if [ "${exist}" == "0" ]; then
        echo timeout=20 >> /etc/yum.conf
    fi

	# set random root password
	if [ -f ${NOOBAA_ROOTPWD} ]; then
		# workaround for test servers - specify password in /etc/nbpwd file
		rootpwd=$(cat ${NOOBAA_ROOTPWD})
	else
		rootpwd=$(uuidgen)
	fi
	echo ${rootpwd} | passwd root --stdin

	# disable root login from ssh
	if ! grep -q 'PermitRootLogin no' /etc/ssh/sshd_config; then
		echo 'PermitRootLogin no' >> /etc/ssh/sshd_config
	fi

	# disable "noobaa" user login from ssh
	if ! grep -q 'Match User noobaa' /etc/ssh/sshd_config; then
		echo 'Match User noobaa'  >> /etc/ssh/sshd_config
		echo '	PasswordAuthentication no'  >> /etc/ssh/sshd_config
	fi

    # copy fix_server_plat to rc.local
    if ! grep -q 'fix_server_plat' /etc/rc.local; then
        echo "bash /root/node_modules/noobaa-core/src/deploy/NVA_build/fix_server_plat.sh" >> /etc/rc.local
    fi
    # copy fix_mongo_ssl to rc.local
    if ! grep -q 'fix_mongo_ssl' /etc/rc.local; then
        echo "bash /root/node_modules/noobaa-core/src/deploy/NVA_build/fix_mongo_ssl.sh" >> /etc/rc.local
    fi
    # copy get_docker_variables to rc.local
    if ! grep -q 'get_docker_variables' /etc/rc.local; then
        echo "bash /root/node_modules/noobaa-core/src/deploy/NVA_build/get_docker_variables.sh" >> /etc/rc.local
    fi
}

function setup_supervisors {
	deploy_log "setup_supervisors start"
    mkdir -p /log/supervisor
    mv /usr/bin/supervisord /usr/bin/supervisord_orig
    # Generate default supervisord config
    echo_supervisord_conf > /etc/supervisord.conf
    sed -i 's:logfile=.*:logfile=/log/supervisor/supervisord.log:' /etc/supervisord.conf
    sed -i 's:;childlogdir=.*:childlogdir=/log/supervisor/:' /etc/supervisord.conf
    sed -i 's:logfile_backups=.*:logfile_backups=5:' /etc/supervisord.conf
    sed -i 's:file=/tmp/supervisor.sock.*:file=/var/log/supervisor.sock:' /etc/supervisord.conf
    sed -i 's:pidfile=/tmp/supervisord.pid.*:pidfile=/var/log/supervisord.pid:' /etc/supervisord.conf
    sed -i 's:serverurl=unix.*:serverurl=unix\:///var/log/supervisor.sock:' /etc/supervisord.conf

    # Autostart supervisor
    deploy_log "setup_supervisors autostart"
    cp -f ${CORE_DIR}/src/deploy/NVA_build/supervisord.orig /etc/rc.d/init.d/supervisord
    cp -f ${CORE_DIR}/src/deploy/NVA_build/supervisord.orig /usr/bin/supervisord
    chmod 777 /etc/rc.d/init.d/supervisord
    chmod 777 /usr/bin/supervisord
    chkconfig supervisord on

    # Add NooBaa services configuration to supervisor
    deploy_log "setup_supervisors adding noobaa config to supervisord"
    echo "[include]" >> /etc/supervisord.conf
    echo "files = /data/noobaa_supervisor.conf" >> /etc/supervisord.conf
    cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_supervisor.conf /data
    if [ "${container}" != "docker" ]; then
        ${SUPERD} start
        ${SUPERCTL} reread
        ${SUPERCTL} update
    fi

    deploy_log "setup_supervisors done"
}

function setup_syslog {
	deploy_log "setup_syslog start"

    # copy noobaa_syslog.conf to /etc/rsyslog.d/ which is included by rsyslog.conf
    cp -f ${CORE_DIR}/src/deploy/NVA_build/noobaa_syslog.conf /etc/rsyslog.d/
    cp -f ${CORE_DIR}/src/deploy/NVA_build/logrotate_noobaa.conf /etc/logrotate.d/noobaa

    # setup crontab to run logrotate every 15 minutes.
    echo "*/15 * * * * /usr/sbin/logrotate /etc/logrotate.d/noobaa >/dev/null 2>&1" > /var/spool/cron/root

	deploy_log "setup_syslog done"
}

function setup_named {
    if [ "${container}" != "docker" ]; then
        #Configure 127.0.0.1 as the dns server - we will use named as a dns cache server
        echo "prepend domain-name-servers 127.0.0.1 ;" > /etc/dhclient.conf
        echo "#NooBaa Configured Search" >> /etc/dhclient.conf
        echo "nameserver 127.0.0.1" > /etc/resolv.conf
    fi

    #restore /etc/noobaa_configured_dns.conf
    echo "forwarders { 8.8.8.8; 8.8.4.4; };" > /etc/noobaa_configured_dns.conf
    echo "forward only;" >> /etc/noobaa_configured_dns.conf
    cp -f ${CORE_DIR}/src/deploy/NVA_build/named.conf /etc/named.conf
}

function setup_mongodb {
	deploy_log "setup_mongodb start"

	sleep 10 # workaround for mongo starting

	# setting up mongodb users for admin and nbcore databases
    /usr/bin/mongo admin ${CORE_DIR}/src/deploy/NVA_build/mongo_setup_users.js

    chkconfig mongod off

	deploy_log "setup_mongodb done"
}

function add_mongo_ssl_user {
    su - mongod -s /bin/bash -c "mongod --dbpath /data/mongo/cluster/shard1 &"
    # Replace with clever way to wait (for example like wait_for_mongo method that checks status)
    sleep 20

    local client_subject="CN=client,OU=MyClients,O=NOOBAA,L=NYC,ST=NY,C=US"
    /usr/bin/mongo --eval "var param_client_subject='${client_subject}'" ${CORE_DIR}/src/deploy/NVA_build/add_mongo_ssl_user.js

    local mongod_pid=$(pgrep -lf mongod | awk '{print $1}')
    kill -2 ${mongod_pid}
}

function runinstall {
    deploy_log "runinstall start"
    verify_noobaa_pre_requirements
    set -e
	install_platform
	setup_linux_users
    install_noobaa_repos
    install_nodejs
    install_mongo
    general_settings
    setup_supervisors
    setup_syslog
    setup_named
    #Make sure the OVA is created with no DHCP or previous IP configuration
    clean_ifcfg
    deploy_log "runinstall done"
}

if [ "$1" == "runinstall" ]; then
	runinstall
fi
