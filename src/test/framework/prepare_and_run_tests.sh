#!/bin/bash
source /root/.bashrc
cd /root/node_modules/noobaa-core
echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" >> .env
echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" >> .env
echo 'ENDPOINT_BLOB_ENABLED=true' >> .env
echo 'DEV_MODE=true' >> .env
echo "AZURE_STORAGE_CONNECTION_STRING=$AZURE_STORAGE_CONNECTION_STRING" >> .env
echo "TEST_RUN_NAME=$TEST_RUN_NAME" >> .env

npm install \
    gulp \
    mocha \
    istanbul-reports \
    istanbul-lib-hook \
    istanbul-lib-report \
    istanbul-lib-coverage \
    istanbul-lib-instrument

/usr/local/bin/node src/test/framework/runner.js --GIT_VERSION 1
rc=$?
if [ ${rc} -ne 0 ]
then
    /usr/local/bin/node src/test/framework/send_logs.js
    exit $rc
fi