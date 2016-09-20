#!/bin/bash
PATH=/usr/local/noobaa:$PATH;

echo "Uninstalling NooBaa"
if [ -f /usr/bin/systemctl ] || [ -f /bin/systemctl ]; then
  echo "Systemd detected. Uninstalling service"
  systemctl disable noobaalocalservice
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer --uninstall
elif [[ -d /usr/share/upstart ]]; then
  echo "Upstart detected. Removing init script"
  service noobaalocalservice stop
  rm /etc/init/noobaalocalservice.conf
elif [[ -d /etc/init.d ]]; then
  echo "System V detected. Uninstalling service"
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer --uninstall
else
  echo "ERROR: Cannot detect init mechanism! Attempting to force service uninstallation"
  service noobaalocalservice stop
  rm /etc/init/noobaalocalservice.conf
  systemctl disable noobaalocalservice
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer --uninstall
fi


rm -rf /usr/local/noobaa
echo "NooBaa agent removed"
