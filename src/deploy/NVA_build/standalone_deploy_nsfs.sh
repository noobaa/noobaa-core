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
    # Add accounts to run ceph tests
    execute "node src/cmd/manage_nsfs account add --name cephalt --new_buckets_path ${FS_ROOT_1} --uid 1000 --gid 1000" nsfs_cephalt.log
    execute "node src/cmd/manage_nsfs account add --name cephtenant --new_buckets_path ${FS_ROOT_2} --uid 2000 --gid 2000" nsfs_cephtenant.log

    # Start nsfs server
    execute "node src/cmd/nsfs" nsfs.log

    # Wait for sometime to process to start
    sleep 10
}
# call main function
main
