#!/bin/bash

export GOPATH=$PWD/gocode

GREEN='\033[0;32m'
NC='\033[0m' # No Color

if [ ! -d "$GOPATH/src/github.com/operator-framework" ]; then
    echo -e "${GREEN}getting operator-sdk code${NC}"
    mkdir -p $GOPATH/src/github.com/operator-framework
    cd $GOPATH/src/github.com/operator-framework
    git clone https://github.com/operator-framework/operator-sdk
    cd operator-sdk
    #git checkout master
    echo -e "${GREEN}building opeartor-sdk${NC}"
    make dep
    make install
fi
echo -e "${GREEN}getting dependencies. might take some time..${NC}"
cd $GOPATH/src/noobaa-operator
dep ensure -v
echo -e "${GREEN}building noobaa-operator..${NC}"
operator-sdk build noobaa-operator
echo -e "${GREEN}completed!${NC}"