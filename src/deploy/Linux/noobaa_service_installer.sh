#!/bin/bash

PATH=/usr/local/noobaa:$PATH;/usr/local/noobaa/node_modules/forever-service/bin/forever-service delete noobaa_local_service
sleep 10
/usr/local/noobaa/node_modules/forever-service/bin/forever-service install --envVars PATH=/usr/local/noobaa:$PATH noobaa_local_service -s /usr/local/noobaa/noobaa_local_service.sh -p /usr/local/noobaa/node_modules/forever/bin/  -f " -c 'bash'" --start
