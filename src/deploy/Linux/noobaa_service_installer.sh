#!/bin/bash
#this script installs the service on linux systems.
#first we find the newest init mechanism, then we install
echo "installing NooBaa"
PATH=/usr/local/noobaa:$PATH;
mkdir /usr/local/noobaa/logs

/usr/local/noobaa/node_modules/forever-service/bin/forever-service delete noobaa_local_service &> /dev/null

if [ -f /usr/bin/systemctl ] || [ -f /bin/systemctl ]; then
  echo "Systemd detected. Installing service"
  if [ -f /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service ]; then
    systemctl disable noobaalocalservice
    systemctl stop noobaalocalservice
    rm /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service
    systemctl daemon-reload
  fi

  cp /usr/local/noobaa/src/agent/system_d.conf /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service
  systemctl restart noobaalocalservice
  systemctl enable noobaalocalservice
  systemctl daemon-reload
elif [[ -d /etc/init ]]; then
  echo "Upstart detected. Creating startup script"
  if [ -f /etc/init/noobaalocalservice.conf ]; then
    initctl stop noobaalocalservice
    rm /etc/init/noobaalocalservice.conf
  fi
  cp /usr/local/noobaa/src/agent/upstart.conf /etc/init/noobaalocalservice.conf
  initctl start noobaalocalservice
elif [[ -d /etc/init.d ]]; then
  echo "System V detected. Installing service"
  if [ -f /etc/init.d/noobaalocalservice ]
    service noobaalocalservice stop
    rm /etc/init.d/noobaalocalservice
  fi
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  type chkconfig &> /dev/null
  if [ $? -eq 0 ]; then
    chkconfig noobaalocalservice on
  else
    update-rc.d noobaalocalservice enable
  fi
  service noobaalocalservice start
else
  echo "ERROR: Cannot detect init mechanism! Attempting to force service installation"
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  systemctl enable noobaalocalservice
  cp /usr/local/noobaa/src/agent/noobaalocalservice.conf /etc/init/noobaalocalservice.conf
  if [ $? -eq 0 ]; then
    chkconfig noobaalocalservice on
  else
    update-rc.d noobaalocalservice enable
  fi
  systemctl enable noobaalocalservice
  service noobaalocalservice start
fi

echo "NooBaa installation complete"
