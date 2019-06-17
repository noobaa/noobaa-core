#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'

set -x
DBG_LOG_FILE="/var/log/noobaa_deploy.dbg"
exec 2>> ${DBG_LOG_FILE}

NOOBAA_ROOTPWD="/etc/nbpwd"
LOG_FILE="/log/noobaa_deploy.log"
eval $(cat /etc/os-release | grep -w ID)

function deploy_log {
    local now=$(date)
    echo "${now} $*" >> ${LOG_FILE}
    echo "${now} $*"
    logger -t UPGRADE -p local0.warn "$*"
}

function install_supervisor {
    if [ ${ID} == "centos" ] || [ ${ID} == "fedora" ]
    then
        deploy_log install_supervisor start
        # easy_install is for Supervisord and comes from python-setuptools
        easy_install supervisor
	    deploy_log install_supervisor done
    fi

	deploy_log "setup_supervisors start"
    mkdir -p /log/supervisor

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
    mv /usr/bin/supervisord /usr/bin/supervisord_orig
    mv /tmp/supervisord /usr/bin/supervisord

    # Add NooBaa services configuration to supervisor
    deploy_log "setup_supervisors adding noobaa config to supervisord"
    echo "[include]" >> /etc/supervisord.conf
    echo "files = /data/noobaa_supervisor.conf" >> /etc/supervisord.conf
    deploy_log "setup_supervisors done"
}

function setup_mongo {
    deploy_log "setup_mongo start"

    mkdir -p /data/mongo/cluster/shard1
    # TODO: remove this as we probebly do not need this if we are not running as root
    #       When not running as root we are not running as mongod user
    local mongo_desire_name="mongod"
    local mongo_user=$(cat /etc/passwd | grep mongo |awk -F ":" '{print $1}')
    local mongo_group=$(cat /etc/group | grep mongo |awk -F ":" '{print $1}')
    if [ ${mongo_user} != ${mongo_desire_name} ]
    then
        usermod -l ${mongo_desire_name} ${mongo_user}
    fi
    if [ ${mongo_group} != ${mongo_desire_name} ]
    then
        groupmod -n ${mongo_desire_name} ${mongo_group}
    fi
    # mongodb will probably run as root after yum (if not docker) - we need to fix it if we want to use setup_platform
    chown -R mongod:mongod /data/mongo/

    deploy_log "setup_mongo done"
}

function install_kubectl {
    if [ "${container}" == "docker" ] && [ "${ID}" != "rhel" ]; then
        deploy_log "install_kubectl start"
        stable_version=$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)
        curl -LO https://storage.googleapis.com/kubernetes-release/release/${stable_version}/bin/linux/amd64/kubectl
        chmod +x ./kubectl
        sudo mv ./kubectl /usr/local/bin/kubectl
        deploy_log "install_kubectl done"
    fi
}

function setup_bashrc {
	deploy_log "setup_bashrc start"

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

    deploy_log "setting up bash_completions"

    echo "# Use bash-completion, if available
[[ \$PS1 && -f /usr/share/bash-completion/bash_completion ]] &&
    . /usr/share/bash-completion/bash_completion" >> ~/.bashrc

	deploy_log "setup_bashrc done"
}

function fix_file_descriptor_limits {
    #TODO: check if we need this and remove if not
    #Fix file descriptor limits, tcp timeout
    echo "root hard nofile 102400" >> /etc/security/limits.conf
    echo "root soft nofile 102400" >> /etc/security/limits.conf
}

function remove_rsyslog_listen_conf {
	deploy_log "remove_rsyslog_listen_conf start"
    # copy noobaa_syslog.conf to /etc/rsyslog.d/ which is included by rsyslog.conf
    # remove rsyslog listen.conf
    rm -f /etc/rsyslog.d/listen.conf
	deploy_log "remove_rsyslog_listen_conf done"
}

function setup_non_root_user() {
    # create home dir for non-root user and copy bashrc
    local NOOBAA_USER=noob
    mkdir -p /home/${NOOBAA_USER}
    cp -f /root/.bashrc /home/${NOOBAA_USER}
    # give permissions for root group
    chgrp -R 0 /home/${NOOBAA_USER} && chmod -R g=u /home/${NOOBAA_USER}

    # in openshift the container will run as a random user which belongs to root group
    # set permissions for group to be same as owner to allow access to necessary files
    deploy_log "setting file permissions for root group"
    # allow root group same permissions as root user so it can run supervisord
    chgrp -R 0 /bin/supervisor* && chmod -R g=u /bin/supervisor*
    # supervisord needs to write supervisor.sock file in /var/log
    chgrp -R 0 /var/log && chmod -R g=u /var/log

    # noobaa code dir - allow same access as user
    chgrp -R 0 /root/node_modules && chmod -R g=u /root/node_modules

    # when running with docker /data and /log are not external volumes - allow access
    chgrp -R 0 /data && chmod -R g=u /data
    chgrp -R 0 /log && chmod -R g=u /log

    # maybe we can make it more fine-grained - for now, give access to all /etc
    chgrp -R 0 /etc && chmod -R g=u /etc

    # give access for logrotate
    chgrp -R 0 /var/lib/logrotate && chmod -R g=u /var/lib/logrotate

    # setuid for rsyslog so it can run as root
    chmod u+s /sbin/rsyslogd

}

deploy_log "Starting setup platform"
set -e
install_supervisor
setup_mongo
install_kubectl
setup_bashrc
fix_file_descriptor_limits
remove_rsyslog_listen_conf
setup_non_root_user
deploy_log "Completed setup platform"
