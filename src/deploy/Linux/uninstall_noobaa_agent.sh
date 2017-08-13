#!/bin/bash
#this script uninstalls the service on linux systems.
#first we find the newest init mechanism, then we uninstall
PATH=/usr/local/noobaa:$PATH;

#attempting to remove service installations
chmod 777 /usr/local/noobaa/remove_service.sh
systemctl stop noobaalocalservice >> /dev/null
/usr/local/noobaa/remove_service.sh

/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_uninstall.js --remove_noobaa_storage
rm -rf /usr/local/noobaa
echo "NooBaa agent removed"
