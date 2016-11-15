#!/bin/bash
#this script uninstalls the service on linux systems.
#first we find the newest init mechanism, then we uninstall
PATH=/usr/local/noobaa:$PATH;

#attempting to remove old service installations
/usr/local/noobaa/node_modules/forever-service/bin/forever-service stop noobaa_local_service &> /dev/null

echo "Uninstalling NooBaa local service"
if [ -f /usr/bin/systemctl ] || [ -f /bin/systemctl ]; then
  echo "Systemd detected. Uninstalling service"
  systemctl stop noobaalocalservice
  systemctl disable noobaalocalservice
  rm /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service
  systemctl daemon-reload
elif [[ -d /etc/init ]]; then
  echo "Upstart detected. Removing init script"
  initctl stop noobaalocalservice
  rm /etc/init/noobaalocalservice.conf
elif [[ -d /etc/init.d ]]; then
  echo "System V detected. Uninstalling service"
  # This command may or may not exist, depending on linux distro
  type chkconfig &> /dev/null
  if [ $? -eq 0 ]; then
    chkconfig noobaalocalservice off
  else
    update-rc.d noobaalocalservice disable
  fi
  service noobaalocalservice stop
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer --uninstall
  rm /etc/init.d/noobaalocalservice
else
  echo "ERROR: Cannot detect init mechanism! Attempting to force service uninstallation"
  service noobaalocalservice stop
  rm /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service
  systemctl daemon-reload
  rm /etc/init/noobaalocalservice.conf
  rm /etc/init.d/noobaalocalservice
  systemctl disable noobaalocalservice
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer --uninstall
fi
