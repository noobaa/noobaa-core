#!/bin/bash

fix_non_root_user() {
  # in openshift, when not running as root - ensure that assigned uid has entry in /etc/passwd.
  if [ $(id -u) -ne 0 ]; then
      local NOOBAA_USER=noob
      if ! grep -q ${NOOBAA_USER}:x /etc/passwd; then
        echo "${NOOBAA_USER}:x:$(id -u):$(id -g):,,,:/home/$NOOBAA_USER:/bin/bash" >> /etc/passwd
      fi
  fi
}

# tar -zxf /noobaa.tar.gz
fix_non_root_user

# set ownership\mode of /noobaa_storage
/bin/kube_pv_chown agent

AGENT_CONF_FILE="/noobaa_storage/agent_conf.json"
if [ -z ${AGENT_CONFIG} ]
then
  echo "AGENT_CONFIG is required ENV variable. AGENT_CONFIG is missing. Exit"
  exit 1
else
  echo "Got base64 agent_conf: ${AGENT_CONFIG}"
  if [ ! -f $AGENT_CONF_FILE ]; then
    openssl enc -base64 -d -A <<<${AGENT_CONFIG} >${AGENT_CONF_FILE}
  fi
  echo "Written agent_conf.json: $(cat ${AGENT_CONF_FILE})"
fi
node ./src/agent/agent_cli
# Providing an env variable with the name "LOOP_ON_FAIL=true" 
# will trigger the condition below.
# Currently we will loop on any exit of the agent_cli 
# regurdless to the exit code
while [ "${LOOP_ON_FAIL}" == "true" ] 
do
  echo "$(date) Failed to run ${script}" 
  sleep 10
done
