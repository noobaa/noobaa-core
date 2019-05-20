#!/bin/bash

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

echo "=====> update tar noobaa-NVA-${NB_VERSION}.tar.gz"
gunzip build/public/noobaa-NVA-${NB_VERSION}.tar.gz || exit 1
mv build/linux/noobaa-setup-${NB_VERSION}* build/public/ || exit 1
tar --transform='s:^:noobaa-core/:' \
    -rf build/public/noobaa-NVA-${NB_VERSION}.tar \
    build/public/noobaa-setup-${NB_VERSION} \
    build/public/noobaa-setup-${NB_VERSION}.md5 \
    || exit 1
gzip build/public/noobaa-NVA-${NB_VERSION}.tar