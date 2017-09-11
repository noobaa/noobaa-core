#!/bin/bash
set -e

source ~/.bashrc || true
source "$NVM_DIR/nvm.sh" || true
source /opt/rh/devtoolset-2/enable || true

nvm install 
nvm alias default $(nvm current)

# default - clean build
CLEAN=true;
GIT_COMMIT=0

#extract version from package.json
current_package_version=$(grep version package.json|awk '{print $2}'|awk -F'"' '{print $2}')

#"version": "0.4.0",
current_version_line=$(grep version package.json)


#extract parms
while [[ $# > 0 ]]; do
  key=$(echo $1 | sed "s:\(.*\)=.*:\1:")
  case $key in
      --clean)
      CLEAN=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
      --GIT_COMMIT)
      GIT_COMMIT=$(echo $1 | sed "s:.*=\(.*\):\1:")
      ;;
    *)
      usage
      # unknown option
      ;;
  esac
  shift
done

if [ "$GIT_COMMIT"!=0 ] ; then
    GIT_COMMIT=${GIT_COMMIT:0:7}
    sed -i "s/$current_version_line/\"version\": \"$current_package_version-$GIT_COMMIT\",/g" package.json
    current_package_version=$(grep version package.json|awk '{print $2}'|awk -F'"' '{print $2}')
fi


#TODO: automate - build and sign executable as well.

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
    cp $(nvm which current) ./package/
    mkdir ./package/src/
    cp -R ../../src/s3 ./package/src/
    cp -R ../../src/sdk ./package/src/
    cp -R ../../src/endpoint ./package/src/
    cp -R ../../src/agent ./package/src/
    cp -R ../../src/rpc ./package/src/
    cp -R ../../src/api ./package/src/
    cp -R ../../src/util ./package/src/
    cp -R ../../src/tools ./package/src/
    cp -R ../../src/native ./package/src/
    cp -R ../../binding.gyp ./package/

    #remove irrelevant packages
    #TODO: create new package for that matter
    cd package
    sed -i '/gulp/d' package.json
    sed -i '/mocha/d' package.json
    sed -i '/istanbul/d' package.json
    sed -i '/eslint/d' package.json
    sed -i '/vsphere/d' package.json

    echo "npm install"
    npm install --production
    echo "npm install node-linux@0.1.8"
    npm install node-linux@0.1.8

    echo "make self extracting package"
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
cp ../../src/deploy/Linux/noobaa_service_installer.sh ./package/
cp ../../src/deploy/Linux/uninstall_noobaa_agent.sh ./package/
cp ../../src/deploy/Linux/remove_service.sh ./package/
mkdir ./dist
cp ../../src/deploy/Linux/setup.sh ./dist/
./makeself.sh ./package noobaa-installer $current_package_version ./noobaa_service_installer.sh
mv noobaa-installer ./dist/noobaa-installer
./makeself.sh ./dist noobaa-setup-$current_package_version $current_package_version ./setup.sh
echo "noobaa-setup installer available under build/public/linux/"

exit 0
