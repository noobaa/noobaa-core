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

async function main() {
    await s3ops.delete_all_objects_in_bucket(server_ip, bucket, version);
}

main();
