#!/bin/sh

# default - clean build
CLEAN=true;
SYSTEM="demo"
ADDRESS="http://127.0.0.1:5001"
ACCESS_KEY="123"
SECRET_KEY="abc"
SYSTEM_ID="0"
#ON_PREMISE means that we are currently building the ON_PREMISE package
#In this case, there is no point to create executable.
#1 means building on-premise package
ON_PREMISE=0
#ON_PREMISE_ENV means that we are currently running on ON-PREMISE VM.
#In this case, we have to assume that we don't have internet connectivity
#1 means building on ON-PREMISE VM
ON_PREMISE_ENV=0
#extract parms
while [[ $# > 0 ]]; do
  key=$(echo $1 | sed "s:\(.*\)=.*:\1:")
  case $key in
      --system_id)
      SYSTEM_ID=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
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
    --on_premise)
      ON_PREMISE=1
      ;;
    --on_premise_env)
      ON_PREMISE_ENV=1
      ;;
    *)
      usage
      # unknown option
      ;;
  esac
  shift
done

echo "SYSTEM:$SYSTEM"
echo "CLEAN BUILD:$CLEAN"
echo "ADDRESS:$ADDRESS"
echo "ACCESS_KEY:$ACCESS_KEY"
echo "SECRET_KEY:$SECRET_KEY"
echo "ON_PREMISE_ENV:$ON_PREMISE_ENV"



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
    #remove irrelevant packages
    #TODO: create new package for that matter

    if [ ${ON_PREMISE_ENV} -eq 1 ]; then
            rm -rf  ../../node_modules/atom-shell*
            cp -R   ../../node_modules ./
            sed -i  '/atom-shell/d' package.json
            sed -i  '/gulp/d' package.json
            sed -i  '/bower/d' package.json
            sed -i  '/bootstrap/d' package.json
            sed -i  '/browserify"/d' package.json
            sed -i  '/rebuild/d' package.json
            sed -i  '/nodetime/d' package.json
            sed -i  '/newrelic/d' package.json
            rm -rf ./node_modules/gulp*
    	    rm -rf ./node_modules/bower*
            rm -rf ./node_modules/bootstrap*
            rm -rf ./node_modules/browserify*
            rm -rf ./node_modules/nodetime*
            rm -rf ./node_modules/newrelic*
            cp ../public/node.exe ./
            cp ../public/openssl.exe ./
    else
            echo "npm install"
            sed -i '' '/atom-shell/d' package.json
            sed -i '' '/gulp/d' package.json
            sed -i '' '/bower/d' package.json
            sed -i '' '/bootstrap/d' package.json
            sed -i '' '/browserify"/d' package.json
            sed -i '' '/rebuild/d' package.json
            sed -i '' '/nodetime/d' package.json
            sed -i '' '/newrelic/d' package.json
            npm install -dd
            curl -L http://nodejs.org/dist/v0.10.32/node.exe > node.exe
            curl -L http://nodejs.org/dist/v0.10.33/openssl-cli.exe > openssl.exe
            cp node.exe ../public/node.exe
            cp openssl.exe ../public/openssl.exe
            rm -rf ./node_modules/noobaa-util/node_modules/gulp*
            rm -rf ./node_modules/noobaa-util/node_modules/node-gyp*
    fi
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




#if NOT building on-premise package, run makensis and create the agent distro
if [ ${ON_PREMISE} -eq 0 ]; then
    echo "make installer"
    pwd
    cp ../../src/deploy/atom_agent_win.nsi ../../src/deploy/atom_agent_win.bak
    cp ../../src/deploy/init_agent.bat ../../src/deploy/init_agent.bak

    if [ ${ON_PREMISE_ENV} -eq 1 ]; then
       sed -i  "s/<SYSTEM_ID>/$SYSTEM_ID/g" ../../src/deploy/atom_agent_win.nsi
       # update our own distribution file to use the provided system. Don't commit init_agent with this parameters.
       sed -i  "s/<SYSTEM_ID>/$SYSTEM_ID/g" ../../src/deploy/init_agent.bat
    else
       sed -i '' "s/<SYSTEM_ID>/$SYSTEM_ID/g" ../../src/deploy/atom_agent_win.nsi
       # update our own distribution file to use the provided system. Don't commit init_agent with this parameters.
       sed -i '' "s/<SYSTEM_ID>/$SYSTEM_ID/g" ../../src/deploy/init_agent.bat
    fi
    makensis -NOCD ../../src/deploy/atom_agent_win.nsi
    mv ../../src/deploy/atom_agent_win.bak ../../src/deploy/atom_agent_win.nsi
    mv ../../src/deploy/init_agent.bak ../../src/deploy/init_agent.bat

    if [ ${ON_PREMISE_ENV} -eq 1 ]; then
       mkdir ../public/systems/
       mkdir ../public/systems/$SYSTEM_ID/
       cp noobaa-setup.exe ../public/systems/$SYSTEM_ID/
       exit 1
    else
       mv ../../src/deploy/atom_agent_win.bak ../../src/deploy/atom_agent_win.nsi
       mv ../../src/deploy/init_agent.bak ../../src/deploy/init_agent.bat
       echo "uploading to S3"
       s3cmd -P put noobaa-setup.exe s3://noobaa-core/systems/$SYSTEM_ID/noobaa-setup.exe
    fi
fi
