#!/bin/bash

# script to run logrotate every 15 minutes

while true; do
    echo "$(date): =================================== running logrotate ==================================="
    /usr/sbin/logrotate -v /etc/logrotate.d/noobaa 2>&1
    echo
    sleep 900
done