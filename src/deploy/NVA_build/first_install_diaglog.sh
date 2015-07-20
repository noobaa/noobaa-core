#!/bin/sh
# First Installation Wizard

trap "" 2 20

. /root/node_modules/noobaa-core/src/deploy/NVA_build/deploy_base.sh

FIRST_INSTALL_MARK="/etc/first_install.mrk"

function clean_ifcfg() {
  sudo sed -i 's:.*IPADDR=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
  sudo sed -i 's:.*NETMASK=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
  sudo sed -i 's:.*GATEWAY=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
  sudo sed -i 's:.*BOOTPROTO=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
}

function fix_network() {
  local test=$(grep eth /etc/udev/rules.d/70-persistent-net.rules|wc -l)
  local curmac=$(ifconfig -a | grep eth | awk '{print $5}')
  if [ "${test}" == "2" ]; then
    sudo sed -i 's:.*NAME="eth0".*::' /etc/udev/rules.d/70-persistent-net.rules
    sudo sed -i 's:\(.*\)NAME="eth1"\(.*\):\1NAME="eth0"\2:' /etc/udev/rules.d/70-persistent-net.rules
    sudo sed -i "s/HWADDR=.*/HWADDR=$curmac/" /etc/sysconfig/network-scripts/ifcfg-eth0
    sudo /sbin/udevadm control --reload-rules
    sudo /sbin/udevadm trigger --attr-match=subsystem=net
    sudo service network restart
  fi
}

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
    #sudo echo "First Install Chose Static IP" >> /var/log/noobaa_deploy.log
    dialog --colors --backtitle "NooBaa First Install" --title "IP Configuration" --form "\nPlease enter the IP address to be used by \Z5\ZbNooBaa\Zn.\nThis
 IP address should be associated with noobaa.local in the DNS." 12 75 4 "IP Address:" 1 1 "" 1 25 25 30 "Netmask:" 2 1 "" 2 25 25 30 "Default Gateway:" 3 1 "" 3 25 25 30 2> answer_ip

    local ip=$(head -1 answer_ip)
    local mask=$(head -2 answer_ip | tail -1)
    local gw=$(tail -1 answer_ip)
    ipcalc -cs ${ip}
    local ok_ip=$?
    validate_mask ${mask}
    local ok_mask=$?
    ipcalc -cs ${gw}
    local ok_gw=$?

    while [ "${ok_ip}" -ne "0" ] || [ "${ok_mask}" -ne "0" ] || [ "${ok_gw}" -ne "0" ]; do
      dialog --colors --backtitle "NooBaa First Install" --title "IP Configuration" --form "\Z1The Provided IP, Netmask or GW are not valid\Zn\n\nPlease enter
 the IP address to be used by \Z5\ZbNooBaa\Zn.\nThis IP address should be associated with noobaa.local in the
 DNS." 12 75 4 "IP Address:" 1 1 "${ip}" 1 25 25 30 "Netmask:" 2 1 "${mask}" 2 25 25 30 "Default Gateway:" 3 1 "${gw}" 3 25 25 30 2> answer_ip

    ip=$(head -1 answer_ip)
    mask=$(head -2 answer_ip | tail -1)
    gw=$(tail -1 answer_ip)
    ipcalc -cs ${ip}
    ok_ip=$?
    validate_mask ${mask}
    ok_mask=$?
    ipcalc -cs ${gw}
    ok_gw=$?

    done

    dialog --colors --backtitle "NooBaa First Install" --infobox "Configuring \Z5\ZbNooBaa\Zn IP..." 4 28 ; sleep 2

    clean_ifcfg
    sudo bash -c "echo 'IPADDR=${ip}'>> /etc/sysconfig/network-scripts/ifcfg-eth0"
    sudo bash -c "echo 'NETMASK=${mask}'>> /etc/sysconfig/network-scripts/ifcfg-eth0"
    sudo bash -c "echo 'GATEWAY=${gw}'>> /etc/sysconfig/network-scripts/ifcfg-eth0"

    dialog --colors --backtitle "NooBaa First Install" --title "DNS Configuration" --form "\nPlease supply a primary and secodnary
 DNS servers." 12 65 4 "Primary DNS:" 1 1 "" 1 25 25 30 "Secondary DNS:" 2 1 "" 2 25 25 30 2> answer_dns

    local dns1=$(head -1 answer_dns)
    local dns2=$(tail -1 answer_dns)

    while [ "${dns1}" == "" ]; do
      dialog --colors --backtitle "NooBaa First Install" --title "DNS Configuration" --form "\nPlease supply a primary and secodnary
   DNS servers." 12 65 4 "Primary DNS:" 1 1 "${dns1}" 1 25 25 30 "Secondary DNS:" 2 1 "{dns2}" 2 25 25 30 2> answer_dns
      dns1=$(head -1 answer_dns)
      #sudo echo "First Install adding dns ${dns}" >> /var/log/noobaa_deploy.log
      dns2=$(tail -1 answer_dns)
    done

    sudo bash -c "echo 'nameserver ${dns1}' > /etc/resolv.conf"
    if [ "${dns2}" -ne "" ]; then
      sudo bash -c "echo 'nameserver ${dns2}' >> /etc/resolv.conf"
      #sudo echo "First Install adding dns ${dns}">> /var/log/noobaa_deploy.log
    fi

  elif [ "${dynamic}" -eq "2" ]; then #Dynamic IP
    #sudo echo "First Install Choose Dynamic IP">> /var/log/noobaa_deploy.log
    clean_ifcfg
    sudo bash -c "echo 'BOOTPROTO=dhcp' >> /etc/sysconfig/network-scripts/ifcfg-eth0"
  fi
  sudo service network restart
  dialog --colors --backtitle "NooBaa First Install" --title "Hostname Configuration" --form "\nPlease supply a hostname for this
 \Z5\ZbNooBaa\Zn installation." 12 65 4 "Hostname:" 1 1 "" 1 25 25 30 2> answer_host

  local host=$(cat answer_host)
  rc=$(sudo sysctl kernel.hostname=${host})
  #sudo echo "First Install configure hostname ${host}, sysctl rc ${rc}" >> /var/log/noobaa_deploy.log

  dialog --colors --backtitle "NooBaa First Install" --infobox "Finalizing \Z5\ZbNooBaa\Zn first install..." 4 40 ; sleep 2

  end_wizard
}

function end_wizard {
  local current_ip=$(ifconfig eth0  |grep 'inet addr' | cut -f 2 -d':' | cut -f 1 -d' ')
  dialog --colors --backtitle "NooBaa First Install" --title '\Z5\ZbNooBaa\Zn is Ready' --msgbox "\n\Z5\ZbNooBaa\Zn was configured and is ready to use. You can access https://${current_ip}:8443 to start using your system." 7 65
  #date > ${FIRST_INSTALL_MARK}
  clear

  trap 2 20
  exit 0
}

fix_network

who=$(whoami)
if [ "$who" != "noobaa" ]; then
  return
fi

if [ ! -f ${FIRST_INSTALL_MARK} ]; then
  #sudo echo "Server was booted, first install mark down not exist. Running first install wizard" >> /var/log/noobaa_deploy.log
  run_wizard
#else
#   sudo echo "Server was booted, first install mark exists" >> /var/log/noobaa_deploy.log
fi

trap 2 20

#logout
