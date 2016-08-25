#!/bin/bash

PATH=/usr/local/noobaa:$PATH;
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer uninstall
sleep 10
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
