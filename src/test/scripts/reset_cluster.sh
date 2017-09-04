#!/bin/bash
GRACE_TIME=1
HOSTNAME=`hostname`
echo "This server ($(hostname)) will be removed from the cluster in ${GRACE_TIME} seconds. you can still abort"
sleep $GRACE_TIME
echo "removing $(hostname) from the cluster..."

cp -f /root/node_modules/noobaa-core/src/deploy/NVA_build/noobaa_supervisor.conf /etc/noobaa_supervisor.conf
sed -i "s:MONGO_RS_URL.*::" /root/node_modules/noobaa-core/.env
supervisorctl shutdown
supervisord
sleep 5
/usr/bin/mongo nbcore --eval "db.dropDatabase()"
/usr/bin/mongo local --eval "db.dropDatabase()"
supervisorctl shutdown
supervisord