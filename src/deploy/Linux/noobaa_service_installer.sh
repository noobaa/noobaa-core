#!/bin/bash
#this script installs the service on linux systems.
#first we find the newest init mechanism, then we install
echo "installing NooBaa"
echo $(date)
PATH=/usr/local/noobaa:$PATH;
echo 1
mkdir /usr/local/noobaa/logs
echo 2
chmod 777 /usr/local/noobaa/remove_service.sh
echo 3
/usr/local/noobaa/remove_service.sh &> /dev/null
echo 4
if [ -f /usr/bin/systemctl ] || [ -f /bin/systemctl ]; then
  echo "Systemd detected. Installing service"
  cp /usr/local/noobaa/src/agent/system_d.conf /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service
  echo 5
  systemctl daemon-reload
  echo 6
  systemctl enable noobaalocalservice
  echo 7
  systemctl start noobaalocalservice
  echo 8
  systemctl daemon-reload
  echo 9
elif [[ -d /etc/init ]]; then
  echo "Upstart detected. Creating startup script"
  cp /usr/local/noobaa/src/agent/upstart.conf /etc/init/noobaalocalservice.conf
  echo 10
  sleep 1
  echo 11
  initctl start noobaalocalservice
  echo 12
elif [[ -d /etc/init.d ]]; then
  echo "System V detected. Installing service"
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  echo 13
  type chkconfig &> /dev/null
  if [ $? -eq 0 ]; then
    echo 14
    chkconfig noobaalocalservice on
  else
    echo 15
    update-rc.d noobaalocalservice enable
  fi
  echo 16
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
