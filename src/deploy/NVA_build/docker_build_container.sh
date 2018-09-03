#!/bin/bash
export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'
docker build -f ./src/deploy/NVA_build/Server.Dockerfile -t nbimage_init --rm ./ || exit 1
docker run -d \
    -v /sys/fs/cgroup:/sys/fs/cgroup:ro \
    --security-opt seccomp=unconfined \
    --tmpfs /run \
    --tmpfs /run/lock \
    --name nbcontainer \
    -p 60100-60600:60100-60600  \
    -p 80:80 \
    -p 443:443 \
    -p 8080:8080 \
    -p 8443:8443 \
    -p 8444:8444 \
    -p 27000:27000 \
    -p 26050:26050 \
    nbimage_init || exit 1
docker exec nbcontainer bash +x ./tmp/deploy_base.sh runinstall || exit 1
docker container stop nbcontainer || exit 1
docker commit nbcontainer nbimage || exit 1
# docker container rm nbcontainer || exit 1
# docker image rm nbimage_init || exit 1
