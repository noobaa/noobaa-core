#!/bin/bash
echo "Uninstall NooBaa"
/usr/local/noobaa/node_modules/forever-service/bin/forever-service delete noobaa_local_service
rm -rf /usr/local/noobaa
echo "Done"
