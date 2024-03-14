#!/bin/bash

help_message="Usage: $0 <log_bucket_range>
This script can be used to test log parsing. It takes number of buckets,
which you want to have logs from. Logs will be sent to /var/log/bucket_logs.log,
which is actually the path where rsyslogd will save the logs. Log buckets will be
having name like log.bucket-1, log.bucket-2, etc. So, to test if the BG worker is
uploading the logs correctly, you need to create buckets with similar names.
Example: $0 10"

if [[ "$1" == "-h" ]]; then
  echo "$help_message"
  exit 0
fi

if [ -z "$1" ]; then
  echo "$help_message"
  exit 1
fi

if [[ ! "$1" =~ ^[0-9]+$ ]]; then
  echo "$help_message"
  exit 1
fi

log_bucket_range=$1

# Initialize log message parts. Trying to emulate the actual logs.
log_time=$(date +"%b %d %H:%M:%S")
log1=' _gateway�| {"noobaa_bucket_logging":"true","op":"PUT","bucket_owner":"admin@noobaa.io","source_bucket":'
log2=',"object_key":"/first.bucket/test.file","log_bucket":'
log3=',"remote_ip":"::ffff:127.0.0.1","request_uri":"/first.bucket/test.file","request_id":"'

log4="first.bucket-"
log5="log.bucket-"

# Just to have some different between log messages, a random request id is being attached.
generate_request_id() {
  head /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 8 | head -n 1
}
request_id=""
create_log_message() {
  local log_bucket_num=$((RANDOM % $log_bucket_range + 1))
  local source_bucket_num=$log_bucket_num
  request_id="xxxxxxxxx"
  echo "$log_time " "$log_time" "$log1" "$log4$source_bucket_num" "$log2" "$log5$log_bucket_num" "$log3" "$request_id"
}
# These logs will be keep generating in infinite loop.use CTRL + C to stop the script.

while true ; do
  log_message=$(create_log_message)
  echo "$log_message" >>/var/log/bucket_logs.log
done