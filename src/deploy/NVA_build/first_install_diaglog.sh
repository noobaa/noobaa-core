# First Installation Wizard
#!/bin/sh
export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'
trap "" 2 20

FIRST_INSTALL_MARK="/etc/first_install.mrk"
NOOBAANET="/etc/noobaa_network"

function prepare_ifcfg() {
  local interface=${1}
  local curmac=$(cat /sys/class/net/${interface}/address)
  local uuid=$(uuidgen)
  # reset ifcfg file to an initial state
  sudo bash -c "echo 'DEVICE=${interface}'> /etc/sysconfig/network-scripts/ifcfg-${interface}"
  sudo bash -c "echo 'HWADDR=${curmac}'>> /etc/sysconfig/network-scripts/ifcfg-${interface}"
  sudo bash -c "echo 'TYPE=Ethernet'>> /etc/sysconfig/network-scripts/ifcfg-${interface}"
  sudo bash -c "echo 'UUID=${uuid}'>> /etc/sysconfig/network-scripts/ifcfg-${interface}"
  sudo bash -c "echo 'ONBOOT=yes'>> /etc/sysconfig/network-scripts/ifcfg-${interface}"
  sudo bash -c "echo 'DNS1=127.0.0.1'>> /etc/sysconfig/network-scripts/ifcfg-${interface}"
  sudo bash -c "echo 'DOMAIN=\"\"'>> /etc/sysconfig/network-scripts/ifcfg-${interface}"
  sudo ifconfig ${interface} up
}

function validate_mask() {
  grep -E -q '^(254|252|248|240|224|192|128)\.0\.0\.0|255\.(254|252|248|240|224|192|128|0)\.0\.0|255\.255\.(254|252|248|240|224|192|128|0)\.0|255\.255\.255\.(254|252|248|240|224|192|128|0)' <<< "$1" && return 0 || return 1
}

function configure_interface_ip() {
    local interface=$1
    local current_ip=$(ifconfig ${interface} | grep -w 'inet' | awk '{print $2}')

    dialog --colors --nocancel --backtitle "NooBaa First Install" --menu "Current IP for \Z4\Zb${interface}\Z : \Z4\Zb${current_ip}\Zn .\nChoose IP Assignment (Use \Z4\ZbUp/Down\Zn to navigate):" 12 55 3 1 "Static IP" 2 "Dynamic IP" 3 "Exit" 2> choice

    local dynamic=$(cat choice)
    local rc

    #Choice of Static IP
    if [ "${dynamic}" -eq "1" ]; then
      #sudo echo "First Install Chose Static IP" >> /var/log/noobaa_deploy.log
      dialog --colors --backtitle "NooBaa First Install" --title "IP Configuration" --form "\nPlease enter the IP address to be used by \Z5\ZbNooBaa\Zn.\nThis IP address should be associated with noobaa.local in the DNS (Use \Z4\ZbUp/Down\Zn to navigate)." 12 70 4 "IP Address:" 1 1 "" 1 25 25 30 "Netmask:" 2 1 "" 2 25 25 30 "Default Gateway:" 3 1 "" 3 25 25 30 2> answer_ip

      #check if cancel was selected
      if [ $? -ne 0 ]; then
        return
      fi
      
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
      prepare_ifcfg $interface
      sudo bash -c "echo 'IPADDR=${ip}'>> /etc/sysconfig/network-scripts/ifcfg-${interface}"
      sudo bash -c "echo 'NETMASK=${mask}'>> /etc/sysconfig/network-scripts/ifcfg-${interface}"
      sudo bash -c "echo 'GATEWAY=${gw}'>> /etc/sysconfig/network-scripts/ifcfg-${interface}"
      sudo bash -c "echo 'BOOTPROTO=none' >> /etc/sysconfig/network-scripts/ifcfg-${interface}"

    elif [ "${dynamic}" -eq "2" ]; then #Dynamic IP
      prepare_ifcfg $interface
      sudo bash -c "echo 'BOOTPROTO=dhcp' >> /etc/sysconfig/network-scripts/ifcfg-${interface}"
      dialog --colors --nocancel --backtitle "NooBaa First Install" --title "Using DHCP" --msgbox "Using DHCP is not recommended without adding a DNS name to the server. Please assign a DNS name and configure it in the configuration section in \Z5\ZbNooBaa\Zn GUI." 7 66
      dialog --colors --backtitle "NooBaa First Install" --title "IP Configuration" --infobox "Requesting IP from DHCP server. \nDepending on network connectivity and DHCP server availability, this might take a while." 6 40
    fi

    # Surpressing messages to the console for the cases where DHCP is unreachable.
    # In these cases the network service cries to the log like a little bi#@h
    # and we don't want that.
    if [ ! "${dynamic}" -eq "3" ]; then
      sudo dmesg -n 1
      sudo service network restart &> /dev/null
      sudo dmesg -n 3
      ifcfg=$(ifconfig | grep -w inet | grep -v 127.0.0.1) # ipv4
      if [[ "${dynamic}" -eq "2" && "${ifcfg}" == "" ]]; then
        dialog --colors --nocancel --backtitle "NooBaa First Install" --title "\Zb\Z1ERROR" --msgbox "\Zb\Z1Was unable to get dynamically allocated IP via DHCP" 5 55
      fi
    fi

    local new_ip=$(ifconfig | grep -w 'inet' | grep -v 127.0.0.1 | awk '{print $2}')
    if [ "${new_ip}" != "${current_ip}" ] && [ ps -ef | grep mongod | grep -q "\-\-replSet" ]; then
      dialog --colors --nocancel --backtitle "NooBaa First Install" --title "\Zb\Z1WARNING" --msgbox "\Zb\Z1\nThe interface IP was changed and this server is part of cluster!\n
      if the is the IP you use for your cluster - Go to cluster screen - find this server and change its IP in Change IP action" 7 55
    fi
}

