set -e
# TODO copied from first_install_diaglog.sh
function clean_ifcfg() {
  sudo sed -i 's:.*IPADDR=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
  sudo sed -i 's:.*NETMASK=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
  sudo sed -i 's:.*GATEWAY=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
  sudo sed -i 's:.*BOOTPROTO=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
}
if [ "$1" == "azure" ]; then
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
sudo cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/noobaa_supervisor.conf /etc/noobaa_supervisor.conf
supervisorctl reread
supervisorctl reload
rm -rf /root/node_modules/noobaa-core/agent_storage/
sleep 15
mongo nbcore --eval 'db.dropDatabase()'

sudo sed -i "s:Configured IP on this NooBaa Server.*:Configured IP on this NooBaa Server \x1b[0;32;40mNONE\x1b[0m.:" /etc/issue
sudo sed -i "s:This server's secret is.*:No Server Secret:" /etc/issue
#reduce VM size
set +e
/sbin/swapoff -a
dd if=/dev/zero of=zeroFile.tmp
rm -f zeroFile.tmp
history -c
history -w
