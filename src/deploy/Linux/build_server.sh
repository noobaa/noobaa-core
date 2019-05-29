#!/bin/bash

echo "$(date) =====> nvm install"
source ~/.bashrc || exit 1
source "$NVM_DIR/nvm.sh" || exit 1
nvm install || exit 1
NODEJS_VERSION=$(nvm current)

echo "$(date) =====> mkdirs"
mkdir -p build/public/

echo "$(date) =====> update package.json for git commit $GIT_COMMIT"
NB_VERSION=$(node << EOF
    'use strict';
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    const git = process.env.GIT_COMMIT || 'DEVONLY';
    const version = pkg.version.split('-')[0] + '-' + git.slice(0, 7);
    const EXCLUDE_DEPS_REGEXP = /gulp|mocha|istanbul|eslint|vsphere/;
    const INCLUDE_DEV_DEPS_REGEXP = /babel/;
    const deps = Object.keys(pkg.dependencies);
    const dev_deps = Object.keys(pkg.devDependencies);
    const dependencies = {};
    const devDependencies = {};
    for (let i = 0; i < deps.length; ++i) {
        if (EXCLUDE_DEPS_REGEXP.test(deps[i])) {
            console.warn('exclude dependency:', deps[i]);
        } else {
            dependencies[deps[i]] = pkg.dependencies[deps[i]];
        }
    }
    for (let i = 0; i < dev_deps.length; ++i) {
        if (INCLUDE_DEV_DEPS_REGEXP.test(dev_deps[i])) {
            devDependencies[dev_deps[i]] = pkg.devDependencies[dev_deps[i]];
        }
    }
    const updated_pkg = {
        name: 'noobaa-NVA',
        version: version,
        private: true,
        license: 'Copyright (C) 2016 NooBaa all rights reserved',
        scripts: pkg.scripts,
        dependencies,
        devDependencies,
        browser: pkg.browser,
    };
    fs.writeFileSync('./package.json', JSON.stringify(updated_pkg, null, 2) + '\n');
    console.log(version);
EOF
)
echo "$(date) =====> version $NB_VERSION"

echo "$(date) =====> npm install"
npm install || exit 1
#when we build should we devide it to "build": "npm run build:native && npm run build:fe" ?
echo "$(date) =====> npm run build"
npm run build || exit 1

echo "$(date) =====> npm install frontend"
pushd frontend
npm install || exit 1
npm run build || exit 1
popd

echo "$(date) =====> download node.js tarball ($NODEJS_VERSION} and nvm.sh (latest)"
wget -P build/public/ https://nodejs.org/dist/${NODEJS_VERSION}/node-${NODEJS_VERSION}-linux-x64.tar.xz || exit 1
wget -P build/public/ https://raw.githubusercontent.com/creationix/nvm/master/nvm.sh || exit 1

echo "$(date) =====> tar noobaa-NVA-${NB_VERSION}.tar.gz"
tar \
    --transform='s:^:noobaa-core/:' \
    --exclude='src/native/aws-cpp-sdk' \
    --exclude='src/native/third_party' \
    -czf noobaa-NVA-${NB_VERSION}.tar.gz \
    LICENSE \
    package.json \
    platform_restrictions.json \
    config.js \
    .nvmrc \
    src/ \
    frontend/dist/ \
    build/public/ \
    build/Release/ \
    node_modules/ \
    || exit 1
mv noobaa-NVA-${NB_VERSION}.tar.gz build/public/