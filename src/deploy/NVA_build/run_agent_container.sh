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

fix_non_root_user
# set ownership\mode of /noobaa_storage
/usr/local/noobaa/build/Release/kube_pv_chown agent $(id -u)

AGENT_CONF_FILE="/noobaa_storage/agent_conf.json"
echo "Got base64 agent_conf: ${AGENT_CONFIG}"
if [ ! -f $AGENT_CONF_FILE ]; then
    openssl enc -base64 -d -A <<<${AGENT_CONFIG} >${AGENT_CONF_FILE}
fi
echo "Written agent_conf.json: $(cat ${AGENT_CONF_FILE})"
cd /usr/local/noobaa
./node ./src/agent/agent_cli