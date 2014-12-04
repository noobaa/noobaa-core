#!/bin/bash
sudo apt-get -y update
sudo apt-get -y install git build-essential libssl-dev

# install nodejs using nvm (node version manager)
curl https://raw.githubusercontent.com/creationix/nvm/v0.20.0/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 0.10.33
nvm alias default 0.10.33
nvm current

mkdir -p /noobaa

# define a service that will respawn and reload the agent code
cat << EOF > /etc/init/noobaa-agent.conf
start on stopped rc RUNLEVEL=[2345]
stop on runlevel [!2345]
respawn
script
 echo '/*'
 echo ' * noobaa-agent service starting'
 echo ' */'
 cd /noobaa
 time curl -H "Accept: application/json" https://noobaa-core.herokuapp.com/agent/package.json > package.json
 time rm -rf node_modules/
 time npm install
 time npm start
 echo '/*'
 echo ' * noobaa-agent service exited, wait 1 minute before respawning'
 echo ' */'
 sleep 60
end script
EOF

service nbagent start
