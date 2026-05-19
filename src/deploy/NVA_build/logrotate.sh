#!/bin/bash

# Run log segregation every 5 minutes in the background.
# Using a loop instead of crontab because the container runs as a non-root user
# with all capabilities dropped, which prevents writing to /var/spool/cron/.
while true; do
    /root/node_modules/noobaa-core/src/deploy/NVA_build/noobaa_log_segregate.sh
    sleep 300
done &

while true; do

    echo "$(date): =================================== running logrotate ===================================" >/dev/stdout 2>&1
    /usr/sbin/logrotate -v /etc/logrotate.d/noobaa-logrotate >/dev/stdout 2>&1
    echo "$(date): =================================== logrotate Done ======================================" >/dev/stdout 2>&1

    sleep 60

done