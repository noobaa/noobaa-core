#!/bin/sh
# First Installation Wizard

trap "" 2 20

. /root/node_modules/noobaa-core/src/deploy/NVA_build/deploy_base.sh

FIRST_INSTALL_MARK="/etc/first_install.mrk"

function validate_mask() {
  grep -E -q '^(254|252|248|240|224|192|128)\.0\.0\.0|255\.(254|252|248|240|224|192|128|0)\.0\.0|255\.255\.(254|252|248|240|224|192|128|0)\.0|255\.255\.255\.(254|252|248|240|224|192|128|0)' <<< "$1" && return 0 || return 1
}

function run_wizard {
  dialog --colors --backtitle "NooBaa First Install" --title 'Welcome to \Z5\ZbNooBaa\Zn' --msgbox 'Welcome to your \Z5\ZbNooBaa\Zn experience.\n\nThis
is a short first install wizard to help configure \Z5\ZbNooBaa\Zn to best suit your needs' 8 50

  local current_ip=$(ifconfig eth0  |grep 'inet addr' | cut -f 2 -d':' | cut -f 1 -d' ')

  dialog --colors --backtitle "NooBaa First Install" --menu "Current IP: \Z4\Zb${current_ip}\Zn .\nChoose IP
Assignment:" 12 55 2 1 "Static IP" 2 "Dynamic IP" 2> choice

  local dynamic=$(cat choice)
  local rc

  #Choice of Static IP
  if [ "${dynamic}" -eq "1" ]; then
    deploy_log "First Install Chose Static IP"
    dialog --colors --backtitle "NooBaa First Install" --title "IP Configuration" --form "\nPlease enter the IP address to be used by \Z5\ZbNooBaa\Zn.\nThis
IP address should be associated with noobaa.local in the DNS." 12 75 4 "IP Address:" 1 1 "" 1 25 25 30 "Netmask:" 2 1 "" 2 25 25 30 2> answer_ip

    local ip=$(head -1 answer_ip)
    local mask=$(tail -1 answer_ip)
    ipcalc -cs ${ip}
    local ok_ip=$?
    validate_mask ${mask}
    local ok_mask=$?

    while [ "${ok_ip}" -ne "0" ] || [ "${ok_mask}" -ne "0" ]; do
      dialog --colors --backtitle "NooBaa First Install" --title "IP Configuration" --form "\Z1The Provided IP or Netmask are not valid\Zn\n\nPlease enter
the IP address to be used by \Z5\ZbNooBaa\Zn.\nThis IP address should be associated with noobaa.local in the
DNS." 12 75 4 "IP Address:" 1 1 "${ip}" 1 25 25 30 "Netmask:" 2 1 "${mask}" 2 25 25 30 2> answer_ip

    ip=$(head -1 answer_ip)
    mask=$(tail -1 answer_ip)
    ipcalc -cs ${ip}
    ok_ip=$?
    validate_mask ${mask}
    ok_mask=$?

    done
    deploy_log "First Install Configured IP ${ip} and Netmask ${mask}"

    dialog --colors --backtitle "NooBaa First Install" --infobox "Configuring \Z5\ZbNooBaa\Zn IP..." 4 28 ; sleep 2

    ifconfig eth0 down
    rc=$(ifconfig eth0 ${ip} netmask ${mask} up)
    deploy_log "First Install ifconfig returned ${rc}"
  elif [ "${dynamic}" -eq "2" ]; then #Dynamic IP
    deploy_log "First Install Chose Dyamic IP"
    rc=$(dhclient eth0)
    deploy_log "First Install dhclient returned ${rc}"
  fi

  dialog --colors --backtitle "NooBaa First Install" --title "DNS Configuration" --form "\nPlease supply a primary and secodnary
DNS servers." 12 65 4 "Primary DNS:" 1 1 "" 1 25 25 30 "Secondary DNS:" 2 1 "" 2 25 25 30 2> answer_dns

  local dns=$(head -1 answer_dns)
  echo "nameserver ${dns}" >> /etc/resolv.conf
  deploy_log "First Install adding dns ${dns}"
  dns=$(tail -1 answer_dns)
  echo "nameserver ${dns}" >> /etc/resolv.conf
  deploy_log "First Install adding dns ${dns}"

  dialog --colors --backtitle "NooBaa First Install" --title "Hostname Configuration" --form "\nPlease supply a hostnamr for this
\Z5\ZbNooBaa\Zn installation." 12 65 4 "Hostname:" 1 1 "" 1 25 25 30 2> answer_host

  local host=$(cat answer_host)
  rc=$(sysctl kernel.hostname=${host})
  deploy_log "First Install configure hostname ${host}, sysctl rc ${rc}"

  dialog --colors --backtitle "NooBaa First Install" --infobox "Finalizing \Z5\ZbNooBaa\Zn first install..." 4 40 ; sleep 2

  end_wizard
}

function end_wizard {
  dialog --colors --backtitle "NooBaa First Install" --title '\Z5\ZbNooBaa\Zn is Ready' --msgbox '\n\Z5\ZbNooBaa\Zn was configured and is ready to use' 7 45
  #date > ${FIRST_INSTALL_MARK}
  clear

  trap 2 20
  exit 0
}

who=$(whoami)
if [ "$who" != "noobaa" ]; then
  return
fi

if [ ! -f ${FIRST_INSTALL_MARK} ]; then
  deploy_log "Server was booted, first install mark down not exist. Running first install wizard"
  run_wizard
else
  deploy_log "Server was booted, first install mark exists"
fi

trap 2 20

#logout
