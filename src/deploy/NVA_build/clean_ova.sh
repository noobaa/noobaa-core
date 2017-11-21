set -e
# TODO copied from first_install_diaglog.sh
eval {isAzure,isEsx,isAlyun,isAws}="false"
platform="on_prem"

 function clean_ifcfg() {
    eths=$(ifconfig | grep eth | awk '{print $1}')
    for eth in ${eths}; do
        sudo rm /etc/sysconfig/network-scripts/ifcfg-${eth}
        sudo sed -i "s:.*${eth}.*::" /etc/udev/rules.d/70-persistent-net.rules
    done
}

function aws_specific(){
    sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/g' /etc/ssh/sshd_config
    sed -i 's/ChallengeResponseAuthentication yes/ChallengeResponseAuthentication no/g' /etc/ssh/sshd_config
    sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/g' /etc/ssh/sshd_config
    yum install -y cloud-init
    sudo passwd -l root
    sudo passwd -l noobaaroot
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

    shred -u ~/.*history
}

OPTIONS=$( getopt -o 'h,e,a,l,w' --long "help,esx,azure,alyun,aws" -- "$@" )
eval set -- "${OPTIONS}"

function usage(){
    echo "$0 [options]"
    echo "-e --esx run this script on esx"
    echo "-a --azure run this script on azure"
    echo "-l --alyun run this script on alyun"
    echo "-w --aws run this script on aws"
    echo "-h --help will show this help"
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
		-h|--help)	    usage;;
		--)			    shift 1;
					    break ;;
    esac
done

if ! ${isAzure} && ! ${isEsx} && ! ${isAlyun} && ! ${isAws}
then
    usage
fi

if ! ${isEsx}
then
    echo "make sure no swap entry in fstab!"
    cat /etc/fstab
else
    clean_ifcfg
    sudo rm /etc/first_install.mrk
fi   
sudo rm /etc/noobaa_sec
echo Passw0rd | passwd noobaaroot --stdin
#Clean log file
rm -f /var/log/*.log
rm -f /var/log/*-*
rm -f /var/log/noobaa*
rm -f /tmp/supervisor/*
rm -f /tmp/supervisord.log
rm -rf /etc/mongo_ssl/
rm -f /usr/bin/mongors
rm -f /etc/noobaa_network

#Clean platform changes
unlink /etc/localtime
ln -sf /usr/share/zoneinfo/Pacific/Kiritimati /etc/localtime
date -s "21 Aug 2017 00:00:00"
sed -i "s:.*#NooBaa Configured Primary DNS Server.*:#NooBaa Configured Primary DNS Server:" /etc/resolv.conf
sed -i "s:.*#NooBaa Configured Secondary DNS Server.*:#NooBaa Configured Secondary DNS Server:" /etc/resolv.conf
sed -i "s:.*#NooBaa Configured Search.*:#NooBaa Configured Search:" /etc/resolv.conf
sed -i "s:.*# NooBaa Configured NTP Server.*:# NooBaa Configured NTP Server:" /etc/ntp.conf


#Clean supervisors
sudo cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/noobaa_supervisor.conf /etc/noobaa_supervisor.conf
sudo cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/env.orig /root/node_modules/noobaa-core/.env
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
mongo nbcore --eval 'db.dropDatabase()'

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

if ! ${isEsx}
then
   echo "${platform} - will not try to compress HD"
else
    dd if=/dev/zero of=zeroFile.tmp bs=1M
    rm -f zeroFile.tmp
fi
history -c
history -w
