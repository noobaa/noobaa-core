#!/bin/bash
#this script uninstalls the service on linux systems.
#first we find the newest init mechanism, then we uninstall
PATH=/usr/local/noobaa:$PATH;

#attempting to remove service installations
/usr/local/noobaa/remove_service.sh

rm -rf /usr/local/noobaa
echo "NooBaa agent removed"
