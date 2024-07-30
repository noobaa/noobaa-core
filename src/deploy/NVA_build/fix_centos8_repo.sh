#!/bin/bash

if [ "$CENTOS_VER" == "8" ]; then
	sed -i 's/mirrorlist/#mirrorlist/g' /etc/yum.repos.d/CentOS-*
	sed -i -e "s|#baseurl=http://mirror.centos.org|baseurl=https://mirror.nsc.liu.se/centos-store|g" /etc/yum.repos.d/CentOS-*
fi
