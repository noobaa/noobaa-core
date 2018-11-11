#!/bin/bash
set -ex
# TODO copied from first_install_diaglog.sh
export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'
eval {isAzure,isEsx,isAlyun,isAws,dev}="false"
platform="on_prem"

function clean_ifcfg() {
    # remove all non loopback interfaces (eth\ens are those we know of)
    sudo rm /etc/sysconfig/network-scripts/ifcfg-e*
}

function aws_specific() {
    sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/g' /etc/ssh/sshd_config
    sed -i 's/ChallengeResponseAuthentication yes/ChallengeResponseAuthentication no/g' /etc/ssh/sshd_config
    sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/g' /etc/ssh/sshd_config
    yum install -y cloud-init
    echo "removing root user from /etc/shadow"
    sed -i "/\<root/d" /etc/shadow
    echo "removing Password from all users in /etc/shadow"
    for user in $(cat /etc/shadow | awk -F ":" '{print $1}')
    do
        if [ -f /${user}/.ssh/authorized_keys ]
        then
            echo > /${user}/.ssh/authorized_keys
        fi
        sudo passwd -d ${user}
    done

    truncate -s 0 /root/.ssh/known_hosts
    for folder in $(find / -name authorized_keys|grep .ssh/authorized_keys)
    do
        if [ -f ${folder} ]
        then
            echo > ${folder}
        fi
    done

    shred -u ~/.*history
}

function alyun_specific() {
    chmod 700 /etc/rc.d/init.d/supervisord
    chmod 700  /root/.nvm/nvm.sh
    chmod 700 -R /root/node_modules
    for user in $(cat /etc/shadow | awk -F ":" '{print $1}')
    do
        if [ -f /${user}/.ssh/authorized_keys ]; then
            echo > /${user}/.ssh/authorized_keys
        fi
        sudo passwd -d ${user}
    done
    shred -u ~/.*history
}

function set_NTP() {
    set +x
    # a fix for multiple entries of "NooBaa Configured NTP Server"
    number_of_lines=$(cat /etc/ntp.conf | grep "NooBaa Configured NTP Server" | wc -l)
    if [ ${number_of_lines} -ne 1 ]
    then
        sed -i "/.*NooBaa Configured NTP Server.*/d" /etc/ntp.conf
        echo "#NooBaa Configured NTP Server" >>  /etc/ntp.conf
    fi

    if ${isEsx}
    then 
        sed -i "s:.*#NooBaa Configured NTP Server.*:#NooBaa Configured NTP Server:" /etc/ntp.conf
    else
        ${isAzure} && ntp_server="time.windows.com" || ntp_server="pool.ntp.org"
        sed -i "s/.*NooBaa Configured NTP Server.*/server ${ntp_server} iburst #NooBaa Configured NTP Server/" /etc/ntp.conf
    fi
    set -x
}

OPTIONS=$( getopt -o 'h,e,a,l,w,g,d' --long "help,esx,azure,alyun,aws,google,dev" -- "$@" )
eval set -- "${OPTIONS}"

function usage(){
    echo "$0 [options]"
    echo "-e --esx      run this script on esx"
    echo "-a --azure    run this script on azure"
    echo "-l --alyun    run this script on alyun"
    echo "-w --aws      run this script on aws"
    echo "-g --google   run this script on google"
    echo "-d --dev      will skip md5sum on all platform and dd in esx"
    echo "-h --help     will show this help"
    exit 0
}

while true
do
    case ${1} in
		-a|--azure)     isAzure=true
                        platform=azure
                        shift 1 ;;
        -e|--esx)       isEsx=true
                        platform=esx
                        shift 1;;
        -l|--alyun)     isAlyun=true
                        platform=alyun
                        shift 1;;
        -w|--aws)       isAws=true
                        platform=aws
                        shift 1;;
        -g|--google)    isGoogle=true
                        platform=google
                        shift 1;;
        -d|--dev)       dev=true
                        shift 1;;
		-h|--help)	    usage;;
		--)			    shift 1;
					    break ;;
    esac
