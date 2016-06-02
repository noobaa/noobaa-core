#!/bin/bash
DIRECTORY="s3-tests"
CEPH_LINK="https://github.com/ceph/s3-tests.git"

if [ ! -d $DIRECTORY ]; then
    echo "Downloading Ceph S3 Tests..."
    git clone $CEPH_LINK
    echo "Finished Downloading Ceph S3 Tests"
fi

echo "Installing virtualenv using PIP..."
pip install virtualenv
echo y
echo "Finished Installing virtualenv"

echo "Installing libxml2, libxslt..."
brew install libxml2
brew install libxslt
brew link libxml2 --force
brew link libxslt --force
echo "Finished Installing libxml2, libxslt..."

echo "Running Bootstrap..."
cd $DIRECTORY
./bootstrap
