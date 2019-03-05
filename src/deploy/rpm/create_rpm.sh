#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'
set -x

spec_name="noobaa.spec"
files_location="/tmp/"

OPTIONS=$( getopt -o 'h,l:' --long "help,location:" -- "$@" )
eval set -- "${OPTIONS}"

function usage(){
    set +x
    echo "$0 [options]"
    echo -e "\nPlace the noobaa tarball, deploy_base.sh and the noobaa.spec in a folder"
    echo -e "you can change the default location (\e[32m${files_location}\e[0m) by using the -l/--location flag\n"
    echo "-l --location     -   The files location (default: ${files_location})"
    echo "-h --help         -   Will show this help"
    exit 0
}

while true
do
    case ${1} in
        -l|--location)  files_location=${2};
                        shift 2;;
		-h|--help)	    usage;;
		--)			    shift 1;
					    break ;;
    esac
done

function defining_the_spec(){   
    local version=${1}
    local revision=${2}
    sed -i "s/%define revision.*/%define revision ${revision}/g" ${files_location}/${spec_name}
    sed -i "s/%define noobaaver.*/%define noobaaver ${version}/g" ${files_location}/${spec_name}
}

function create_rpm(){
    local version=${1}
    local revision=${2}
    #We need to install rpm tools once, if we dont have them we can install
    #with the 2 line below: 
    #yum install -y tree dnf
    #dnf install rpm-build rpm-devel rpmlint rpmdevtools

    rpmdev-setuptree
    echo "time for ${0} in sec: ${SECONDS}"
    cp ${files_location}/${spec_name} ~/rpmbuild/SPECS/
   
    cp  ${files_location}/noobaa-NVA-${version}-${revision}.tar.gz ~/rpmbuild/SOURCES/
    cp ${files_location}/deploy_base.sh ~/rpmbuild/SOURCES/
    current_directory=$(pwd)
    cd ~/rpmbuild/SPECS/
    local srpm=$(rpmbuild -bs noobaa.spec)
    cd ${current_directory}
    cp ${srpm//Wrote: /} build/public/
    cd ~/rpmbuild/SPECS/
    echo "+++ ${srpm//Wrote: /} +++"
    rpmbuild --rebuild ${srpm//Wrote: /}
}

function verify_pre_requirements(){
    number_of_tarballs=$(ls -l ${files_location}/noobaa*tar.gz | wc -l)
    if [ ${number_of_tarballs} -ne 1 ]
    then
        echo "The number of noobaa tars in ${files_location} is ${number_of_tarballs}"
        echo "the number of noobaa files should be 1, Exiting."
        exit 1
    fi
    if [ ! -f ${files_location}/noobaa*.tar.gz ]
    then 
        echo "there is no tarball in ${files_location}, Exiting"
        exit 1
    fi
    if [ ! -f ${files_location}/deploy_base.sh ]
    then
        echo "there is no deploy_base.sh in ${files_location}, Exiting"
        exit 1
    fi
    if [ ! -f ${files_location}/noobaa.spec ]
    then 
        echo "there is no noobaa.spec in ${files_location}, Exiting"
        exit 1
    fi
}

function main() { 
    local details=($(ls ${files_location}/noobaa*gz | sed -e 's/.*noobaa-NVA-//g' -e 's/.tar.*//g' -e 's/-/ /g'))
    local version=${details[0]}
    local revision=${details[1]}
    verify_pre_requirements
    defining_the_spec ${version} ${revision}
    create_rpm ${version} ${revision}
}

main