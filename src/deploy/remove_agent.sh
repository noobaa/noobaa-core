#!/bin/bash

/usr/local/noobaa/uninstall_noobaa_agent.sh
if [ -f "/usr/local/noobaa" ];
then
	echo “NooBaa Directory still exist!”
	exit 1
fi

