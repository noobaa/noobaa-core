#!/bin/sh

#extract parms
# default - clean build
CLEAN=true;
SYSTEM="demo"
ADDRESS="http://127.0.0.1:5001"
ACCESS_KEY="123"
SECRET_KEY="abc"

#extract parms
while [[ $# > 0 ]]; do
  key=$(echo $1 | sed "s:\(.*\)=.*:\1:")
  case $key in
      --clean)
      CLEAN=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
      --system)
      SYSTEM=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
      --address)
      ADDRESS=$(echo $1 | sed "s:.*=\(.*\):\1:")
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
#TODO: no agent conf, create a default one cp ../../agent_conf.json .
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

echo "SYSTEM:$SYSTEM"
echo "CLEAN BUILD:$CLEAN"
echo "ADDRESS:$ADDRESS"
echo "ACCESS_KEY:$ACCESS_KEY"
echo "SECRET_KEY:$SECRET_KEY"

if [ "$CLEAN" = true ] ; then
        echo "delete old files"
        rm -rf build/windows
        mkdir build/windows
        cd build/windows
        mkdir ./ssl/
        echo "copy files"
        cp ../../images/noobaa_icon24.ico .
        cp ../../src/deploy/7za.exe .
        #no longer needed with new openssl
        #cp ../../src/deploy/lib*.dll .
        #cp ../../src/deploy/ssl*.dll .
        curl -L http://nodejs.org/dist/v0.10.33/openssl-cli.exe > openssl.exe
        cp ../../src/deploy/openssl.cnf  ./ssl/
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
echo '    "address": "'"$ADDRESS"'",' >> agent_conf.json
echo '    "system": "'"$SYSTEM"'",' >> agent_conf.json
echo '    "tier": "nodes",' >> agent_conf.json
echo '    "prod": "true",' >> agent_conf.json
echo '    "bucket": "files",' >> agent_conf.json
echo '    "root_path": "./agent_storage/",' >> agent_conf.json
echo '    "access_key":"'"$ACCESS_KEY"'",' >> agent_conf.json
echo '    "secret_key":"'"$SECRET_KEY"'"' >> agent_conf.json
echo '}' >> agent_conf.json

echo "make installer"
pwd
makensis -NOCD ../../src/deploy/atom_agent_win.nsi

echo "uploading to S3"

s3cmd -P put noobaa-setup.exe s3://noobaa-download/ness/
#s3cmd -P put update_agent.tar s3://noobaa-download/ness/
