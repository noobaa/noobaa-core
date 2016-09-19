#!/bin/bash
echo "installing NooBaa"
PATH=/usr/local/noobaa:$PATH;
mkdir /usr/local/noobaa/logs

if [[ -d /usr/lib/systemd ]]; then
  echo "Systemd detected. Installing service"
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  systemctl enable noobaalocalservice
elif [[ -d /usr/share/upstart ]]; then
  echo "Upstart detected. Creating startup script"
  cp /usr/local/noobaa/src/agent/noobaalocalservice.conf /etc/init/noobaalocalservice.conf
  service noobaalocalservice start
elif [[ -d /etc/init.d ]]; then
  echo "System V detected. Installing service"
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
else
  echo "Cannot detect init mechanism. Attempting service install"
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  systemctl enable noobaalocalservice
  cp /usr/local/noobaa/src/agent/noobaalocalservice.conf /etc/init/noobaalocalservice.conf
  service noobaalocalservice restart
fi

echo "NooBaa installation complete"
