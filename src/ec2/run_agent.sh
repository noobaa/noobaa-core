#!/bin/bash
sudo apt-get -y update
sudo apt-get -y install git
sudo apt-get -y install nodejs
sudo apt-get -y install npm
sudo ln -s `which nodejs` /usr/local/bin/node

mkdir -p noobaa
cd noobaa

while true; do
 time curl -H "Accept: application/json" $ADDRESS/agent/package.json > package.json
 time rm -rf node_modules/
 time npm install
 time npm start
 sleep 60
done 2>&1 | tee -a agent.log
