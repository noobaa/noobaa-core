set -e
# TODO copied from first_install_diaglog.sh
isAzure=false
isesx=false
function clean_ifcfg() {
    interfaces=$(ifconfig | grep ^en | awk '{print $1}')
    for int in ${interfaces//:/}; do
        sudo rm /etc/sysconfig/network-scripts/ifcfg-${int}
    done
}

OPTIONS=$( getopt -o 'h,e,a' --long "help,esx,azure" -- "$@" )
eval set -- "${OPTIONS}"

function usage(){
    echo "$0 [options]"
    echo "-e --esx run this script on esx"
    echo "-a --azure run this script on azure"
    echo "-h --help will show this help"
    exit 0
}

while true
do
    case ${1} in
		-a|--azure)     isAzure=true
                        shift 1 ;;
        -e|--esx)       isesx=true
                        shift 1;;
		-h|--help)	    usage;;
		--)			    shift 1;
					    break ;;
    esac
done

if ! ${isAzure} && ! ${isesx}
then
    usage
fi

if ${isAzure}
then
    echo "make sure no swap entry in fstab!"
    cat /etc/fstab
else
    #calling yum upgrade before cleaning the network
    yum upgrade -y 
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
sed -i "s:.*#NooBaa Configured NTP Server.*:#NooBaa Configured NTP Server:" /etc/ntp.conf


#Clean supervisors
sudo cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/noobaa_supervisor.conf /etc/noobaa_supervisor.conf
sudo cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/env.orig /root/node_modules/noobaa-core/.env
supervisorctl reread
supervisorctl reload
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
if ${isAzure}
then
   echo "Azure - will not try to compress HD"
else
    dd if=/dev/zero of=zeroFile.tmp bs=1M
    rm -f zeroFile.tmp
fi
history -c
history -w
