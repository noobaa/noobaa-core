#!/bin/bash

# This script runs build_agent_linux.sh inside a docker container
# so that the build will run against old linux glibc shared libraries
# this was origianlly based on dockcross/manylinux-x64 which bundles centos-5 with gcc-4.8
# (https://github.com/dockcross/dockcross) however since node.js v8 doesn't support glibc 2.5
# and dropped the support for centos-5 we moved to use centos 6 directly.

IMAGE="noobaa/manylinux-x64"
DOCKERFILE="src/deploy/Linux/Dockerfile.noobaa-manylinux-x64"
# use the same user ids as the current user
USER_IDS="-e BUILDER_UID=$(id -u) -e BUILDER_GID=$(id -g) -e BUILDER_USER=$(id -un) -e BUILDER_GROUP=$(id -gn)"
# map the current directory as /work dir in the container
HOST_VOLUMES="-v $PWD:/work"
# when running inside a tty we can also run docker interactively
tty -s && TTY_ARGS="-it" || TTY_ARGS=""
SCL_COMMAND="scl enable devtoolset-7"
BUILD_COMMAND="bash -c \"src/deploy/Linux/build_agent_linux.sh $@\""

# deleting files is significantly slower within docker, so prefer to clean here before
mkdir -p build
rm -rf build/linux

# build image which includes all the tools needed for building
# this stage will be cached by docker after the first run
docker build \
    -f $DOCKERFILE \
    -t $IMAGE \
    . \
    || exit 1

# run the build command inside the container
docker run --rm \
    $TTY_ARGS \
    $USER_IDS \
    $HOST_VOLUMES \
    $IMAGE \
    $SCL_COMMAND \
    "$BUILD_COMMAND" \
    || exit 1
