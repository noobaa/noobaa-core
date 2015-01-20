#!/bin/bash
mkdir -p /noobaa
sudo apt-get -y update
sudo apt-get -y install git build-essential libssl-dev

# install nodejs with nvm (node version manager)
export NVM_DIR="/usr/local/nvm"
curl https://raw.githubusercontent.com/creationix/nvm/v0.20.0/install.sh |
    NVM_DIR="$NVM_DIR" PROFILE="/etc/profile" bash
source $NVM_DIR/nvm.sh
nvm install 0.10.33
nvm alias default 0.10.33
nvm current

cat << EOF > /noobaa/run-agent.sh
#!/bin/bash
echo '/*'
echo ' * noobaa-agent starting'
echo ' */'
echo
export HOME='/root'
cd /noobaa
source /usr/local/nvm/nvm.sh
nvm use 0.10.33
time curl -H "Accept: application/json" https://noobaa-test.herokuapp.com/agent/package.json > package.json
time rm -rf node_modules/
time npm install
time npm start
echo
echo '/*'
echo ' * noobaa-agent exited'
echo ' */'
EOF

chmod +x /noobaa/run-agent.sh

# configure the noobaa-agent service (upstart) to handle respawn of the agent
cat << EOF > /etc/init/noobaa-agent.conf
start on stopped rc RUNLEVEL=[2345]
stop on runlevel [!2345]
respawn
script
 exec bash -c '/noobaa/run-agent.sh'
 sleep 60
end script
EOF

# fire!
service noobaa-agent start
