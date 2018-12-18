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
cp ./src/deploy/NVA_build/deploy_base.sh ${build_rpm_location}
cp ./src/deploy/rpm/{create_rpm.sh,noobaa.spec} ${build_rpm_location}
chmod 777 ${build_rpm_location}/create_rpm.sh
build/rpm/create_rpm.sh -l ${build_rpm_location}
if [ $? -eq 0 ]
then
    mv ~/rpmbuild/RPMS/noarch/*.rpm build/public/ || exit 1
    rm -rf ${build_rpm_location}
else
    rm -rf ${build_rpm_location}
    exit 1
fi
