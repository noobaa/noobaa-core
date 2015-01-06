#!/bin/bash
sed -i "s/<env>/$1/g" /etc/supervisor/conf.d/supervisord.conf
sed -i "s/<port>/$2/g" /etc/supervisor/conf.d/supervisord.conf
/usr/bin/supervisord

