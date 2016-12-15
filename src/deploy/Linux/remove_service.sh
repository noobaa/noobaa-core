#!/bin/bash
#this script uninstalls the service on linux systems.
#first we find the newest init mechanism, then we uninstall
PATH=/usr/local/noobaa:$PATH;

echo "uninstalling NooBaa"
instdate=$(date -u +"%m-%d-%H:%M")
echo $(date)

ignore_rc=0

if [ "$1" == "ignore_rc" ]; then
    ignore_rc=1
fi

function verify_command_run {
        $@ >> /var/log/noobaa_service_rem_${instdate} 2>&1
        local rc=$?
        if [ $ignore_rc -eq 1 ]; then
            if [ $rc -ne 0 ]; then
                echo "NooBaa uninstall failed"
                exit 1
            fi
        fi
}

#attempting to remove old service installations
verify_command_run /usr/local/noobaa/node /usr/local/noobaa/node_modules/forever-service/bin/forever-service delete noobaa_local_service

echo "Uninstalling NooBaa local service"
if [ -f /usr/bin/systemctl ] || [ -f /bin/systemctl ]; then
  echo "Systemd detected. Uninstalling service"
  systemctl stop noobaalocalservice >> /var/log/noobaa_service_rem_${instdate} 2>&1
  verify_command_run systemctl disable noobaalocalservice
  rm /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service
  verify_command_run systemctl daemon-reload
elif [[ -d /etc/init ]]; then
  echo "Upstart detected. Removing init script"
  initctl stop noobaalocalservice >> /var/log/noobaa_service_rem_${instdate} 2>&1
  rm /etc/init/noobaalocalservice.conf
elif [[ -d /etc/init.d ]]; then
  echo "System V detected. Uninstalling service"
  # This command may or may not exist, depending on linux distro
  type chkconfig &> /dev/null
  if [ $? -eq 0 ]; then
    verify_command_run chkconfig noobaalocalservice off
  else
    verify_command_run update-rc.d noobaalocalservice disable
  fi
  service noobaalocalservice stop >> /var/log/noobaa_service_rem_${instdate} 2>&1
  /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer --uninstall >> /var/log/noobaa_service_rem_${instdate} 2>&1
  rm /etc/init.d/noobaalocalservice
else
  echo "ERROR: Cannot detect init mechanism, NooBaa uninstallation failed"
  exit 1
fi
