#!/bin/sh
# default - clean build

clean=true;
#extract parms
while [[ $# > 0 ]]; do
  key=$(echo $1 | sed "s:\(.*\)=.*:\1:")
  case $key in
      --clean)
        clean=$(echo $1 | sed "s:.*=\(.*\):\1:")
        ;;
    --access_key)
      ACCESS_KEY=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
    --secret_key)
      SECRET_KEY=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
    *)
      usage
      # unknown option
      ;;
  esac
  shift
done
echo "$clean"
echo "$ACCESS_KEY"
echo "$SECRET_KEY"

if [ "$clean" = true ] ; then
        echo "delete old files"
        rm -rf build/windows
        mkdir build/windows
        cd build/windows
        echo "copy files"
        cp ../../images/noobaa_icon24.ico .
        cp ../../src/deploy/7za.exe .
        cp ../../src/deploy/lib*.dll .
        cp ../../src/deploy/ssl*.dll .
        cp ../../src/deploy/openssl.exe  .
        cp ../../src/deploy/openssl.cnf  .
        cp ../../src/deploy/wget.exe  .
        cp ../../src/deploy/NooBaa_Agent_wd.exe .
        cp ../../package.json .
        cp ../../config.js .

        mkdir ./src/
        cp -R ../../src/agent ./src/
        cp -R ../../src/util ./src/
        cp -R ../../src/rpc ./src/
        cp -R ../../src/api ./src/
        echo "npm install"
        #remove irrelevant packages
        #TODO: create new package for that matter
        sed -i '' '/atom-shell/d' package.json
        sed -i '' '/gulp/d' package.json
        sed -i '' '/bower/d' package.json
        sed -i '' '/bootstrap/d' package.json
        sed -i '' '/browserify"/d' package.json
        sed -i '' '/rebuild/d' package.json
        pwd
        npm install -dd
        curl -L http://nodejs.org/dist/v0.10.32/node.exe > node.exe
        #No need for atom for now. Keep it for future use?!
        #echo "Downloading atom-shell for windows"
        #curl -L https://github.com/atom/atom-shell/releases/download/v0.17.1/atom-shell-v0.17.1-win32-ia32.zip > atom-shell.zip
        #unzip atom-shell.zip -d atom-shell
        #echo "create update.tar"
        #tar -cvf update_agent.tar ./atom-shell ./node_modules ./src ./config.js ./package.json ./agent_conf.json
else
    cd build/windows
fi
echo "create agent conf"
echo "$SECRET_KEY"
echo '{' > agent_conf.json
echo '    "dbg_log_level": 2,' >> agent_conf.json
echo '    "address": "http://127.0.0.1:5001",' >> agent_conf.json
echo '    "system": "demo",' >> agent_conf.json
echo '    "tier": "nodes",' >> agent_conf.json
echo '    "prod": "true",' >> agent_conf.json
echo '    "bucket": "files",' >> agent_conf.json
echo '    "root_path": "./agent_storage_test/",' >> agent_conf.json
echo '    "access_key":"'"$ACCESS_KEY"'",' >> agent_conf.json
echo '    "secret_key":"'"$SECRET_KEY"'"' >> agent_conf.json
echo '}' >> agent_conf.json

echo "make installer"
pwd
makensis -NOCD ../../src/deploy/atom_agent_win.nsi

echo "uploading to S3"

s3cmd -P put noobaa-setup.exe s3://noobaa-download/ness/
#s3cmd -P put update_agent.tar s3://noobaa-download/ness/
