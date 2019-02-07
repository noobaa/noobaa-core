#!/bin/bash
AGENT_CONF_FILE="/noobaa_storage/agent_conf.json"
echo "Got base64 agent_conf: ${AGENT_CONFIG}"
if [ ! -f $AGENT_CONF_FILE ]; then
    openssl enc -base64 -d -A <<<${AGENT_CONFIG} >${AGENT_CONF_FILE}
fi
echo "Written agent_conf.json: $(cat ${AGENT_CONF_FILE})"
cd /usr/local/noobaa
./node ./src/agent/agent_cli