#!/bin/bash
function jsonval {
    temp=`echo $json | sed 's/\\\\\//\//g' | sed 's/[{}]//g' | awk -v k="text" '{n=split($0,a,","); for (i=1; i<=n; i++) print a[i]}' | sed 's/\"\:\"/\|/g' | sed 's/[\,]/ /g' | sed 's/\"//g' | grep -w $prop`
    echo ${temp##*|}
}
json=$(cat /usr/local/noobaa/agent_conf.json)
prop='address'
metadata_server_address=`jsonval`
metadata_server_address=${metadata_server_address//wss/https}

cd /usr/local/noobaa
#cleanup of older setup
rm -f noobaa-setup

./node src/agent/agent_cli.js
if [[ $? -eq 0 ]]; then
   #upgrade
   sudo wget -t 2 --no-check-certificate $metadata_server_address/public/noobaa-setup
   echo "Upgrading ..."
   if [ ! -f ./noobaa-setup ]; then
       echo "Failed to download upgrade package"
   else
       sudo chmod +x noobaa-setup
       sudo ./noobaa-setup
   fi
else
   echo "Agent exited with error" $?
fi
