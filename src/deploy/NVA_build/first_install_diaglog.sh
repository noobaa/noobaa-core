# First Installation Wizard
#!/bin/sh

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


function configure_networking_dialog {
      local current_ip=$(ifconfig eth0  |grep 'inet addr' | cut -f 2 -d':' | cut -f 1 -d' ')

      dialog --colors --nocancel --backtitle "NooBaa First Install" --menu "Current IP for \Z4\Zbeth0\Z : \Z4\Zb${current_ip}\Zn .\nChoose IP Assignment (Use \Z4\ZbUp/Down\Zn to navigate):" 12 55 2 1 "Static IP" 2 "Dynamic IP" 2> choice

      local dynamic=$(cat choice)
      local rc

      #Choice of Static IP
      if [ "${dynamic}" -eq "1" ]; then
        #sudo echo "First Install Chose Static IP" >> /var/log/noobaa_deploy.log
        dialog --colors --nocancel --backtitle "NooBaa First Install" --title "IP Configuration" --form "\nPlease enter the IP address to be used by \Z5\ZbNooBaa\Zn.\nThis IP address should be associated with noobaa.local in the DNS (Use \Z4\ZbUp/Down\Zn to navigate)." 12 70 4 "IP Address:" 1 1 "" 1 25 25 30 "Netmask:" 2 1 "" 2 25 25 30 "Default Gateway:" 3 1 "" 3 25 25 30 2> answer_ip

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
          dialog --colors --nocancel --backtitle "NooBaa First Install" --title "IP Configuration" --form "\Z1The Provided IP, Netmask or GW are not valid\Zn\n\nPlease enter the IP address to be used by \Z5\ZbNooBaa\Zn.\nThis IP address should be associated with noobaa.local in the DNS (Use \Z4\ZbUp/Down\Zn to navigate)." 12 70 4 "IP Address:" 1 1 "${ip}" 1 25 25 30 "Netmask:" 2 1 "${mask}" 2 25 25 30 "Default Gateway:" 3 1 "${gw}" 3 25 25 30 2> answer_ip

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

        dialog --colors --nocancel --backtitle "NooBaa First Install" --title "DNS Configuration" --form "\nPlease supply a primary and secondary DNS servers (Use \Z4\ZbUp/Down\Zn to navigate)." 12 80 4 "Primary DNS:" 1 1 "" 1 25 25 30 "Secondary DNS:" 2 1 "" 2 25 25 30 2> answer_dns

        local dns1=$(head -1 answer_dns)
        local dns2=$(tail -1 answer_dns)

        sudo sed -i "s/.*NooBaa Configured Primary DNS Server//" /etc/resolv.conf
        sudo sed -i "s/.*NooBaa Configured Secondary DNS Server//" /etc/resolv.conf

        while [ "${dns1}" == "" ]; do
          dialog --colors --nocancel --backtitle "NooBaa First Install" --title "DNS Configuration" --form "\nPlease supply a primary and secodnary DNS servers (Use \Z4\ZbUp/Down\Zn to navigate)." 12 65 4 "Primary DNS:" 1 1 "${dns1}" 1 25 25 30 "Secondary DNS:" 2 1 "${dns2}" 2 25 25 30 2> answer_dns
          dns1=$(head -1 answer_dns)
          #sudo echo "First Install adding dns ${dns}" >> /var/log/noobaa_deploy.log
          dns2=$(tail -1 answer_dns)
        done

        sudo bash -c "echo 'search localhost.localdomain' > /etc/resolv.conf"
        sudo bash -c "echo 'nameserver ${dns1} #NooBaa Configured Primary DNS Server' >> /etc/resolv.conf"
        if [ "${dns2}" != "" ]; then
          sudo bash -c "echo 'nameserver ${dns2} #NooBaa Configured Secondary DNS Server' >> /etc/resolv.conf"
        fi

      elif [ "${dynamic}" -eq "2" ]; then #Dynamic IP
        dialog --colors --backtitle "NooBaa First Install" --title "IP Configuration" --infobox "Requesting IP from DHCP server. \nDepending on network connectivity and DHCP server availability, this might take a while." 6 60
        clean_ifcfg
        sudo bash -c "echo 'BOOTPROTO=dhcp' >> /etc/sysconfig/network-scripts/ifcfg-eth0"
        dialog --colors --nocancel --backtitle "NooBaa First Install" --title "Using DHCP" --msgbox "Using DHCP is not recommended without adding a DNS name to the server. Please assign a DNS name and configure it in the configuration section in \Z5\ZbNooBaa\Zn GUI." 7 66
      fi
      # Surpressing messages to the console for the cases where DHCP is unreachable.
      # In these cases the network service cries to the log like a little bi#@h
      # and we don't want that.
      sudo dmesg -n 1
      sudo service network restart &> /dev/null
      sudo dmesg -n 3
      ifcfg=$(ifconfig | grep inet | grep -v inet6 | grep -v 127.0.0.1) # ipv4
      if [[ "${dynamic}" -eq "2" && "${ifcfg}" == "" ]]; then
        dialog --colors --nocancel --backtitle "NooBaa First Install" --title "\Zb\Z1ERROR" --msgbox "\Zb\Z1Was unable to get dynamically allocated IP via DHCP" 5 55
      else
        dialog --colors --nocancel --backtitle "NooBaa First Install" --title "Hostname Configuration" --form "\nPlease supply a hostname for this \Z5\ZbNooBaa\Zn installation." 12 65 4 "Hostname:" 1 1 "" 1 25 25 30 2> answer_host

        local host=$(tail -1 answer_host)
        rc=$(sudo sysctl kernel.hostname=${host})
        #sudo echo "First Install configure hostname ${host}, sysctl rc ${rc}" >> /var/log/noobaa_deploy.log
      fi
}




