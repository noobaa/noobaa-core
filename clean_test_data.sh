#!/bin/bash

read -p "1. Are you sure? [y/N] " -n 1 -r
echo    # (optional) move to a new line
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "You managed to abort me. bye."
    exit 1
fi

read -p "2. Still sure? [y/N] " -n 1 -r
echo    # (optional) move to a new line
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "You almost fooled me. bye."
    exit 1
fi

read -p "3. Last chance? [y/N] " -n 1 -r
echo    # (optional) move to a new line
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "You are living on the edge. bye."
    exit 1
fi

echo -n "4. You have 3 seconds to abort ... "
for i in `seq 3`
do
    echo -n "$i "
    sleep 1
done
echo ""
echo ""
echo "running ..."

echo ""
mongo nbcore _clean_db_objects.js

echo ""
source _clean_agent_blocks.sh
