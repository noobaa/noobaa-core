#!/bin/bash



dev_mode=$(grep "^DEV_MODE=true" /root/node_modules/noobaa-core/.env | wc -l)
if [ "${dev_mode}" == "0" ]; then
    echo "system snapshot only works in dev mode"
    exit 1
fi

if [ "$1" == "restore" ]; then
    echo "Will restore from /noobaa_snapshot in 10 seconds!!!!"
    sleep 10
    supervisorctl stop all
    echo "Restoring from /noobaa_snapshot"
    echo "copy mongo dbpath from /noobaa_snapshot" 
    mv /var/lib/mongo/cluster/shard1 /noobaa_snapshot/restore_backup/
    /bin/cp -rf /noobaa_snapshot/var/lib/mongo/cluster/shard1 /var/lib/mongo/cluster/

    echo "copy /etc files from /noobaa_snapshot" 
    /bin/cp -rf /noobaa_snapshot/etc/* /etc/

    echo "copy noobaa_core from /noobaa_snapshot" 
    mkdir -p /noobaa_snapshot/restore_backup
    mv /root/node_modules/noobaa-core/ /noobaa_snapshot/restore_backup/
    /bin/cp -rf /noobaa_snapshot/root/node_modules/noobaa-core /root/node_modules/
    supervisorctl reload
    echo "All done"
    
else
    echo "Will remove old snapshot in 10 seconds!!!!"
    sleep 10
    echo "Removing old snapshot!!!!"
    rm -rf /noobaa_snapshot
    supervisorctl stop all
    echo "copy mongo dbpath to /noobaa_snapshot" 
    mkdir -p /noobaa_snapshot/var/lib/mongo/cluster/shard1
    /bin/cp -r /var/lib/mongo/cluster/shard1/* /noobaa_snapshot/var/lib/mongo/cluster/shard1/

    echo "copy /etc files to /noobaa_snapshot" 
    mkdir -p /noobaa_snapshot/etc
    /bin/cp /etc/noobaa_* /noobaa_snapshot/etc/
    /bin/cp /etc/ntp.conf /noobaa_snapshot/etc/
    /bin/cp /etc/yum.conf /noobaa_snapshot/etc/
    /bin/cp /etc/dhclient.conf /noobaa_snapshot/etc/
    /bin/cp -r /etc/mongo_ssl /noobaa_snapshot/etc/

    echo "copy noobaa_core to /noobaa_snapshot" 
    mkdir -p /noobaa_snapshot/root/node_modules/noobaa-core/
    /bin/cp -r /root/node_modules/noobaa-core /noobaa_snapshot/root/node_modules/
    supervisorctl reload
    echo "All done"
fi

