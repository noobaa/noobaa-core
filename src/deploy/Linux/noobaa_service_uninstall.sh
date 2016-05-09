#!/bin/bash
echo "Uninstall NooBaa"
PATH=/usr/local/noobaa:$PATH;/usr/local/noobaa/node_modules/forever-service/bin/forever-service delete noobaa_local_service
rm -rf /usr/local/noobaa
echo "Done"