function configure_ips_dialog {
    local interfaces=$(ifconfig -a | grep ^eth | awk '{print $1}')
    interfaces=${interfaces//:/}
    local str=""
    IFS=$'\n'
    count=0
    for interface in $interfaces
    do
      count=$((count+1))
      str="$str $count $interface"
    done
    unset IFS

    count=$((count+1))
    str="$str $count Exit"

    echo "out of for loop $str"
    while [ "${menu_entry}" -ne ${count} ]; do
      dialog --colors --nocancel --backtitle "NooBaa First Install" --menu "Configure one or more of the interfaces below\n(Use \Z4\ZbUp/Down\Zn to navigate):" 12 55 $count $str 2> choice
      menu_entry=$(cat choice)
      local count2=0
      for item in $interfaces
      do
        count2=$((count2+1))
        if [ "${menu_entry}" -eq $count2 ]; then
          configure_interface_ip $item
        fi
      done
    done
}

function configure_dns_dialog {
    local cur_dns=($(grep forwarders /etc/noobaa_configured_dns.conf | awk -F "{" '{print $2}' | awk -F "}" '{print $1}' | awk -F ";" '{print $1" " $2}'))
    local dns1=${cur_dns[0]}
    local dns2=${cur_dns[1]}
    local error=0
    ok_dns1=1
    cancel=0 
    
    while [ $ok_dns1 -eq 1 ] && [ $cancel -eq 0 ]; do
      if [ ${error} -eq 1 ]; then
        dialog --colors --backtitle "NooBaa First Install" --title "DNS Configuration" --form "\n\Z1Primary DNS server is not valid\Zn\nPlease supply a primary and secondary DNS servers (Use \Z4\ZbUp/Down\Zn to navigate)." 12 65 4 "Primary DNS:" 1 1 "${dns1}" 1 25 25 30 "Secondary DNS:" 2 1 "${dns2}" 2 25 25 30 2> answer_dns
      elif [ ${error} -eq 2 ]; then
        dialog --colors --backtitle "NooBaa First Install" --title "DNS Configuration" --form "\n\Z1Secondary DNS server is not valid\Zn\nPlease supply a primary and secondary DNS servers (Use \Z4\ZbUp/Down\Zn to navigate)." 12 65 4 "Primary DNS:" 1 1 "${dns1}" 1 25 25 30 "Secondary DNS:" 2 1 "${dns2}" 2 25 25 30 2> answer_dns
      else
        dialog --colors --backtitle "NooBaa First Install" --title "DNS Configuration" --form "\nPlease supply a primary and secondary DNS servers (Use \Z4\ZbUp/Down\Zn to navigate)." 12 65 4 "Primary DNS:" 1 1 "${dns1}" 1 25 25 30 "Secondary DNS:" 2 1 "${dns2}" 2 25 25 30 2> answer_dns
      fi
      cancel=$?
      if [ $cancel -eq 0 ] ; then #ok press
        dns1=$(head -1 answer_dns)
        if [ -z ${dns1}]; then
          error=1
          continue
        fi
        ipcalc -cs ${dns1}
        ok_dns1=$?
        if [ $ok_dns1 -eq 1 ] ; then
          error=1
          continue
        fi
        local num_lines=$(cat answer_ntp | wc -l)
        if [ $num_lines -eq 1]; then
          continue
        fi
        dns2=$(tail -1 answer_dns)
        ipcalc -cs ${dns2}
        ok_dns2=$?
        # sudo bash -c "echo 'search localhost.localdomain' > /etc/resolv.conf"
        if [ -n ${dns2} -a $ok_dns2 -eq 1 ]; then
            ok_dns1=1
            error=2
            continue
        fi
        if [ -n ${dns2} ]; then
          echo "updating both" >> /tmp/dns #NBNB
          sudo bash -c "echo \"forwarders { ${dns1}; ${dns2}; };\" > /etc/noobaa_configured_dns.conf"
        else
          echo "updating one" >> /tmp/dns #NBNB
          sudo bash -c "echo \"forwarders { ${dns1}; };\" > /etc/noobaa_configured_dns.conf"
        fi
        
        sudo bash -c "echo \"forward only;\" >> /etc/noobaa_configured_dns.conf"
        sudo dmesg -n 1 # need to restart network to update /etc/resolv.conf - supressing too much logs
        sudo systemctl restart named &> /dev/null
        sudo dmesg -n 3
      fi
    done
}

function configure_hostname_dialog {
    local current_name=$(hostname)
    dialog --colors --nocancel --backtitle "NooBaa First Install" --title "Hostname Configuration" --form "\nPlease supply a hostname for this \Z5\ZbNooBaa\Zn installation." 12 65 4 "Hostname:" 1 1 "${current_name}" 1 25 25 30 2> answer_host

    local host=$(tail -1 answer_host)
    rc=$(sudo sysctl kernel.hostname=${host})
    if [ -f /etc/sysconfig/network ]; then
      if ! grep -q HOSTNAME /etc/sysconfig/network; then
        sudo echo "HOSTNAME=${host}" >> /etc/sysconfig/network
      else
        sudo sed -i "s:HOSTNAME=.*:HOSTNAME=${host}:" /etc/sysconfig/network
      fi
    else
        sudo echo "HOSTNAME=${host}" >> /etc/sysconfig/network
    fi
}

function configure_networking_dialog {
    local menu_entry="0"
    while [ "${menu_entry}" -ne "4" ]; do
      dialog --colors --nocancel --backtitle "NooBaa First Install" --menu "Choose one of the items below\n(Use \Z4\ZbUp/Down\Zn to navigate):" 12 55 4 1 "Configure interface IP" 2 "DNS Settings" 3 "Hostname Settings" 4 "Exit" 2> choice
      menu_entry=$(cat choice)
      if [ "${menu_entry}" -eq "1" ]; then
        configure_ips_dialog
        sudo /usr/bin/supervisorctl restart all 1> /dev/null #Restart services after IP and DNS changes
      elif [ "${menu_entry}" -eq "2" ]; then
        configure_dns_dialog
        sudo /usr/bin/supervisorctl restart all 1> /dev/null #Restart services after IP and DNS changes
      elif [ "${menu_entry}" -eq "3" ]; then
        configure_hostname_dialog
      fi
    done
}


function generate_entropy(){
    local path
    echo "Generate entropy for /dev/random (openssl and such) for 5m"
    for path in $(find /dev/disk/by-uuid/ -type l)
    do
        sudo md5sum ${path}
    done &
    pid=$!
    sleep 300
    sudo kill -9 ${pid} 2> /dev/null
}

function configure_ntp_dialog {
  local ntp_server=$(grep "server.*NooBaa Configured" /etc/ntp.conf | sed 's:.*server \(.*\) iburst.*:\1:')
  local tz=$(ls -la /etc/localtime  | sed 's:.*/usr/share/zoneinfo/\(.*\):\1:')
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
      sudo unlink /etc/localtime
      err_tz=0
      err_tz_msg=""
      sudo ln -sf "/usr/share/zoneinfo/${tz}" /etc/localtime
    else
      err_tz_msg="\Z1Please enter a valid TZ value\Zn"
    fi

  done
    echo "${ntp_server}" > /tmp/ntp

    sudo sed -i "s/.*NooBaa Configured NTP Server//" /etc/ntp.conf
    sudo bash -c "echo 'server ${ntp_server} iburst #NooBaa Configured NTP Server' >> /etc/ntp.conf"
    sudo /sbin/chkconfig ntpd on 2345
    sudo systemctl restart ntpd.service > /dev/null 2>&1
    sudo systemctl restart rsyslog > /dev/null 2>&1
    sudo /etc/init.d/supervisord restart > /dev/null 2>&1
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

    local bcrypt_sec=$(sudo /usr/local/bin/node /root/node_modules/noobaa-core/src/tools/bcrypt_cli.js "$answer_reset_password")
    /usr/bin/mongo nbcore --eval  "db.accounts.update({email:'${user_name}'},{\$set:{password:'${bcrypt_sec}'}})" --quiet

}

function resize_hd {

  dialog --colors --backtitle "NooBaa First Install" --infobox "Resizing HD, this might take some time" 4 42
  logger -p local0.info -s -t resize_fs_on_sda "Starting ..."
  logger -p local0.info -s -t resize_fs_on_sda "Running fdisk -s /dev/sda: $(sudo fdisk -s /dev/sda)"
  logger -p local0.info -s -t resize_fs_on_sda "Running fdisk -s /dev/sda2: $(sudo fdisk -s /dev/sda2)"
  logger -p local0.info -s -t resize_fs_on_sda "Running fdisk -l:"
  logger -p local0.info -s -t resize_fs_on_sda "$(sudo fdisk -l)"
  logger -p local0.info -s -t resize_fs_on_sda "Running lvs:"
  logger -p local0.info -s -t resize_fs_on_sda "$(sudo lvs)"
  logger -p local0.info -s -t resize_fs_on_sda "Running pvs:"
  logger -p local0.info -s -t resize_fs_on_sda "$(sudo pvs)"
  logger -p local0.info -s -t resize_fs_on_sda "Running df:"
  logger -p local0.info -s -t resize_fs_on_sda "$(sudo df)"

  logger -p local0.info -s -t resize_fs_on_sda "Running fdisk to resize sda2 partition and reboot ..."
  echo -e "d\n2\nn\np\n2\n\n\nw\n" | sudo fdisk -cu /dev/sda
  logger -p local0.info -s -t resize_fs_on_sda "Running fdisk -l after repartitioning:"
  logger -p local0.info -s -t resize_fs_on_sda "$(sudo fdisk -l)"
  dialog --colors --backtitle "NooBaa First Install" --infobox "Rebooting Machine" 4 22; sleep 2
  sudo reboot; sleep 60

}

function apply_resize  {

  dialog --colors --backtitle "NooBaa First Install" --infobox "Applying resize changes" 4 28
  logger -p local0.info -s -t fix_server_plat "Running lvs (PRE):"
  logger -p local0.info -s -t fix_server_plat "$(sudo lvs)"
  logger -p local0.info -s -t fix_server_plat "Running pvs (PRE):"
  logger -p local0.info -s -t fix_server_plat "$(sudo pvs)"
  sudo pvresize /dev/sda2
  sudo lvextend --resizefs -l +100%FREE /dev/VolGroup/lv_root
  logger -p local0.info -s -t fix_server_plat "Running lvs (POST):"
  logger -p local0.info -s -t fix_server_plat "$(sudo lvs)"
  logger -p local0.info -s -t fix_server_plat "Running pvs (POST):"
  logger -p local0.info -s -t fix_server_plat "$(sudo pvs)"
  dialog --colors --backtitle "NooBaa First Install" --infobox "Done" 4 8 ; sleep 2

}

function update_ips_etc_issue {
  ips=""
  while read line ; do
    ips="${ips}, ${line}"
  done < <(ifconfig | grep -w 'inet' | grep -v 127.0.0.1 | awk '{print $2}')
  ips=${ips##,} # removing last comma
  sudo sed -i "s:Configured IP on this NooBaa Server.*:Configured IP on this NooBaa Server \x1b[0;32;40m${ips}\x1b[0m:" /etc/issue
}

function update_noobaa_net {
  sudo bash -c "> ${NOOBAANET}"
  interfaces=$(ifconfig -a | grep ^eth | awk '{print $1}')
  interfaces=${interfaces//:/}
  for int in ${interfaces}; do
      sudo bash -c "echo ${int} >> ${NOOBAANET}"
  done
}

function run_wizard {
  dialog --colors --backtitle "NooBaa First Install" --title 'Welcome to \Z5\ZbNooBaa\Zn' --msgbox 'Welcome to your \Z5\ZbNooBaa\Zn experience.\n\nThis
is a short first install wizard to help configure \n\Z5\ZbNooBaa\Zn to best suit your needs' 8 60
  local menu_entry="0"
  while [ "${menu_entry}" -ne "6" ]; do
    dialog --colors --nocancel --backtitle "NooBaa First Install" --menu "Choose one of the items below\n(Use \Z4\ZbUp/Down\Zn to navigate):" 14 57 6 1 "Networking Configuration" 2 "NTP Configuration (optional)" 3 "Password reset" 4 "Resize Partition (requires reboot)" 5 "Resize FS (after partition was resized)" 6 "Exit" 2> choice
    menu_entry=$(cat choice)
  if [ "${menu_entry}" -eq "1" ]; then
    configure_networking_dialog
  elif [ "${menu_entry}" -eq "2" ]; then
    configure_ntp_dialog
  elif [ "${menu_entry}" -eq "3" ]; then
    reset_password
  elif [ "${menu_entry}" -eq "4" ]; then
    resize_hd
  elif [ "${menu_entry}" -eq "5" ]; then
    apply_resize
  fi
  done
  dialog --colors --nocancel --backtitle "NooBaa First Install" --infobox "Finalizing \Z5\ZbNooBaa\Zn first install..." 4 40 ; sleep 2

  end_wizard
}

function end_wizard {
  nohup bash -c generate_entropy &
  local current_ip=$(ifconfig | grep -w 'inet' | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)
  dialog --colors --nocancel --backtitle "NooBaa First Install" --title '\Z5\ZbNooBaa\Zn is Ready' --msgbox "\n\Z5\ZbNooBaa\Zn was configured and is ready to use.\nYou can access \Z5\Zbhttp://${current_ip}:8080\Zn to start using your system." 7 72
  date | sudo tee -a ${FIRST_INSTALL_MARK} &> /dev/null
  update_noobaa_net
  update_ips_etc_issue
  clear

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

who=$(whoami)
export -f generate_entropy
if [ "$who" = "noobaa" ]; then
  echo ======$(date)====== >> /tmp/noobaa_wizard.log
  exec 2>> /tmp/noobaa_wizard.log
  set -x
  if [ ! -f ${FIRST_INSTALL_MARK} ]; then
    #sudo echo "Server was booted, first install mark down not exist. Running first install wizard" >> /var/log/noobaa_deploy.log
    run_wizard
  else
    verify_wizard_run
  fi
  set +x
fi


trap 2 20

#logout
