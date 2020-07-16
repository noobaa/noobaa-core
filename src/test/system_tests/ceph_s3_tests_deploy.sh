#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

if [ -z ${1} ]
then
    NOOBAA_DIR="noobaa-core"
else 
    NOOBAA_DIR=${1}
fi

mkdir -p /${NOOBAA_DIR}/src/test/system_tests/
cd /${NOOBAA_DIR}/src/test/system_tests/

DIRECTORY="s3-tests"
CEPH_LINK="https://github.com/ceph/s3-tests.git"
# using a fixed version (commit) of ceph tests to avoid sudden changes. 
# we should retest and update the version once in a while
CEPH_TESTS_VERSION=13452bd25fdc5307afba9e93599fbfc87b4669c1
if [ ! -d $DIRECTORY ]; then
    echo "Downloading Ceph S3 Tests..."
    git clone $CEPH_LINK
    cd ${DIRECTORY}
    git checkout ${CEPH_TESTS_VERSION}
    echo "Finished Downloading Ceph S3 Tests"
fi

commit_epoch=$(git show -s --format=%ci ${CEPH_TESTS_VERSION} | awk '{print $1}')
commit_date=$(date -d ${commit_epoch} +%s)
current_date=$(date +%s)

if [ $((current_date-commit_date)) -gt $((3600*24*240)) ]
then
    echo "ceph tests were not updated for 240 days, Exiting"
    exit 1
fi
