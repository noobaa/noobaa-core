#!/bin/bash
echo "installing NooBaa"
PATH=/usr/local/noobaa:$PATH;

if [[ $(ps -elf|grep 'systemd+\{0,1\}[ ]\{1,\}[0-9]\{1,\}[ ]\{1,\}1 ') ]]; then
  echo "systemd detected. Registering service"
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  systemctl enable noobaalocalservice
elif [[ -d /etc/init.d ]]; then
  echo "upstart detected. Creating startup script"
  cp /usr/local/noobaa/src/agent/noobaalocalservice.conf /etc/init/noobaalocalservice.conf
  service noobaalocalservice start
else
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  echo "No systemd or upstart detected. Using System V"
fi
mkdir /usr/local/noobaa/logs

echo "NooBaa installation complete"
