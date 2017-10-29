#!/bin/bash

if [ -f "/usr/local/noobaa/agent_conf.json" ];
then
	echo "noobaa already exists"
else
	agent_conf=$2
	env_name=$1

	echo "notadmin ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
	iptables -I INPUT -j ACCEPT
	service iptables save
	curl --insecure -L https://$env_name:8443/public/noobaa-setup >noobaa-setup
	chmod +x ./noobaa-setup
	sleep 30s
	./noobaa-setup $agent_conf
fi
