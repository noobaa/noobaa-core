#!/bin/bash

function execute() {
    if [[ -z "${CEPH_TEST_LOGS_DIR}" ]]; then
        $1 &
    else
        $1 2>&1 | tee "${CEPH_TEST_LOGS_DIR}/${2}" &
    fi
}

# Please note that the command we use here are without "sudo" because we are running from the container with Root permissions
function main() {
    # Start noobaa service
    execute "node src/cmd/nsfs" nsfs.log
    # Wait for sometime to process to start
    sleep 10
}
# call main function
main
