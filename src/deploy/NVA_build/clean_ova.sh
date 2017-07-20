set -e
# TODO copied from first_install_diaglog.sh
function clean_ifcfg() {
    eths=$(ifconfig | grep eth | awk '{print $1}')
    for eth in ${eths}; do
        sudo sed -i 's:.*IPADDR=.*::' /etc/sysconfig/network-scripts/ifcfg-${eth}
        sudo sed -i 's:.*NETMASK=.*::' /etc/sysconfig/network-scripts/ifcfg-${eth}
        sudo sed -i 's:.*GATEWAY=.*::' /etc/sysconfig/network-scripts/ifcfg-${eth}
        sudo sed -i 's:.*BOOTPROTO=.*::' /etc/sysconfig/network-scripts/ifcfg-${eth}
    done
    rm -rf /etc/udev/rules.d/70-persistent-net.rules
}

isAzure=${1}

if [ "${isAzure}" == "azure" ] ; then
    echo "make sure no swap entry in fstab!"
    cat /etc/fstab
else
    clean_ifcfg
fi
sudo rm /etc/noobaa_sec
sudo rm /etc/first_install.mrk
echo Passw0rd | passwd noobaaroot --stdin
rm -f /var/log/*.log
rm -f /var/log/*-*
rm -f /var/log/noobaa*
rm -f /tmp/supervisor/*
rm -rf /etc/mongo_ssl/
rm -f /usr/bin/mongors
rm -f /etc/noobaa_network

sudo cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/noobaa_supervisor.conf /etc/noobaa_supervisor.conf
sudo cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/env.orig /root/node_modules/noobaa-core/.env
supervisorctl reread
supervisorctl reload
rm -rf /root/node_modules/noobaa-core/agent_storage/
sleep 15
mongo nbcore --eval 'db.dropDatabase()'

sudo sed -i "s:Configured IP on this NooBaa Server.*:Configured IP on this NooBaa Server \x1b[0;32;40mNONE\x1b[0m.:" /etc/issue
sudo sed -i "s:This server's secret is.*:No Server Secret:" /etc/issue
sudo sysctl kernel.hostname=noobaa
#reduce VM size
set +e
/sbin/swapoff -a
if [ "${isAzure}" == "azure" ] ; then
   echo "Azure - will not try to compress HD"
else
    dd if=/dev/zero of=zeroFile.tmp bs=1M
    rm -f zeroFile.tmp
fi
history -c
history -w