function configure_ntp_dialog {
  local ntp_server=""
  local tz=""
  local tz_file=""
  local err_tz_msg=""
  local err_ntp_msg=""
  local err_tz=1
  local err_ntp=1
  while [ ${err_tz} -eq 1 ] || [ ${err_ntp} -eq 1 ]; do
    dialog --colors --backtitle "NooBaa First Install" --title "NTP Configuration" --form "\nPlease supply an NTP server address and Time Zone (TZ format https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)\nYou can configure NTP later in the management console\n${err_ntp_msg}\n${err_tz_msg}\n(Use \Z4\ZbUp/Down\Zn to navigate)" 15 80 2 "NTP Server:" 1 1 "${ntp_server}" 1 25 25 30  "Time Zone:" 2 1 "${tz}" 2 25 25 30 2> answer_ntp
    ntp_server="$(head -1 answer_ntp)"
    tz=$(tail -1 answer_ntp)
    #check cancel
    local num_lines=$(cat answer_ntp | wc -l)
    if [ ${num_lines} -eq 0 ]; then
      return 0
    fi

    # check server\time zone valid
    if [ -n "${ntp_server}" ]; then
      err_ntp=0
      err_ntp_msg=""
    else
      err_ntp_msg="\Z1NTP Server must be set.\Zn"
    fi

    if [ -z ${tz} ]; then #TZ was not supplied
      err_tz=0
      err_tz_msg=""
    elif [ -f "/usr/share/zoneinfo/${tz}" ]; then
      err_tz=0
      err_tz_msg=""
    else
      err_tz_msg="\Z1Please enter a valid TZ value\Zn"
    fi

  done
    echo "${ntp_server}" > /tmp/ntp

    sudo sed -i "s/.*NooBaa Configured NTP Server.*/server ${ntp_server} iburst #NooBaa Configured NTP Server/" /etc/ntp.conf

    echo "${tz}" > /tmp/tztz
    sudo ln -sf "/usr/share/zoneinfo/${tz}" /etc/localtime
    sudo /sbin/chkconfig ntpd on 2345
    sudo /etc/init.d/ntpd restart
    sudo /etc/init.d/rsyslog restart
}


