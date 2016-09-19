#!/bin/bash
echo "installing NooBaa"
PATH=/usr/local/noobaa:$PATH;
mkdir /usr/local/noobaa/logs

if [[ -d /usr/lib/systemd ]]; then
  echo "systemd detected. Registering service"
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  systemctl enable noobaalocalservice
elif [[ -d /etc/init ]]; then
  echo "upstart detected. Creating startup script"
  cp /usr/local/noobaa/src/agent/noobaalocalservice.conf /etc/init/noobaalocalservice.conf
  service noobaalocalservice start
else
  echo "No systemd or upstart detected. Using System V"
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
fi

echo "NooBaa installation complete"
