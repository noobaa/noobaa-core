#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'

fileLocation="/usr/local/noobaa/package.json"
verArray=($(cat ${fileLocation} | grep version))
sed -i "s/${verArray[@]}/${verArray[0]} \"test\",/g" ${fileLocation}
#killing the agent_cli so it will reload the package.json when it get back up
sudo kill -9 $(ps -ef | grep agent_cli | grep -v grep | awk '{print $2}')
