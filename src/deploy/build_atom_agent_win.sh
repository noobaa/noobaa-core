#!/bin/sh
# if no params, build clean
if [ $# -eq 0 ]
        then
        echo "delete old files"
        rm -rf ./src/agent
        rm -rf ./src/util
        rm -rf ./src/api
        rm -rf ./src/rpc
        #rm -rf ./node_modules
        rm -f agent_conf.json
        rm -f config.js
        rm -f update.tar

        echo "copy files"
        cp /Users/eran/workspace/noobaa-core-new/package.json .
        cp /Users/eran/workspace/noobaa-core-new/config.js .
        cp /Users/eran/workspace/noobaa-core-new/agent_conf.json .
        #cp /Users/eran/Downloads/agent_conf.json .
        #cp /Users/eran/Downloads/config.js .
        cp -R /Users/eran/workspace/noobaa-core-new/src/agent ./src/
        cp -R /Users/eran/workspace/noobaa-core-new/src/util ./src/
        cp -R /Users/eran/workspace/noobaa-core-new/src/rpc ./src/
        cp -R /Users/eran/workspace/noobaa-core-new/src/api ./src/
        cp -R /Users/eran/Downloads/atom-shell ./

        echo "npm update"
        #sudo npm update
        rm -rf ./node_modules/atom-shell
        rm -rf ./node_modules/gulp*
        rm -rf ./node_modules/bower
        rm -rf ./node_modules/aws-sdk
        rm -rf ./node_modules/bootstrap
        rm -rf ./node_modules/browserify
        echo "create update.tar"
        tar -cvf update_agent.tar ./atom-shell ./node_modules ./src ./config.js ./package.json ./agent_conf.json
fi
echo "make installer"
makensis atom_agent_win.nsi
rm /Users/eran/Downloads/noobaa-setup.exe
mv noobaa-setup.exe /Users/eran/Downloads/noobaa-setup.exe
cp update_agent.tar /Library/WebServer/Documents/
echo "uploading to S3"

/Users/eran/Downloads/s3cmd-1.5.0-rc1/s3cmd -P put /Users/eran/Downloads/noobaa-setup.exe s3://noobaa-download/ness/
/Users/eran/Downloads/s3cmd-1.5.0-rc1/s3cmd -P put /Users/eran/Downloads/update_agent.tar s3://noobaa-download/ness/
