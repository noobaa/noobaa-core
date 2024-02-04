#!/bin/bash

# /var/log/noobaa_logs will have all the rotated bucket_logs.log files.
# Each log file will be having a timestamp appended to it based on the
# time it was rotated by logrotate. These log files will be holding logs
# from all the endpoints for all the buckets.
# We need to segregate these logs based on the log bucket name and put it
# into respective log files. These files will be moved to the final location
# /log/noobaa_bucket_logs/ which will be scanned by the background worker.


log_dir="/var/log/noobaa_logs"
# Lock file to make sure that the script is not running multiple times.
lock_file="/var/log/noobaa_bucket_logs/noobaa_log_segregate.lock"

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

# Delimiter for the file name. To separate the file name from the timestamp.
# S3 Bucket name are not allowed to have "_" in its name.
File_Name_Del="_"

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

if [ ! -d "$log_dir" ] || [ -z "$(ls -A "$log_dir")" ]; then
    echo "log_dir $log_dir does not exist or is empty."
    remove_lock_file
fi

while [ -n "$(ls -A "$log_dir")" ]; do
    log_file=$(oldest_log_file)
    echo "processing $log_file"
    mv "$log_dir/$log_file" "$log_dir/$log_file.processing"
    log_file="$log_dir/$log_file.processing"
    # Iterate over each log records in the log file and do the following -
    # - Fetch the log bucket name from the log entry.
    # - Create a file based on this log bucket name if the file is not there.
    # - Append the log entry to this file.
    # - Check the size of this file, if it is 50KB, then rename the file by
    # - appending the current timestamp to the file name.
    # - Remove the log file once all log entries are processed.
    while read -r log; do
        IFS=, read -r -a log_fields <<< "$log"
        for log_field in "${log_fields[@]}"; do
            if [[ "$log_field" =~ "log_bucket" ]]; then
                IFS=: read -r -a log_values <<< "$log_field"
                log_bucket_name=$(echo "${log_values[1]}" | tr -d '"' | sed 's/^[ \t]*//; s/[ \t]*$//')
                echo "$log" >> "/var/log/noobaa_bucket_logs/$log_bucket_name.log"
                                file_size=$(stat -c "%s" "/var/log/noobaa_bucket_logs/$log_bucket_name.log")
                if [[ $file_size -gt 50000 ]]; then
                    time_string=$(date +"%Y-%m-%d-%H-%M-%S.%N")
                    mv "/var/log/noobaa_bucket_logs/$log_bucket_name.log" "/log/noobaa_bucket_logs/$log_bucket_name$File_Name_Del$time_string.log"
                fi

            fi
        done
    done < "$log_file"
    rm "$log_file"
done

remove_lock_file
