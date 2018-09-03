#!/bin/bash
AGENT_CONFIG=$@
AGENT_CONF_FILE="/usr/local/noobaa/agent_conf.json"
if [ ! -f $AGENT_CONF_FILE ]; then
    openssl enc -base64 -d -A <<<${AGENT_CONFIG} >${AGENT_CONF_FILE}
fi
node ./src/agent/agent_cli