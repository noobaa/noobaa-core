#!/bin/bash
source /root/.bashrc
cd /root/node_modules/noobaa-core
echo 'AWS_ACCESS_KEY_ID=AKIAJJCHBZVA3VSS2YCQ' >> .env
echo 'AWS_SECRET_ACCESS_KEY=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' >> .env
echo 'DEV_MODE=true' >> .env
npm install istanbul mocha gulp
/usr/local/bin/node src/test/framework/runner.js --GIT_VERSION 1
