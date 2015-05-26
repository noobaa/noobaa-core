#!/bin/bash
docker restart --time=0 $(docker ps -a -q)

stopped=($(docker ps -a |grep Exi| awk -F" " '{print $1}'|wc -l))
if [ "$stopped" -gt 0 ]; then
#start all the containers that failed to start after restart (due to  bug in this docker version) - fixed in newer version.
docker start $(docker ps -a |grep Exi| awk -F" " '{print $1}')
else
echo "All containers are up"
fi
exit
