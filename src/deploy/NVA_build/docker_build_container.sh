#!/bin/bash
export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'
# docker build -f ./src/deploy/NVA_build/Server.Dockerfile -t nbimage --rm --squash ./ || exit 1 # squash is an experimental feature
docker build -f ./src/deploy/NVA_build/Server.Dockerfile -t nbimage --rm ./ || exit 1
