#!/bin/bash

if [ -f "/usr/local/noobaa/agent_conf.json" ];
then
	echo "noobaa already exists"
else
	agent_conf=$2
	env_name=$1

	iptables -I INPUT -j ACCEPT
	service iptables save
	curl --insecure -L https://$env_name:8443/public/noobaa-setup >noobaa-setup
	chmod +x ./noobaa-setup
	./noobaa-setup /S /config $agent_conf
fi
