#!/bin/bash
echo "Uninstalling NooBaa"
if [[ $(ps -elf|grep 'systemd+\{0,1\}[ ]\{1,\}[0-9]\{1,\}[ ]\{1,\}1 ') ]]; then
  echo "No systemd detected. Disabling service"
  systemctl disable noobaalocalservice
else
  echo "No systemd detected. Removing upstart script"
  rm /etc/init/noobaalocalservice.conf
fi

PATH=/usr/local/noobaa:$PATH;
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer --uninstall

rm -rf /usr/local/noobaa
echo "NooBaa agent removed"
