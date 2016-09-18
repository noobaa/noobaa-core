#!/bin/bash
echo "installing NooBaa"
PATH=/usr/local/noobaa:$PATH;
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
mkdir /usr/local/noobaa/logs

if [[ $(ps -elf|grep 'systemd+\{0,1\}[ ]\{1,\}[0-9]\{1,\}[ ]\{1,\}1 ') ]]; then
  echo "systemd detected. Registering service"
  systemctl enable noobaalocalservice
else if [[ -d /etc/init.d ]]; then
  echo "upstart detected. Creating startup script"
  cp /usr/local/noobaa/src/agent/noobaalocalservice.conf /etc/init/noobaalocalservice.conf
fi
  echo "No systemd or upstart detected. Using System V"
fi

echo "NooBaa installation complete"
