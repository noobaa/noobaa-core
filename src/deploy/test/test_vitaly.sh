#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'

vitaly_DNS="vitaly-7-test.westus2.cloudapp.azure.com"
longOpt="help,packageLocation:,gitCommit:"
shortOpt="h,p:,g:"

function usage(){
    echo -e "\n$0 [options]"
    echo "-p --packageLocation package location"
    echo "-g --remount will remount the last disk to exclude directory"
    echo "-h --help will show this help"
    exit 1
}

OPTIONS=$(getopt -o "${shortOpt}" --long "${longOpt}" -- "$@")
eval set -- "${OPTIONS}"

while true
do
    case ${1} in
		-p|--packageLocation)   package_location=${2} 
                                shift 2 ;;
        -r|--gitCommit)         GIT_COMMIT=${2}
                                shift 2;;
		-h|--help)              usage;;
		--)                     shift 1;
		                        break ;;
    esac
done

if [ -z ${package_location} ]
then
    echo -e "\nThe packageLocation flag is expected"
    usage
elif [ -z ${GIT_COMMIT} ]
then
    echo -e "\nThe gitCommit flag is expected"
    usage
fi

mkdir -p report
echo "package_location: ${package_location}"
echo "GIT_COMMIT: ${GIT_COMMIT}"

cat /etc/issue

fname=$(ls $package_location | grep tar)
if [ -z ${fname} ]
then
    echo "variable fname is not exist, Exiting."
    exit 1
fi

#source /opt/rh/python27/enable
#source /opt/rh/devtoolset-2/enable
source ${NVM_DIR}/nvm.sh
nvm install

echo "prepare workspace"

mkdir agent_storage
cp /data/.env .env
echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" >> .env
echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" >> .env

#TODO: unsafe-perm is needed because we run as root and is a bad practice 
#      because it runs deps npm scripts as root on our machine!
npm install --unsafe-perm

echo "starting the sanity_build_test phase"
node src/test/system_tests/sanity_build_test.js \
--upgrade_pack $package_location/$fname \
--target_ip ${vitaly_DNS}

echo "starting the runner phase"
node src/test/framework/runner.js --GIT_VERSION ${GIT_COMMIT:0:7}
