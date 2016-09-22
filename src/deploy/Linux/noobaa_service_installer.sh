#!/bin/bash
#this script installs the service on linux systems.
#first we find the newest init mechanism, then we install
echo "installing NooBaa"
PATH=/usr/local/noobaa:$PATH;
mkdir /usr/local/noobaa/logs

/usr/local/noobaa/node_modules/forever-service/bin/forever-service delete noobaa_local_service

if [ -f /usr/bin/systemctl ] || [ -f /bin/systemctl ]; then
  echo "Systemd detected. Installing service"
  systemctl disable noobaalocalservice
  systemctl stop noobaalocalservice
  rm /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service
  cp /usr/local/noobaa/src/agent/system_d.conf /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service
  systemctl enable noobaalocalservice
  systemctl daemon-reload
  systemctl restart noobaalocalservice
elif [[ -d /etc/init ]]; then
  echo "Upstart detected. Creating startup script"
  if [ -f /etc/init/noobaalocalservice.conf ]; then
    echo "Service already installed. Removing old service"
    initctl stop noobaalocalservice
    rm /etc/init/noobaalocalservice.conf
  fi
  cp /usr/local/noobaa/src/agent/upstart.conf /etc/init/noobaalocalservice.conf
  sleep 2
  initctl start noobaalocalservice
elif [[ -d /etc/init.d ]]; then
  echo "System V detected. Installing service"
#  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer --uninstall
#  sleep 5
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  type chkconfig &> /dev/null
  if [ $? -eq 0 ]; then
    chkconfig noobaalocalservice on
  else
    update-rc.d noobaalocalservice enable
  fi
else
  echo "ERROR: Cannot detect init mechanism! Attempting to force service installation"
  if [ -f /etc/init/noobaalocalservice.conf ]; then
    service noobaalocalservice stop
    rm /etc/init/noobaalocalservice.conf
  fi
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer --uninstall
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  systemctl enable noobaalocalservice
  cp /usr/local/noobaa/src/agent/noobaalocalservice.conf /etc/init/noobaalocalservice.conf
  service noobaalocalservice restart
fi

echo "NooBaa installation complete"
