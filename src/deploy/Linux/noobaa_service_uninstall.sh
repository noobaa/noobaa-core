#!/bin/bash
#this script uninstalls the service on linux systems.
#first we find the newest init mechanism, then we uninstall
PATH=/usr/local/noobaa:$PATH;

/usr/local/noobaa/node_modules/forever-service/bin/forever-service delete noobaa_local_service &> /dev/null

echo "Uninstalling NooBaa"
if [ -f /usr/bin/systemctl ] || [ -f /bin/systemctl ]; then
  echo "Systemd detected. Uninstalling service"
  systemctl disable noobaalocalservice
  rm /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service
elif [[ -d /etc/init ]]; then
  echo "Upstart detected. Removing init script"
  initctl stop noobaalocalservice
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
