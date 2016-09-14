#!/bin/bash
echo "installing Noobaa"
PATH=/usr/local/noobaa:$PATH;
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_uninstaller
sleep 5
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer

if [[ $(ps -elf|grep 'systemd+\{0,1\}[ ]\{1,\}[0-9]\{1,\}[ ]\{1,\}1 ') ]]; then
  sleep 2
  systemctl enable noobaalocalservice
  systemctl restart noobaalocalservice
else
  # TODO: equivilant for UpStart
  echo "upstart enable service"
fi
