#!/bin/bash

/usr/local/noobaa/node_modules/forever-service/bin/forever-service delete noobaa_local_service
sleep 20
/usr/local/noobaa/node_modules/forever-service/bin/forever-service install noobaa_local_service -s /usr/local/noobaa/noobaa_local_service.sh -p /usr/local/noobaa/node_modules/forever/bin/  -f " -c 'bash'" --start
