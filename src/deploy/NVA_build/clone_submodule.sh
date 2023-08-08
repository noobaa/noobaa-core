#!/bin/bash

enabled=`printf '%s\n' "${!4}"`
echo $enabled
if [ -z "$enabled" ]; then
	echo "not en"
	exit 0
fi
if [ $enabled -ne 1 ]; then
	echo "exit"
	exit 0
fi
echo "done"
mkdir -p $1 
cd $1 
git init
git remote add origin $2
git fetch origin $3 --depth=1
git reset --hard FETCH_HEAD
rm -rf .git
