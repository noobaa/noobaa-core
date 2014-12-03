#!/bin/bash
sudo apt-get -y update
sudo apt-get -y install git
sudo apt-get -y install nodejs
sudo apt-get -y install npm
sudo ln -s `which nodejs` /usr/local/bin/node

mkdir -p /noobaa

cat << EOF > /etc/init/nbagent.conf
start on stopped rc RUNLEVEL=[2345]
stop on runlevel [!2345]
respawn
script
 cd /noobaa
 time curl -H "Accept: application/json" https://noobaa-core.herokuapp.com/agent/package.json > package.json
 time rm -rf node_modules/
 time npm install
 time npm start
 sleep 60
end script
EOF

service nbagent start
