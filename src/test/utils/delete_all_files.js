/* Copyright (C) 2016 NooBaa */
'use strict';

const { S3OPS } = require('../utils/s3ops');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
dbg.set_process_name('delete_all_files');

const {
    server_ip,
    bucket = 'first.bucket',
    version = false
} = argv;

function usage() {
    console.log(`
    --server_ip     -   noobaa server ip.
    --bucket        -   bucket name (default: ${bucket})
    --version       -   use versioning (default: ${version})
    --help          -   show this help.
    `);
}

if (argv.help) {
    usage();
    process.exit(1);
}

const s3ops = new S3OPS();

async function clean_cloud_bucket(ip, bucket_to_clean, is_version) {
    let run_list = true;
    console.log(`cleaning all files from ${bucket_to_clean} in ${ip}`);
    while (run_list) {
        const list_files = await s3ops.get_list_files(ip, bucket_to_clean, '', { maxKeys: 1000, version: is_version });
        console.log(`list_files.length is ${list_files.length}`);
        if (list_files.length < 1000) {
            run_list = false;
        }
        for (const file of list_files) {
            if (is_version) {
                await s3ops.delete_file(ip, bucket_to_clean, file.Key, file.VersionId);
            } else {
                await s3ops.delete_file(ip, bucket_to_clean, file.Key);
            }
        }
    }
}

clean_cloud_bucket(server_ip, bucket, version);
