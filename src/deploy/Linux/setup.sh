#!/bin/bash
CONFIG=false
#if we have the folder and agent_conf.json, we will assume upgrade. Need to revisit in the future.
openssl version
if [ $? -ne 0 ]; then
    echo "missing openssl, please install openssl and rerun the setup"
    exit 1
fi

if [ ! -d "/usr/local/noobaa" ]; then
    if [[ $# -lt 1 ]]; then
        echo "usage: noobaa-setup <configuration string>"
        exit 1
    else
        CONFIG=$1
        mkdir /usr/local/noobaa
        echo "config is:" ${CONFIG}
        openssl enc -base64 -d -A <<<${CONFIG} >/usr/local/noobaa/agent_conf.json
        cat /usr/local/noobaa/agent_conf.json
    fi
else
    if [ ! -f /usr/local/noobaa/noobaa-setup ]; then
        echo "Agent already installed"
        exit 1
    fi
fi

./noobaa-installer --keep --target /usr/local/noobaa
