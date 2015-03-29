#!/bin/sh
# if no params, build clean
if [ $# -eq 0 ]
        then
        echo "delete old files"
        rm -rf build/windows_s3
        mkdir build/windows_s3
        cd build/windows_s3
        echo "copy files"
        cp ../../images/noobaa_icon24.ico .
        cp ../../src/deploy/7za.exe .
        cp ../../src/deploy/lib*.dll .
        cp ../../src/deploy/wget.exe  .
        cp ../../src/deploy/NooBaa_Agnet_wd.exe .
        cp ../../package.json .
        cp ../../config.js .
        cp ../../agent_conf.json .
        mkdir ./src/
        cp -R ../../src/util ./src/
        cp -R ../../src/s3 ./src/
        cp -R ../../src/rpc ./src/
        cp -R ../../src/api ./src/
        echo "npm install"
        sed -i '' '/atom-shell/d' package.json
        sed -i '' '/gulp/d' package.json
        sed -i '' '/bower/d' package.json
        sed -i '' '/aws-sdk/d' package.json
        sed -i '' '/bootstrap/d' package.json
        sed -i '' '/browserify/d' package.json
        pwd
        npm install -dd
        echo "Downloading atom-shell for windows"
        curl -L https://github.com/atom/atom-shell/releases/download/v0.17.1/atom-shell-v0.17.1-win32-ia32.zip > atom-shell.zip
        unzip atom-shell.zip -d atom-shell
        #echo "create update.tar"
        #tar -cvf update_agent.tar ./atom-shell ./node_modules ./src ./config.js ./package.json ./agent_conf.json
else
    cd build/windows
fi
echo "make installer"
pwd
makensis -NOCD ../../src/deploy/atom_rest_win.nsi

echo "uploading to S3"

s3cmd -P put noobaa-s3rest-setup.exe s3://noobaa-download/ness/