done

if [ "${platform}" == "on_prem" ]
then
    usage
fi

#calling yum upgrade before cleaning the network
yum upgrade -y

if ! ${isEsx}
then
    echo "make sure no swap entry in fstab!"
    cat /etc/fstab
else
    #cleaning the network
    clean_ifcfg
    sudo rm /etc/first_install.mrk
fi

sudo rm /etc/noobaa_sec
echo Passw0rd | passwd noobaaroot --stdin
#Clean log file
rm -f /var/log/*.log
rm -f /var/log/*-*
rm -f /var/log/noobaa*
rm -f /var/log/nbfedump/*
rm -f /tmp/supervisor/*
rm -f /tmp/supervisord.log
rm -rf /etc/mongo_ssl/
rm -f /usr/bin/mongors
rm -f /etc/noobaa_network

#Clean platform changes
unlink /etc/localtime
ln -sf /usr/share/zoneinfo/GMT /etc/localtime
date -s "21 Aug 2017 00:00:00"

#Configure 127.0.0.1 as the dns server - we will use named as a dns cache server
echo "prepend domain-name-servers 127.0.0.1 ;" > /etc/dhclient.conf
echo "#NooBaa Configured Search" >> /etc/dhclient.conf
echo "nameserver 127.0.0.1" > /etc/resolv.conf
# reset /etc/sysconfig/network
echo "HOSTNAME=noobaa" > /etc/sysconfig/network
echo "DNS1=127.0.0.1" >> /etc/sysconfig/network
echo "DOMAIN=\"\"" >> /etc/sysconfig/network


#restore /etc/noobaa_configured_dns.conf
echo "forwarders { 8.8.8.8; 8.8.4.4; };" > /etc/noobaa_configured_dns.conf
echo "forward only;" >> /etc/noobaa_configured_dns.conf

cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/named.conf /etc/named.conf

#make sure NetworkManager is disabled and named start on boot, on google start it
if ${isGoogle}
then
    sudo systemctl enable NetworkManager
else
    sudo systemctl disable NetworkManager
fi
sudo systemctl enable named

set_NTP

#Clean /tmp old files
rm -f /tmp/nb_upgrade*
rm -f /tmp/node*
rm -f /tmp/*.log
rm -rf /tmp/npm-*

#Clean /backup
rm -rf /backup

mongo nbcore --eval 'db.dropDatabase()'

#Clean supervisors
sudo cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/noobaa_supervisor.conf /etc/noobaa_supervisor.conf
sudo cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/env.orig /root/node_modules/noobaa-core/.env
echo "PLATFORM=${platform}" >> /root/node_modules/noobaa-core/.env
supervisorctl reread
supervisorctl reload
echo "PLATFORM=${platform}" >> /root/node_modules/noobaa-core/.env

if [ -d /root/node_modules/noobaa-core/agent_storage/ ]; then
    rm -rf /root/node_modules/noobaa-core/agent_storage/
fi
if [ -d /root/node_modules/noobaa-core/noobaa_storage/ ]; then
    rm -rf /root/node_modules/noobaa-core/noobaa_storage/
fi
sleep 15

sudo sed -i "s:Configured IP on this NooBaa Server.*:Configured IP on this NooBaa Server \x1b[0;32;40mNONE\x1b[0m.:" /etc/issue
sudo sed -i "s:This server's secret is.*:No Server Secret:" /etc/issue
sudo sysctl kernel.hostname=noobaa

#reduce VM size
set +e
/sbin/swapoff -a

if ${isAws}
then
    aws_specific
fi

if ${isAlyun}
then
    alyun_specific
fi

if ! ${isEsx}
then
   echo "${platform} - will not try to compress HD"
else
    if ${dev}
    then
        echo "using --dev, skipping zeroFile"
    else
        dd if=/dev/zero of=zeroFile.tmp bs=1M
        rm -f zeroFile.tmp
    fi
fi

history -c
history -w
