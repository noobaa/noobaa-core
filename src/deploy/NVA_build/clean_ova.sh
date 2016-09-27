set -e
# TODO copied from first_install_diaglog.sh
function clean_ifcfg() {
  sudo sed -i 's:.*IPADDR=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
  sudo sed -i 's:.*NETMASK=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
  sudo sed -i 's:.*GATEWAY=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
  sudo sed -i 's:.*BOOTPROTO=.*::' /etc/sysconfig/network-scripts/ifcfg-eth0
}
clean_ifcfg
sudo rm /etc/noobaa_sec
sudo rm /etc/first_install.mrk
echo Passw0rd | passwd noobaaroot --stdin
rm -f /var/log/*.log
rm -f /var/log/*-*
rm -f /var/log/noobaa*
rm -f /tmp/supervisor/*
mongo nbcore --eval 'db.dropDatabase()'

sudo sed -i "s:Configured IP on this NooBaa Server.*:Configured IP on this NooBaa Server \x1b[0;32;40mNONE\x1b[0m.:" /etc/issue
sudo sed -i "s:This server's secret is.*:No Server Secret:" /etc/issue
