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

NODE_PATH="${NODE_PATH:-/usr/local/node}"

function get_arch() {
    local MACHINE=$(uname -m)
    local ARCH

    if [ "$MACHINE" = "aarch64" ]; then
        ARCH="arm64"
    elif [ "$MACHINE" = "s390x" ]; then
        ARCH="s390x"
    elif [ "$MACHINE" = "ppc64le" ]; then
        ARCH="ppc64le"
    else
        ARCH="x64"
    fi

    echo ${ARCH}
}

function download_node() {
    local arch=$(get_arch)

    local node_version="v${NODEJS_VERSION}"
    local filename="node-${node_version}-linux-${arch}.tar.xz"

    curl -O https://nodejs.org/dist/${node_version}/${filename}

    echo ${filename}
}

function install_node() {
    local arch=$(get_arch)
    local node_version="v${NODEJS_VERSION}"
    local filename="node-${node_version}-linux-${arch}.tar.xz"

    mkdir -p ${NODE_PATH}
    cd ${NODE_PATH}
    download_node
    tar -xf ${filename}

    ln -s ${NODE_PATH}/node-${node_version}-linux-${arch}/bin/node /usr/local/bin/node
    ln -s ${NODE_PATH}/node-${node_version}-linux-${arch}/bin/npm /usr/local/bin/npm
    ln -s ${NODE_PATH}/node-${node_version}-linux-${arch}/bin/npm /usr/local/bin/npx

    rm ${filename}
}

if [ -z "${SKIP_NODE_INSTALL}" ]
then
    install_node
fi
