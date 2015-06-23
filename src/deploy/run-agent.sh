#!/bin/bash
#$1 is the env name (mandatory)
#$2 is the port number
export HOME='/root'
cd /noobaa
source /usr/local/nvm/nvm.sh
nvm use 0.10.33
if [ $# -eq 0 ]
then
echo 'missing env parameter'
exit
fi
cp -f /noobaa/node_modules/noobaa-agent/config.js /noobaa/node_modules/config.js
#cp -f /noobaa/agent_cli.js /noobaa/node_modules/noobaa-agent/agent/agent_cli.js

node  /noobaa/node_modules/noobaa-agent/agent/agent_cli.js

time curl -k -H "Accept: application/json" https://${1}:8443/agent/package.json > package.json
echo '++++++++++  updated code. reload ++++++++++'
time rm -rf node_modules/
time npm config set strict-ssl false
time npm install

node  /noobaa/node_modules/noobaa-agent/agent/agent_cli.js

exit
