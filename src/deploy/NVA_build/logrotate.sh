#!/bin/bash

# Add a cron job to run script to segreagate bucket logs into individual bucket logs files.
echo "*/5 * * * * /root/node_modules/noobaa-core/src/deploy/NVA_build/noobaa_log_segregate.sh" | crontab -

# script to run logrotate every minute

while true; do

    echo "$(date): =================================== running logrotate ===================================" >/dev/stdout 2>&1
    /usr/sbin/logrotate -v /etc/logrotate.d/noobaa/logrotate_noobaa.conf >/dev/stdout 2>&1
    echo "$(date): =================================== logrotate Done ======================================" >/dev/stdout 2>&1

    sleep 60

done