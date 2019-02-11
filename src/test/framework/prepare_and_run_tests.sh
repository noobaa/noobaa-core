#!/bin/bash
source /root/.bashrc
cd /root/node_modules/noobaa-core
echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" >> /data/.env
echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" >> /data/.env
echo 'ENDPOINT_BLOB_ENABLED=true' >> /data/.env
echo 'DEV_MODE=true' >> /data/.env
echo "AZURE_STORAGE_CONNECTION_STRING=$AZURE_STORAGE_CONNECTION_STRING" >> /data/.env
echo "TEST_RUN_NAME=$TEST_RUN_NAME" >> /data/.env

# install dependencies 
yum install -y git
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