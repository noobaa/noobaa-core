#!/bin/bash

set -e
export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'

rpm_location="/tmp/"

function config_mongo_repo {
    mkdir -p /data/mongo/cluster/shard1

    # create a Mongo 3.6 Repo file
    cat > /etc/yum.repos.d/mongodb-org-3.6.repo << EOF
[mongodb-org-3.6]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/7Server/mongodb-org/3.6/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-3.6.asc
EOF

}

function config_scl {

    echo "config scl start"
    eval $(cat /etc/os-release | grep -w ID)
    if [ ${ID} == "centos" ]
    then
        yum install centos-release-scl -y
    else
        yum-config-manager --enable rhel-server-rhscl-7-rpms
    fi

    echo "config scl done"
}

function verify_rpm_exist() {
    if [ ! -f ${rpm_location}/noobaa*.rpm ]
    then 
        echo "there is no rpm in ${rpm_location}, Exiting"
        exit 1
    fi
}

verify_rpm_exist
#config_scl
config_mongo_repo
yum install -y ${rpm_location}/noobaa*.rpm

#clean
yum clean all
rm -f ${rpm_location}/noobaa*.rpm