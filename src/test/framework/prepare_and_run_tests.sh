#!/bin/bash
source /root/.bashrc
cd /root/node_modules/noobaa-core
echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" >> .env
echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" >> .env
echo 'ENDPOINT_BLOB_ENABLED=true' >> .env
echo 'DEV_MODE=true' >> .env
npm install \
    gulp \
    mocha \
    istanbul-reports \
    istanbul-lib-hook \
    istanbul-lib-report \
    istanbul-lib-coverage \
    istanbul-lib-instrument
/usr/local/bin/node src/test/framework/runner.js --GIT_VERSION 1
