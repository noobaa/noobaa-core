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
  if [ $ignore_rc -ne 1 ]; then
    if [ $rc -ne 0 ]; then
      echo "NooBaa uninstall failed (on $@)"
      exit 1
    fi
  fi
}

function echo_to_log {
  echo $@ >> /var/log/noobaa_service_rem_${instdate}
}

echo_to_log "Uninstalling NooBaa local service"
if [ -f /usr/bin/systemctl ] || [ -f /bin/systemctl ]; then
  echo_to_log "Systemd detected. Uninstalling service"
  verify_command_run systemctl disable noobaalocalservice
  echo_to_log "Service disabled. removing config files"
  #attempting to uninstall bruteforce service installations
  rm /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service >> /var/log/noobaa_service_rem_${instdate} 2>&1
  rm /lib/systemd/system/noobaalocalservice.service
  verify_command_run systemctl daemon-reload
elif [[ -d /etc/init ]]; then
  echo_to_log "Upstart detected. Removing init script"
  initctl stop noobaalocalservice >> /var/log/noobaa_service_rem_${instdate} 2>&1
  rm /etc/init/noobaalocalservice.conf
elif [[ -d /etc/init.d ]]; then
  echo_to_log "System V detected. Uninstalling service"
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
  echo_to_log "ERROR: Cannot detect init mechanism, NooBaa uninstallation failed"
  exit 1
fi
echo_to_log "Uninstalled NooBaa local agent"
exit 0
