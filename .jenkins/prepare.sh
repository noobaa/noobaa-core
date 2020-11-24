#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'
set -e -o pipefail

function usage() {
    echo "Options:"
    echo "--help|-h                 specify the flags"
    echo "--ref                     specify the reference of pr"
    echo "--workdir                 specify the working directory"
    echo "--gitrepo                 specify the git repository"
    echo "--base                    specify the base branch to checkout"
    echo " "
    echo "Sample Usage:"
    echo "./prepare.sh --gitrepo=https://github.com/example --workdir=/opt/build --ref=pull/123/head"
    exit 0
}

# FIXME: unfortunately minikube does not work with podman (yet)
function install_docker()
{
    curl https://download.docker.com/linux/centos/docker-ce.repo -o /etc/yum.repos.d/docker-ce.repo
    # update all packages to prevent missing dependencies
    dnf -y update
    # install and enable docker
    dnf -y --nobest install docker-ce
    # fix network access from within docker containers (IP conflict in CI environment)
    [ -d /etc/docker ] || mkdir /etc/docker
    echo '{ "bip": "192.168.234.5/24" }' > /etc/docker/daemon.json
    systemctl enable --now docker
}

# In case no value is specified, default values will be used.
gitrepo="https://github.com/noobaa/noobaa-core"
workdir="tip/"
ref="master"
base="master"
build_all="true"

ARGUMENT_LIST=(
    "ref"
    "workdir"
    "gitrepo"
    "base"
    "build_all"
)

opts=$(getopt \
    --longoptions "$(printf "%s:," "${ARGUMENT_LIST[@]}")help" \
    --name "$(basename "${0}")" \
    --options "" \
    -- "$@"
)
ret=$?

if [ ${ret} -ne 0 ]
then
    echo "Try '--help' for more information."
    exit 1
fi

eval set -- "${opts}"

while true; do
    case "${1}" in
    --help)         usage ;;
    --gitrepo)      gitrepo=${2}
                    shift 2 ;;
    --workdir)      workdir=${2}
                    shift 2 ;;
    --ref)          ref=${2}
                    echo "${ref}"
                    shift 2 ;;
    --base)         base=${2}
                    shift 2 ;;
    --build_all)    build_all="true"
                    shift 1 ;;
    --)             shift 1
                    break ;;
    esac
done

set -x

dnf -y install git make wget
install_docker

git clone --depth=1 --branch="${base}" "${gitrepo}" "${workdir}"
cd "${workdir}"
git fetch origin "${ref}:tip/${ref}"
git checkout "tip/${ref}"

if [ "${build_all}" == "false" ]
then
    # Bypassing the building of base and noobaa-builder by pointing to noobaa/noobaa-base instead of noobaa-base
    # We don't want to build it, so we reduce the overall time for builds/test.
    # The base and noobaa-builder are not often changing. once they do We need to push into dockerhub.io 
    sed -i -e 's|FROM noobaa-base .*|FROM noobaa/noobaa-base as server_builder|' ${workdir}/src/deploy/NVA_build/NooBaa.Dockerfile
    sed -i -e 's|noobaa: base|noobaa:|' ${workdir}/Makefile
fi
