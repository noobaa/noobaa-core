#!/bin/bash

/usr/local/noobaa/node_modules/forever-service/bin/forever-service delete noobaa_local_s3_service
sleep 10
/usr/local/noobaa/node_modules/forever-service/bin/forever-service install noobaa_local_s3_service -s /usr/local/noobaa/noobaa_local_s3_service.sh -p /usr/local/noobaa/node_modules/forever/bin/  -f " -c 'bash'" --start
