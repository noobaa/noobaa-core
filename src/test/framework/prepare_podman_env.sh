#!/bin/bash
source /root/.bashrc

# we must stop all services to release ports
supervisorctl stop all 

# remove all iptables rules to avoid blocking networking to the containers


cd /root/node_modules/noobaa-core
#install podman
yum install -y podman

# this flag must be set to allow containers that run systemd access to cgroup configuration on host
# https://blog.tinned-software.net/docker-container-on-rhel-fails-to-start-without-error/
setsebool -P container_manage_cgroup 1

#build docker image
./src/deploy/NVA_build/podman_build_container.sh

