cd /noobaa-core/src/test/system_tests/
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
    echo "Running Bootstrap..."
    ./bootstrap
    touch ./s3tests/tests/__init__.py
    echo "Finished Running Bootstrap..."
fi