#!/bin/bash

# This script runs build_agent_linux.sh inside a docker container
# so that the build will run against old linux glibc shared libraries
# this is based on dockcross/manylinux-x64 which bundles centos-5 with gcc-4.8
# see https://github.com/dockcross/dockcross
mkdir -p build

# build noobaa-manylinux-x64 image which adds node.js on top of dockcross/manylinux-x64
# docker will use cached build if available
docker build -f src/deploy/Linux/Dockerfile.noobaa-manylinux-x64 -t noobaa-manylinux-x64 . || exit 1

# generate the wrapper script
docker run --rm noobaa-manylinux-x64 > build/noobaa-manylinux-x64 || exit 1

# cleaning is significantly slower within docker, so prefer to clean here before
rm -rf build/linux

# run build_agent_linux.sh inside the container
bash build/noobaa-manylinux-x64 src/deploy/Linux/build_agent_linux.sh "$@" || exit 1
