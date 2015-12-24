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
echo "removing Nodes       ..." `$DB 'db.nodes.remove({})'`
echo "done."
echo ""

echo "deleting agent_storage/* ..."
rm -rf agent_storage/*
echo "done."
echo ""
