#!/bin/bash

# File where rsyslog is going to redirect bucket logs from all endpoints.
touch /var/log/bucket_logs.log
chmod 777 /var/log/bucket_logs.log

# Directory used by logrotate to store rotated bucket_logs.log files
mkdir -p /var/log/noobaa_logs
chmod 777 /var/log/noobaa_logs

# Directory used by noobaa_log_segreagate.sh to keep temporarily segregated bucket logs.
# Maximum size of the bucket log files would be 50K. After that it will be moved to
# /log/noobaa_bucket_logs and a timestamp will be added to the file name.
mkdir -p /var/log/noobaa_bucket_logs
chmod 777 /var/log/noobaa_bucket_logs

# Directory on a mounted volume to keep bucket logs from /var/log/noobaa_bucket_logs.
# This location is shared between core and side card containers.
# These are logs which will be finally uploaded to log bucket.
mkdir -p /log/noobaa_bucket_logs
chmod 777 /log/noobaa_bucket_logs

# PID 1 must install a SIGTERM handler; otherwise Linux ignores SIGTERM and the
# container only dies after kubelet SIGKILL.
# logrotate.sh runs infinite sleep loops that would otherwise keep `wait` blocked.
shutdown_handler() {
    # Signal every other process in this container (sleep loops, rsyslog, logrotate).
    kill -TERM -1 2>/dev/null || true
    wait
    exit 0
}
trap shutdown_handler TERM INT

mkdir -p /var/log/rsyslog
/usr/sbin/rsyslogd -i /var/log/rsyslogd.pid &
/root/node_modules/noobaa-core/src/deploy/NVA_build/logrotate.sh &

wait