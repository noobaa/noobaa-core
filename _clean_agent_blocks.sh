echo "disk usage of agent_storage:"
du -sh agent_storage/*
echo "deleting agent_storage/*/blocks/* ..."
rm -rf agent_storage/*/blocks/*
echo "done."
