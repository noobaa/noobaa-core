#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'
set -x

NODEJS_VERSION=$1
if [ -z "${NODEJS_VERSION}" ]
then
    echo "NODEJS_VERSION is a must argument"
    echo "usage: ${0} <nvmrc path>"
    exit 1
fi

MACHINE=$(uname -m)
if [ "$MACHINE" = "aarch64" ]; then
    ARCH="arm64"
elif [ "$MACHINE" = "s390x" ]; then
    ARCH="s390x"
elif [ "$MACHINE" = "ppc64le" ]; then
    ARCH="ppc64le"
else
    ARCH="x64"
fi
NODEJS_VERSION=v${NODEJS_VERSION}
FILE_NAME=node-${NODEJS_VERSION}-linux-${ARCH}.tar.xz
NODE_PATH="/usr/local/node"

mkdir -p ${NODE_PATH}
cd ${NODE_PATH}
curl -O https://nodejs.org/dist/${NODEJS_VERSION}/${FILE_NAME}
tar -xf ${FILE_NAME}

ln -s ${NODE_PATH}/node-${NODEJS_VERSION}-linux-${ARCH}/bin/node /usr/local/bin/node
ln -s ${NODE_PATH}/node-${NODEJS_VERSION}-linux-${ARCH}/bin/npm /usr/local/bin/npm
ln -s ${NODE_PATH}/node-${NODEJS_VERSION}-linux-${ARCH}/bin/npm /usr/local/bin/npx

rm ${FILE_NAME} 
