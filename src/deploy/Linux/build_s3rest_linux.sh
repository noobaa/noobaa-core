#!/bin/bash
# default - clean build

source ~/.bashrc
source "$NVM_DIR/nvm.sh"

nodever=$(cat ./.nvmrc)

nvm install ${nodever}
nvm alias default ${nodever}
nvm use ${nodever}

CLEAN=true;
#ON_PREMISE means that we are currently building the ON_PREMISE package
#In this case, there is no point to create executable.
#1 means building on-premise package
ON_PREMISE=0
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

#TODO: automate - build and sign executable as well.

if [ ${ON_PREMISE} -eq 1 ]; then
    cd build/public/
    s3cmd get --region eu-central-1 -f s3://noobaa-core/Alpha_v0.3.2/noobaa-setup ./noobaa-setup
    echo "Done downloading noobaa-setup"
else
    if [ "$CLEAN" = true ] ; then
        echo "delete old files"
        rm -rf build/linux
        mkdir build
        mkdir build/linux
        mkdir build/linux/package
        mkdir build/linux/disk
        cd build/linux
        echo "copy files"
        cp ../../package.json ./package/
        cp ../../config.js ./package/
        cp ~/.nvm/versions/node/v${nodever}/bin/node ./package/

        mkdir ./package/src/
        cp -R ../../src/s3 ./package/src/
        cp -R ../../src/util ./package/src/
        cp -R ../../src/rpc ./package/src/
        cp -R ../../src/api ./package/src/
        cp -R ../../src/native ./package/src/
        cp -R ../../binding.gyp ./package/
        cd ./package
        npm install -g node-gyp
        npm install nan

        node-gyp rebuild
        #remove irrelevant packages
        #TODO: create new package for that matter
        echo "npm install"
        sed -i '/gulp/d' package.json
        sed -i '/babel/d' package.json
        sed -i '/eslint/d' package.json
        sed -i '/mongoose/d' package.json
        sed -i '/googleapis/d' package.json
        sed -i '/bower/d' package.json
        sed -i '/bootstrap/d' package.json
        sed -i '/browserify"/d' package.json
        sed -i '/rebuild/d' package.json
        sed -i '/nodetime/d' package.json
        sed -i '/newrelic/d' package.json
        sed -i '/istanbul/d' package.json
        sed -i '/npm-run-all/d' package.json
        sed -i '/heapdump/d' package.json
        sed -i '/selectize/d' package.json
        sed -i '/jsonwebtoken/d' package.json
        sed -i '/googleapis/d' package.json
        sed -i '/vsphere/d' package.json
        npm install -dd --production

        cd ..
        wget https://raw.githubusercontent.com/megastep/makeself/master/makeself-header.sh
        wget https://raw.githubusercontent.com/megastep/makeself/master/makeself.sh
        chmod 777 makeself.sh
        #replace -- with /S in order to use exactly the same flags like windows.
        sed -i s/'\--)'/'\/S)'/ makeself-header.sh
        rm -rf ./config.js ./package.json ./agent_conf.json
    else
      cd build/linux
    fi
    echo "building installer"
    cp ../../src/deploy/Linux/noobaa_local_s3_service.sh ./package/
    cp ../../src/deploy/Linux/noobaa_s3_service_installer.sh ./package/
    mkdir ./dist
    cp ../../src/deploy/Linux/setup.sh ./dist/
    ./makeself.sh ./package noobaa-installer 0.3.2 ./noobaa_s3_service_installer.sh
    mv noobaa-installer ./dist/noobaa-installer
    ./makeself.sh ./dist noobaa-s3-setup 0.3.2 ./setup.sh
    echo "noobaa-setup installer available under build/public/linux/"
    if [ ${UPLOAD_TO_S3} -eq 1 ]; then
        echo "uploading to S3"
        s3cmd -P put noobaa-setup s3://noobaa-core/noobaa-setup
    fi
fi
exit 0
