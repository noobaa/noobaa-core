#!/bin/bash

echo "disk usage of agent_storage:"
du -sh agent_storage/*

./are_you_sure.sh || exit $?

echo ""
echo ""
echo "running ..."
echo ""

DB="mongo admin -u nbadmin -p roonoobaa --quiet --eval"
echo "removing DataBlocks  ..." `$DB 'db.getSiblingDB("nbcore").datablocks.remove({})'`
echo "removing DataChunks  ..." `$DB 'db.getSiblingDB("nbcore").datachunks.remove({})'`
echo "removing ObjectParts ..." `$DB 'db.getSiblingDB("nbcore").objectparts.remove({})'`
echo "removing ObjectMDs   ..." `$DB 'db.getSiblingDB("nbcore").objectmds.remove({})'`
echo "removing Nodes       ..." `$DB 'db.getSiblingDB("nbcore").nodes.remove({})'`
echo "done."
echo ""

echo "deleting agent_storage/* ..."
rm -rf agent_storage/*
echo "done."
echo ""
