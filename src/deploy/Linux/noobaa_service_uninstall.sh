#!/bin/bash
echo "Uninstalling NooBaa"
if [[ $(ps -elf|grep 'systemd+\{0,1\}[ ]\{1,\}[0-9]\{1,\}[ ]\{1,\}1 ') ]]; then
  systemctl disable noobaalocalservice
  sleep 5
else
  # TODO: equivilant for UpStart
  echo upstart disable service
fi

PATH=/usr/local/noobaa:$PATH;
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_uninstaller

rm -rf /usr/local/noobaa
echo "Done"
