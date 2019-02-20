#!/bin/bash

export GOPATH=$PWD/gocode

if [ ! -d "$GOPATH/src/github.com/operator-framework" ]; then
    echo "getting operator-sdk code"
    mkdir -p $GOPATH/src/github.com/operator-framework
    cd $GOPATH/src/github.com/operator-framework
    git clone https://github.com/operator-framework/operator-sdk
    cd operator-sdk
    #git checkout master
    echo "building opeartor-sdk"
    make dep
    make install
fi
echo "getting dependencies. might take some time.."
cd $GOPATH/src/noobaa-operator
dep ensure -v
echo "building noobaa-operator.."
operator-sdk build noobaa-operator
echo "completed!"