clean_ifcfg
sudo rm /etc/noobaa_sec
sudo rm /etc/first_install.mrk
echo Passw0rd | passwd noobaaroot --stdin
rm -f /var/log/*.log
rm -f /var/log/*-*
rm -f /var/log/noobaa*
rm -f /tmp/supervisor/*
mongo nbcore —eval db.dropDatabase()

sudo sed -i "s:Configured IP on this NooBaa Server.*:Configured IP on this NooBaa Server \x1b[0;32;40mNONE\x1b[0m.:"
sudo sed -i "s:This server's secret is.*:No Server Secret:" /etc/issue
