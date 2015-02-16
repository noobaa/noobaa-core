#!/bin/sh
mongo clear_db.js
rm -rf agent_storage
#mkfifo pipe
echo "===> write 'create_some(5)' when up then CTRL+c twice when done. notice web server must be up <==="
node src/agent/agent_cli.js #< pipe &
#my_child_PID=$!
#sleep 15
#echo "create_some(1)"
#echo "create_some(1)" > pipe
#sleep 15
#echo "stopping"
#kill -9 $my_child_PID
#rm pipe
