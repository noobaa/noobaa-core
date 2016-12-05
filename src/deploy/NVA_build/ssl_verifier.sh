#!/bin/bash
TMP_PATH="/tmp/"
if [ "$1" == "from_file" ]; then

    if file --mime-type "$2" | grep -q zip$; then
        echo "$2 is gzipped"
    else
        echo 'Not a zip'
        exit 5
    fi
    rm -rf ${TMP_PATH}ssl/
    mkdir ${TMP_PATH}ssl/

    unzip $2 -d ${TMP_PATH}ssl/
    crt_list=(`find $TMP_PATH/ssl/ -maxdepth 1 -name "*.crt"`)
    if [ ${#crt_list[@]} -eq 1 ]; then
        key_list=(`find $TMP_PATH/ssl/ -maxdepth 1 -name "*.key"`)
        if [ ${#key_list[@]} -eq 1 ]; then
            # based on https://kb.wisc.edu/middleware/page.php?id=4064
            valid_certificate_and_key=$((openssl x509 -noout -modulus -in $crt_list | openssl md5 ; openssl rsa -noout -modulus -in $key_list | openssl md5) | uniq |wc -l)
            if [ $valid_certificate_and_key -eq 1 ]; then
                if [ ! -d "/etc/private_ssl_path" ]; then
                    mkdir /etc/private_ssl_path
                else
                    old_ssl_folder=ssl_old_$(date +%F-%T)
                    mkdir ${TMP_PATH}/ssl_old_$old_ssl_folder
                    mv /etc/private_ssl_path/* /tmp/ssl_old_$old_ssl_folder
                fi
                //cp $TMP_PATH/ssl/* /etc/private_ssl_path
                cp $crt_list /etc/private_ssl_path/server.crt
                cp $key_list /etc/private_ssl_path/server.key
            else
                echo 'No match between key and certificate. Please make sure the extensions are .crt and .key'
                exit 1
            fi
        else
            echo 'one key required, found'${#key_list[@]}
            exit 2
        fi
    else
        echo 'one certificate required, found'${#crt_list[@]}
        exit 3
    fi
else
    echo 'no input file'
    exit 4
fi
