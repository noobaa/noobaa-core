#!/bin/bash
sudo apt-get -y update
sudo apt-get -y install nodejs
sudo apt-get -y install npm
sudo ln -s `which nodejs` /usr/local/bin/node

mkdir -p noobaa
cd noobaa
curl https://noobaa-core.herokuapp.com/package.json > package.json
npm install
npm start &
