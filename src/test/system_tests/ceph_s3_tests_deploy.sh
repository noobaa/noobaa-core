#!/bin/bash

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
CEPH_TESTS_VERSION=fa979f416da0a59950cf65215487631e530e6b18
if [ ! -d $DIRECTORY ]; then
    echo "Downloading Ceph S3 Tests..."
    git clone $CEPH_LINK
    cd ${DIRECTORY}
    git checkout ${CEPH_TESTS_VERSION}
    echo "Finished Downloading Ceph S3 Tests"
fi
