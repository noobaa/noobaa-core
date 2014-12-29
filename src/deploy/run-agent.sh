#!/bin/bash
#$1 is the env name (mandatory)
#$2 is the port number
cd /noobaa
source /usr/local/nvm/nvm.sh
nvm use 0.10.33
if [ $# -eq 0 ]
then
echo 'missing env parameter'
exit
fi
#cp -f /noobaa/agent_cli.js /noobaa/node_modules/noobaa-agent/agent/agent_cli.js
if [ $# -eq 1 ]
  then
    node  /noobaa/node_modules/noobaa-agent/agent/agent_cli.js --prod --address  https://noobaa-$1.herokuapp.com
  else
    echo 'got port '$1 $2
    node  /noobaa/node_modules/noobaa-agent/agent/agent_cli.js --prod --address  https://noobaa-$1.herokuapp.com  --port $2
fi
time curl -H "Accept: application/json" https://noobaa-$1.herokuapp.com/agent/package.json > package.json
echo '++++++++++  updated code. reload ++++++++++'
time rm -rf node_modules/
time npm install
if [ $# -eq 1 ]
  then
    node  /noobaa/node_modules/noobaa-agent/agent/agent_cli.js --prod --address  https://noobaa-$1.herokuapp.com 
  else
   echo 'got port (2) '$1 $2 
    node  /noobaa/node_modules/noobaa-agent/agent/agent_cli.js --prod --address  https://noobaa-$1.herokuapp.com  --port $2
fi
exit
