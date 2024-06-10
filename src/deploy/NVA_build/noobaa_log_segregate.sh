#!/bin/bash

# /var/log/noobaa_logs will have all the rotated bucket_logs.log files.
# Each log file will be having a timestamp appended to it based on the
# time it was rotated by logrotate. These log files will be holding logs
# from all the endpoints for all the buckets.
# We need to segregate these logs based on the log bucket name and put it
# into respective log files. These files will be moved to the final location
# /log/noobaa_bucket_logs/ which will be scanned by the background worker.

log_dir="/var/log/noobaa_logs"
NOOBAA_BUCKET_LOGS_DIR="/var/log/noobaa_bucket_logs/"
NOOBAA_BUCKET_LOGS_FINAL="/log/noobaa_bucket_logs/"
BUCKET_LOG_FILE_SIZE_LIMIT=51200
# Delimiter for the file name. To separate the file name from the timestamp.
# S3 Bucket name are not allowed to have "_" in its name.
# https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html

File_Name_Del="_"

# Lock file to make sure that the script is not running multiple times.
lock_file="/var/log/noobaa_bucket_logs/noobaa_log_segregate.lock"

# It might happen that some bucket logs in NOOBAA_BUCKET_LOGS_DIR are less than 50KB.
# We need to have a time interval after which we have to move these logs to final location
# to make sure timly transfer of logs.
# For now, we will wait for 5 minutes before we move bucket logs, which are
# smaller than 50K, to final log location.
NOOBAA_BUCKET_LOGS_WAIT_TIME=300

if [ -e "$lock_file" ]; then
    echo "Script is already running. Exiting."
    exit
fi

remove_lock_file() {
    if [ -e "$lock_file" ]; then
        rm "$lock_file"
    fi
    exit
}

#make sure clean up of the lock file in case it gets killed.
trap 'remove_lock_file; exit' SIGINT SIGTERM
touch "$lock_file"

# Get the oldest log file in the /var/log/noobaa_logs directory
# by iterating over all the files in the directory that start with
# bucket_logs.log and finding the one with the earliest modification
# time.
oldest_log_file() {
    cd "$log_dir" || remove_lock_file
    earliest_filename=""
    for file in bucket_logs.log*; do
        if [ -z "$earliest_filename" ] || [ "$file" \< "$earliest_filename" ]; then
            earliest_filename="$file"
        fi
    done
    echo "$earliest_filename"
}

move_old_small_bucket_logs() {
    current_time=$(date +%s)
    for filename in "/var/log/noobaa_bucket_logs/"*.log; do

        timestamp=$(echo "$filename" | sed -E 's/.*_([0-9]{10}).log/\1/')
        time_diff=$((current_time - timestamp))
        if [[ $time_diff -gt $NOOBAA_BUCKET_LOGS_WAIT_TIME ]]; then
            mv "$filename" "$NOOBAA_BUCKET_LOGS_FINAL"
            echo "File older than 300 seconds: $filename : $time_diff seconds" >> /tmp/logs
        fi
    done
}

if [ ! -d "$log_dir" ] || [ -z "$(ls -A "$log_dir")" ]; then
    echo "log_dir $log_dir does not exist or is empty."
    move_old_small_bucket_logs
    remove_lock_file
fi

while [ -n "$(ls -A "$log_dir")" ]; do
    log_file=$(oldest_log_file)
    mv "$log_dir/$log_file" "$log_dir/$log_file.processing"
    log_file="$log_dir/$log_file.processing"
    # Iterate over each log records in the log file and do the following -
    # - Fetch the log bucket name from the log entry.
    # - Fetch the source bucket name from the log entry.
    # - Create a file based on this log bucket name and source bucket name.
    # - Check if the file is not there.
    # - append the current timestamp to the file name.
    # - Append the log entries to this file.
    # - Check the size of this file, if it is 50KB, move it to final location.
    # - Remove the log file once all log entries are processed.
    while read -r log; do
        IFS=, read -r -a log_fields <<< "$log"
        log_bucket_name=""
        source_bucket_name=""
        bucket_log_file=""
        existing_log_file=""
        for log_field in "${log_fields[@]}"; do
            if [[ "$log_field" =~ "log_bucket" ]]; then
                IFS=: read -r -a log_values <<< "$log_field"
                log_bucket_name=$(echo "${log_values[1]}" | tr -d '"' | sed 's/^[ \t]*//; s/[ \t]*$//')
                            continue
            fi

            if [[ "$log_field" =~ "source_bucket" ]]; then
                IFS=: read -r -a source_values <<< "$log_field"
                source_bucket_name=$(echo "${source_values[1]}" | tr -d '"' | sed 's/^[ \t]*//; s/[ \t]*$//')
                continue
            fi

        done
        if [[ $log_bucket_name && $source_bucket_name ]]; then

            log_bucket_name="$source_bucket_name$File_Name_Del$log_bucket_name"
            existing_log_file=$(find $NOOBAA_BUCKET_LOGS_DIR -type f -name "$log_bucket_name*" -print | head -n 1)

            if [[ -n "$existing_log_file" ]]; then
                bucket_log_file=$(basename "$existing_log_file")
            else
                time_string=$(date +%s)
                bucket_log_file="$log_bucket_name$File_Name_Del$time_string.log"
            fi

            bucket_log_file="$NOOBAA_BUCKET_LOGS_DIR$bucket_log_file"
            echo "$log" >> "$bucket_log_file"
            file_size=$(stat -c "%s" "$bucket_log_file")

            if [[ $file_size -gt $BUCKET_LOG_FILE_SIZE_LIMIT ]]; then
                mv "$bucket_log_file" "$NOOBAA_BUCKET_LOGS_FINAL"
            fi
        fi
    done < "$log_file"
    rm "$log_file"
done

move_old_small_bucket_logs
remove_lock_file
