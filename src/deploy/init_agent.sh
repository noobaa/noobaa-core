#!/bin/bash

if [ -f "/usr/local/noobaa/agent_conf.json" ];
then
	echo "noobaa already exists"
else
	agent_conf=$(curl http://metadata/computeMetadata/v1/instance/attributes/agent_conf -H "Metadata-Flavor: Google")
	env_name=$(curl http://metadata/computeMetadata/v1/instance/attributes/env -H "Metadata-Flavor: Google")

	curl --insecure -L https://${env_name}:8443/public/noobaa-setup >noobaa-setup
	sudo chmod +x ./noobaa-setup
	sudo ./noobaa-setup /S /config $agent_conf
fi
