#!/bin/bash
AGENT_CONF_FILE="/usr/local/noobaa/agent_conf.json"
echo ${AGENT_CONFIG}
if [ ! -f $AGENT_CONF_FILE ]; then
    ./noobaa-setup ${AGENT_CONFIG}
fi
echo $(cat ${AGENT_CONF_FILE})
cd /usr/local/noobaa
./node ./src/agent/agent_cli