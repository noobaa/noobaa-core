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
#Upload to S3
#1 means upload to S3
UPLOAD_TO_S3=0


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
    --upload_to_s3)
      UPLOAD_TO_S3=1
      ;;
    *)
      usage
      # unknown option
      ;;
  esac
  shift
done

if [ ${ON_PREMISE} -eq 1 ]; then
    cd build/public/
    s3cmd get --region eu-central-1 -f s3://noobaa-core/noobaa-s3rest.exe ./noobaa-s3rest.exe
    echo "Done downloading noobaa-rest.exe"

else
    if [ "$CLEAN" = true ] ; then
        echo "delete old files"
        rm -rf build/windows_s3
        mkdir build/windows_s3
        cd build/windows_s3
        mkdir ./ssl/
        echo "copy files"
        cp ../../binding.gyp .
        cp ../../images/noobaa_icon24.ico .
        cp ../../src/deploy/7za.exe .
        cp ../../src/deploy/wget.exe  .
        curl -L http://nodejs.org/dist/v0.10.33/openssl-cli.exe > openssl.exe
        cp ../../src/deploy/openssl.cnf  ./ssl/
        cp ../../src/deploy/NooBaa_Agent_wd.exe .
        cp ../../package.json .
        cp ../../config.js .
        mkdir ./src/
        cp -R ../../src/util ./src/
        cp -R ../../src/s3 ./src/
        cp -R ../../src/rpc ./src/
        cp -R ../../src/api ./src/
        echo "npm install"
        sed -i '' '/atom-shell/d' package.json
        sed -i '' '/gulp/d' package.json
        sed -i '' '/bower/d' package.json
        sed -i '' '/bootstrap/d' package.json
        sed -i '' '/browserify"/d' package.json
        pwd
        npm install -dd
        curl -L http://nodejs.org/dist/v0.10.32/node.exe > node.exe
        #echo "Downloading atom-shell for windows"
        #curl -L https://github.com/atom/atom-shell/releases/download/v0.17.1/atom-shell-v0.17.1-win32-ia32.zip > atom-shell.zip
        #unzip atom-shell.zip -d atom-shell
        #echo "create update.tar"
        #tar -cvf update_agent.tar ./atom-shell ./node_modules ./src ./config.js ./package.json ./agent_conf.json
    else
        cd build/windows_s3
    fi

    echo "building installer"

    makensis -NOCD ../../src/deploy/atom_rest_win.nsi

    echo "noobaa-s3rest.exe installer available under build/public/windows_s3/"


    if [ ${UPLOAD_TO_S3} -eq 1 ]; then
        echo "uploading to S3"
        s3cmd -P put noobaa-s3rest.exe s3://noobaa-core/noobaa-s3rest.exe
    fi
fi

exit 0
