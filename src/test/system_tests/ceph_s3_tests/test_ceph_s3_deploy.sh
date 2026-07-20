#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

if [ -z ${1} ]
then
    NOOBAA_DIR="noobaa-core"
else 
    NOOBAA_DIR=${1}
fi

CEPH_S3_TESTS_PATH="src/test/system_tests/ceph_s3_tests"
mkdir -p /${NOOBAA_DIR}/${CEPH_S3_TESTS_PATH}
cd /${NOOBAA_DIR}/${CEPH_S3_TESTS_PATH}

DIRECTORY="s3-tests"
CEPH_LINK="https://github.com/ceph/s3-tests.git"
# using a fixed version (commit) of ceph tests to avoid sudden changes. 
# we should retest and update the version once in a while
CEPH_TESTS_VERSION=dd6195cfb7ec97a178cb4aca5a8fbfb1d209607e
if [ ! -d $DIRECTORY ]; then
    echo "Downloading Ceph S3 Tests..."
    git clone $CEPH_LINK
    cd ${DIRECTORY}
    git checkout ${CEPH_TESTS_VERSION}
    echo "Finished Downloading Ceph S3 Tests"
fi
