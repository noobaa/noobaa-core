#!/bin/bash
# docker build -f ./src/deploy/NVA_build/Server.Dockerfile -t nbimage --rm --squash ./ || exit 1 # squash is an experimental feature
#docker build --build-arg noobaa_rpm=./noobaa.rpm --build-arg install_script=./src/deploy/rpm/install.sh -f ./src/deploy/NVA_build/Server.Dockerfile -t nbimage --rm ./
docker build -f ./src/deploy/NVA_build/Server.Dockerfile -t nbimage --rm ./ || exit 1
