#!/bin/bash

echo "disk usage of agent_storage:"
du -sh agent_storage/*

./are_you_sure.sh || exit $?

echo ""
echo ""
echo "running ..."
echo ""

DB="mongo nbcore --quiet --eval"
echo "removing DataBlocks  ..." `$DB 'db.datablocks.remove({})'`
echo "removing DataChunks  ..." `$DB 'db.datachunks.remove({})'`
echo "removing ObjectParts ..." `$DB 'db.objectparts.remove({})'`
echo "removing ObjectMDs   ..." `$DB 'db.objectmds.remove({})'`
echo "done."
echo ""

echo "deleting agent_storage/*/blocks ..."
rm -rf agent_storage/*/blocks
echo "done."
echo ""
