#!/bin/bash

function execute() {
    if [[ -z "${CEPH_TEST_LOGS_DIR}" ]]; then
        $1 &
    else
        $1 2>&1 | tee "${CEPH_TEST_LOGS_DIR}/${2}" &
    fi
}

function main() {
    # Add accounts to run ceph tests
    execute "node src/cmd/manage_nsfs account add --config_root ./standalone/config_root --name cephalt --email ceph.alt@noobaa.com --new_buckets_path ./standalone/nsfs_root --access_key abcd --secret_key abcd --uid 100 --gid 100" nsfs_cephalt.log
    execute "node src/cmd/manage_nsfs account add --config_root ./standalone/config_root --name cephtenant --email ceph.tenant@noobaa.com --new_buckets_path ./standalone/nsfs_root --access_key efgh --secret_key efgh --uid 200 --gid 200" nsfs_cephtenant.log
    # Start nsfs server
    execute "node src/cmd/nsfs --config_root ./standalone/config_root" nsfs.log
    # Wait for sometime to process to start
    sleep 10
}
# call main function
main
