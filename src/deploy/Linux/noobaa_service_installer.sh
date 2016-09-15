#!/bin/bash
echo "installing NooBaa"
PATH=/usr/local/noobaa:$PATH;
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer

if [[ $(ps -elf|grep 'systemd+\{0,1\}[ ]\{1,\}[0-9]\{1,\}[ ]\{1,\}1 ') ]]; then
  echo "systemd detected. Registering service"
  systemctl enable noobaalocalservice
else
  echo "No systemd detected. Installing upstart script"
  cp /usr/local/noobaa/src/agent/noobaalocalservice.conf /etc/init/noobaalocalservice.conf
fi

echo "NooBaa installation complete"
