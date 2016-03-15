#!/bin/bash

echo "GOING TO DELETE agent_storage AND DROP DATABASE!!!"
./are_you_sure.sh || exit $?

echo ""
echo ""
echo "running ..."
echo ""

DB="mongo nbcore --quiet --eval"
echo "droping database  ..." `$DB 'db.dropDatabase()'`
echo "done."
echo ""

echo "deleting agent_storage/ ..."
rm -rf agent_storage/
echo "done."
echo ""
