#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'
set -x
echo "=====> nvm install"
source ~/.bashrc || exit 1
source "$NVM_DIR/nvm.sh" || exit 1
nvm install || exit 1

echo "=====> get package for git commit $GIT_COMMIT"
NB_VERSION=$(node << EOF
    'use strict';
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    const git = process.env.GIT_COMMIT || 'DEVONLY';
    const version = pkg.version.split('-')[0] + '-' + git.slice(0, 7);
    console.log(version);
EOF
)
echo "=====> version $NB_VERSION"

echo "=====> creating rpm noobaa-NVA-${NB_VERSION}.rpm"
build_rpm_location="build/rpm"
mkdir -pm 777 ${build_rpm_location}
cp build/public/noobaa-NVA-${NB_VERSION}.tar.gz ${build_rpm_location}
cp ./src/deploy/NVA_build/setup_platform.sh ${build_rpm_location}
cp ./src/deploy/rpm/{create_rpm.sh,noobaa.spec} ${build_rpm_location}
chmod 777 ${build_rpm_location}/create_rpm.sh
if [ -d ~/rpmbuild ] 
then
    will_wait=true
else 
    will_wait=false
fi
will_wait_count=0
if ${will_wait}
then
    while [ -d ~/rpmbuild ]
    do
        sleep 10
        will_wait_count=$((will_wait_count+1))
        #setting timeout of 1 hour 
        if [ ${will_wait_count} -eq 360 ]
        then
            echo "~/rpmbuild from previus build exists for more then an hour, Exiting."
            exit 1
        fi
    done
    #sleeping randomally to verify that no other build has started.
    sleep $((10+RANDOM%60))
    if [ ! -d ~/rpmbuild ]
    then
        will_wait=false
    else
        will_wait_count=0
    fi
fi
build/rpm/create_rpm.sh -l ${build_rpm_location}
if [ $? -eq 0 ]
then
    mv ~/rpmbuild/RPMS/noarch/*.rpm build/public/
    if [ $? -ne 0 ]
    then
        rm -rf ~/rpmbuild
        exit 1
    fi
    rm -rf ${build_rpm_location}
else
    rm -rf ${build_rpm_location}
    rm -rf ~/rpmbuild
    exit 1
fi

#deleting the whole tree of rpmbuild to start clean
rm -rf ~/rpmbuild