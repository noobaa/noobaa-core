#!/bin/bash
CONFIG=false
#if we have the folder and agent_conf.json, we will assume upgrade. Need to revisit in the future.
openssl version
if [ $? -ne 0 ]; then
    echo "Missing openssl, please install openssl and rerun the setup"
    exit 1
fi
linux_dist=$(gawk -F=    '/^NAME/{print $2}' /etc/os-release)
if [[ "$linux_dist" == *"Ubuntu"* ]]; then
    initctl --version
    if [ $? -ne 0 ]; then
        echo "Missing upstart, please install it by typing: sudo apt install upstart, and rerun the setup"
        exit 1
    else
        echo 'initctl exists'
    fi
else
    echo 'not ubuntu'
fi

if [ ! -d "/usr/local/noobaa" ]; then
   if [[ $# -lt 2 ]]; then
  	echo "usage: noobaa-setup /S /Config <configuration string>"
 	exit 1
    else
       CONFIG=$2
       mkdir /usr/local/noobaa
       echo "config is:" ${CONFIG}
       openssl enc -base64 -d -A <<<${CONFIG} >/usr/local/noobaa/agent_conf.json
       cat /usr/local/noobaa/agent_conf.json
    fi
else
   if [ ! -f /usr/local/noobaa/agent_conf.json ]; then
      #if we don't have the config, cleanup
      rm -rf /usr/local/noobaa
      echo "usage: noobaa-setup /S /Config <configuration string>"
      exit 1
   fi
fi

./noobaa-installer --keep --target /usr/local/noobaa