function reset_password {

    local err_pass=1
    local err_pass_msg=""
    while [ ${err_pass} -eq 1 ]; do

        local number_of_account=$(/usr/bin/mongo nbcore --eval 'db.accounts.count({_id: {$exists: true}})' --quiet)
        if [ ${number_of_account} -lt 2 ]; then
            dialog --colors --nocancel --backtitle "NooBaa First Install" --msgbox "Could not find any account. Please setup a system from the web management first" 8 40
            return 0
        fi

        local user_name=$(/usr/bin/mongo nbcore --eval 'db.accounts.find({email:{$ne:"support@noobaa.com"}},{email:1,_id:0}).sort({_id:-1}).limit(1).map(function(u){return u.email})[0]' --quiet)

        local answer_reset_password=$(dialog --colors --backtitle "NooBaa First Install" --title "Password Reset for ${user_name}"  --passwordbox "Password enter a new password (your input is hidden):\n${err_pass_msg}"  10 50 --stdout)

        case $answer_reset_password in
            ''|*[!0-9]*) err_pass=0 ;;
            *) err_pass_msg="error: password cannot be a number"  ;;
        esac

    done

    local bcrypt_sec=$(sudo /usr/local/bin/node /root/node_modules/noobaa-core/src/util/crypto_utils.js --bcrypt_password $answer_reset_password)
    /usr/bin/mongo nbcore --eval  "db.accounts.update({email:'${user_name}'},{\$set:{password:'${bcrypt_sec}'}})" --quiet


}

function run_wizard {

  dialog --colors --backtitle "NooBaa First Install" --title 'Welcome to \Z5\ZbNooBaa\Zn' --msgbox 'Welcome to your \Z5\ZbNooBaa\Zn experience.\n\nThis
is a short first install wizard to help configure \Z5\ZbNooBaa\Zn to best suit your needs' 8 60
  local menu_entry="0"
  while [ "${menu_entry}" -ne "4" ]; do
    dialog --colors --nocancel --backtitle "NooBaa First Install" --menu "Choose one of the items below\n(Use \Z4\ZbUp/Down\Zn to navigate):" 12 55 4 1 "Networking Configuration" 2 "NTP Configuration (Optional)" 3 "Password reset" 4 "Exit" 2> choice
    menu_entry=$(cat choice)
  if [ "${menu_entry}" -eq "1" ]; then
    configure_networking_dialog
    /usr/bin/supervisorctl restart all #Restart services after IP and DNS changes
  elif [ "${menu_entry}" -eq "2" ]; then
    configure_ntp_dialog
  elif [ "${menu_entry}" -eq "3" ]; then
    reset_password
  fi
  done
  dialog --colors --nocancel --backtitle "NooBaa First Install" --infobox "Finalizing \Z5\ZbNooBaa\Zn first install..." 4 40 ; sleep 2

  end_wizard
}

function end_wizard {
  local current_ip=$(ifconfig eth0  |grep 'inet addr' | cut -f 2 -d':' | cut -f 1 -d' ')
  dialog --colors --nocancel --backtitle "NooBaa First Install" --title '\Z5\ZbNooBaa\Zn is Ready' --msgbox "\n\Z5\ZbNooBaa\Zn was configured and is ready to use. You can access \Z5\Zbhttp://${current_ip}:8080\Zn to start using your system." 7 65
  date | sudo tee -a ${FIRST_INSTALL_MARK}
  clear

  sudo sed -i "s:Configured IP on this NooBaa Server.*:Configured IP on this NooBaa Server \x1b[0;32;40m${current_ip}\x1b[0m:" /etc/issue

  trap 2 20
  exit 0
}

function verify_wizard_run {
  dialog --colors --backtitle "NooBaa First Install" --title 'Welcome to \Z5\ZbNooBaa\Zn' \
    --defaultno --yesno '\n\Z5\ZbNooBaa\Zn was already configured on this machine.\nAre you sure you wish to override the previous configuration ?' 8 70
  local response=$?
  case $response in
     0)
        run_wizard
        ;;
     1)
        trap 2 20
        exit 0
        ;;
  esac
}

fix_network

who=$(whoami)
if [ "$who" = "noobaa" ]; then
  if [ ! -f ${FIRST_INSTALL_MARK} ]; then
    #sudo echo "Server was booted, first install mark down not exist. Running first install wizard" >> /var/log/noobaa_deploy.log
    run_wizard
  else
    verify_wizard_run
  fi
fi


trap 2 20

#logout
