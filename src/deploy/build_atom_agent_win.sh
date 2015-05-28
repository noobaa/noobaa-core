#!/bin/sh
# default - clean build
CLEAN=true;
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
      --clean)
      CLEAN=$(echo $1 | sed "s:.*=\(.*\):\1:")
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

echo "ON_PREMISE_ENV:$ON_PREMISE_ENV"
#if NOT building on-premise package, run makensis and create the agent distro
#TODO: automate - build and sign executable as well.

if [ ${ON_PREMISE} -eq 1 ]; then
    cd build/public/
    s3cmd get --region eu-central-1 -f s3://noobaa-core/noobaa-setup.exe .\noobaa-setup.exe
    echo "Done downloading noobaa-setup.exe"
else
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

    echo "make installer"

    makensis -NOCD ../../src/deploy/atom_agent_win.nsi

    echo "uploading to S3"
    s3cmd -P put noobaa-setup.exe s3://noobaa-core/noobaa-setup.exe
fi
