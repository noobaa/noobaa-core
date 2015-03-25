#!/bin/sh
# if no params, build clean
#  sudo node --throw-deprecation src/s3/s3rver_starter.js -d ./testme --port 443 -h Erans-Macbook-Air.local
if [ $# -eq 0 ]
        then
        echo "delete old files"
        rm -rf ./src/agent
        rm -rf ./src/util
        rm -rf ./src/api
        rm -rf ./src/rpc
        rm -rf ./node_modules
        rm agent_conf.json
        rm config.js
        rm -f update_S3REST.tar
        echo "copy files"
        cp /Users/eran/workspace/noobaa-core-new/package.json .
        #cp /Users/eran/workspace/noobaa-core-new/config.js .
        #cp /Users/eran/workspace/noobaa-core-new/agent_conf.json .
        cp /Users/eran/Downloads//agent_conf.json .
        cp /Users/eran/Downloads/config.js .

        cp -R /Users/eran/workspace/noobaa-core-new/src/agent ./src/
        cp -R /Users/eran/workspace/noobaa-core-new/src/util ./src/
        cp -R /Users/eran/workspace/noobaa-core-new/src/s3 ./src/
        cp -R /Users/eran/workspace/noobaa-core-new/src/rpc ./src/
        cp -R /Users/eran/workspace/noobaa-core-new/src/api ./src/
        cp -R /Users/eran/workspace/noobaa-ice/node_modeuls ./
        cp -R /Users/eran/Downloads/atom-shell ./
        cp /Users/eran/workspace/key.pem .
        cp /Users/eran/workspace/cert.pem .
        echo "npm update"
        #sudo npm update
        rm -rf ./node_modules/atom-shell
        rm -rf ./node_modules/gulp*
        rm -rf ./node_modules/bower
        rm -rf ./node_modules/aws-sdk
        rm -rf ./node_modules/bootstrap
        rm -rf ./node_modules/browserify
        echo "create update.tar"
        tar -cvf update_S3REST.tar ./atom-shell ./node_modules ./src ./config.js ./package.json ./agent_conf.json ./key.pem ./cert.pem
fi
echo "make installer"
makensis atom_rest_win.nsi
rm /Users/eran/Downloads/noobaa-s3rest-setup.exe
mv noobaa-s3rest-setup.exe /Users/eran/Downloads
cp update_S3REST.tar /Library/WebServer/Documents/
