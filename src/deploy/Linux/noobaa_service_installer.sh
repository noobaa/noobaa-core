#!/bin/bash
echo "installing Noobaa"
PATH=/usr/local/noobaa:$PATH;
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer

if [[ $(ps -elf|grep 'systemd+\{0,1\}[ ]\{1,\}[0-9]\{1,\}[ ]\{1,\}1 ') ]]; then
  systemctl enable noobaalocalservice
else
  # TODO: equivilant for UpStart
  echo "upstart enable service"
fi

echo "done here"
