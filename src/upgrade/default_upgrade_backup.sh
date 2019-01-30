#!/bin/bash

set -e

BACKUP_DIR=/backup
ETC_BACKUP_DIR=${BACKUP_DIR}/etc
CORE_DIR=/root/node_modules/noobaa-core


if [ "$1" == "restore" ]; then
    echo "UPGRADE: restoring previous version files"
    if [ -d ${BACKUP_DIR}/noobaa-core ]; then
    echo "UPGRADE: restoring ${CORE_DIR}"
        echo "UPGRADE: removing directory of failed upgrade: ${CORE_DIR}"
        rm -rf ${CORE_DIR}
        echo "UPGRADE: copying ${BACKUP_DIR}/noobaa-core to ${CORE_DIR}"
        /bin/cp -rf ${BACKUP_DIR}/noobaa-core ${CORE_DIR}
        echo "UPGRADE: ${CORE_DIR} restored successfully"
    else 
        echo "UPGRADE: Restore error. could not find direcotry ${BACKUP_DIR}/noobaa-core to restore from"
    fi
    
    if [ -d ${ETC_BACKUP_DIR} ]; then
        echo "UPGRADE: restoring ${ETC_BACKUP_DIR}"
        /bin/cp -rf ${ETC_BACKUP_DIR}/* /etc/
        echo "UPGRADE: ${ETC_BACKUP_DIR} restored successfully"
    else 
        echo "UPGRADE: Restore error. could not find direcotry ${ETC_BACKUP_DIR} to restore from"
    fi


else
    echo "UPGRADE: removing old backup dir and creating new one"
    rm -rf ${BACKUP_DIR}
    mkdir -p ${BACKUP_DIR}
    mkdir -p ${ETC_BACKUP_DIR}

    echo "UPGRADE: copying noobaa-core to ${BACKUP_DIR}"
    /bin/cp -rf ${CORE_DIR} ${BACKUP_DIR}

    echo "UPGRADE: copy /etc files to ${ETC_BACKUP_DIR}" 
    /bin/cp /etc/noobaa_* ${ETC_BACKUP_DIR}
    /bin/cp /etc/ntp.conf ${ETC_BACKUP_DIR}
    /bin/cp /etc/yum.conf ${ETC_BACKUP_DIR}
    /bin/cp /etc/dhclient.conf ${ETC_BACKUP_DIR}
    /bin/cp /etc/resolv.conf ${ETC_BACKUP_DIR}
    /bin/cp -r /data/mongo/ssl ${ETC_BACKUP_DIR}

    echo "UPGRADE: backup finished successfully"
fi
