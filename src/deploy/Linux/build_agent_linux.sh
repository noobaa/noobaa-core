#!/bin/bash
set -e

function verbose()
{
    echo $*
    $*
}

[ ! -f "$NVM_DIR/nvm.sh" ] && export NVM_DIR="$HOME/.nvm"
[ ! -f "$NVM_DIR/nvm.sh" ] && export NVM_DIR="/nvm"
[ -f "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

verbose nvm install

# default - clean build
CLEAN=true
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
        echo "Unknown option $1"
        exit 1
        ;;
    esac
    shift
done

if [ "$GIT_COMMIT" != "0" ]
then
    echo "Updating package.json version for $GIT_COMMIT"
    GIT_COMMIT=${GIT_COMMIT:0:7}
    current_package_version="${current_package_version}-${GIT_COMMIT}"
    sed -i "s/${current_version_line}/    \"version\": \"${current_package_version}\",/" package.json
fi


#TODO: automate - build and sign executable as well.

if [ "$CLEAN" = true ]
then
    verbose rm -rf build/linux
    verbose mkdir -p build/linux/package/src
    verbose pushd build/linux/package

    verbose cp ../../../LICENSE .
    verbose cp ../../../config.js .
    verbose cp ../../../binding.gyp .
    verbose cp ../../../package.json .
    verbose cp ../../../src/deploy/Linux/noobaa_service_installer.sh .
    verbose cp ../../../src/deploy/Linux/uninstall_noobaa_agent.sh .
    verbose cp ../../../src/deploy/Linux/remove_service.sh .
    verbose cp $(nvm which current) .

    verbose cp -R ../../../src/s3 src/
    verbose cp -R ../../../src/sdk src/
    verbose cp -R ../../../src/endpoint src/
    verbose cp -R ../../../src/agent src/
    verbose cp -R ../../../src/rpc src/
    verbose cp -R ../../../src/api src/
    verbose cp -R ../../../src/util src/
    verbose cp -R ../../../src/tools src/
    verbose cp -R ../../../src/native src/

    # remove irrelevant packages
    verbose sed -i '/gulp/d' package.json
    verbose sed -i '/mocha/d' package.json
    verbose sed -i '/istanbul/d' package.json
    verbose sed -i '/eslint/d' package.json
    verbose sed -i '/vsphere/d' package.json

    verbose npm install --production
    verbose npm install node-linux@0.1.8

    verbose rm -rf agent_conf.json src/native
    verbose popd
fi

verbose pushd build/linux
echo "Building noobaa-installer"
verbose ../../src/deploy/makeself/makeself.sh ./package noobaa-installer $current_package_version ./noobaa_service_installer.sh
echo "Building noobaa-setup-$current_package_version"
verbose mkdir dist
verbose cp ../../src/deploy/Linux/setup.sh ./dist/
verbose mv noobaa-installer ./dist/noobaa-installer
verbose ../../src/deploy/makeself/makeself.sh ./dist noobaa-setup-$current_package_version $current_package_version ./setup.sh
md5sum noobaa-setup-$current_package_version | awk '{print $1}' > noobaa-setup-${current_package_version}.md5
verbose popd

echo "Done: build/linux/noobaa-setup-$current_package_version"
exit 0