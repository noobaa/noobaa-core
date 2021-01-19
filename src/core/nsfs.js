/* Copyright (C) 2020 NooBaa */
'use strict';

const fs = require('fs');
// const path = require('path');
const http = require('http');
const events = require('events');
const minimist = require('minimist');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nsfs');
dbg.original_console();

const s3_rest = require('../endpoint/s3/s3_rest');
const endpoint_utils = require('../endpoint/endpoint_utils');
const ObjectSDK = require('../sdk/object_sdk');
const NamespaceFS = require('../sdk/namespace_fs');
const BucketSpaceFS = require('../sdk/bucketspace_fs');

const HELP = `
Help:

    "nsfs" is a noobaa-core command runs a local S3 endpoint on top of a filesystem.
    Each sub directory of the root filesystem represents an S3 bucket.
    Objects data and meta-data is stored and retrieved from the files.
    For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    noobaa-core nsfs <root-path> [options...]
`;

const ARGUMENTS = `
Arguments:

    <root-path>      Set the root of the filesystem where each subdir is a bucket.
`;

const OPTIONS = `
Options:

    --port <port>    (default 6001)   Set the S3 endpoint listening port to serve.
`;

const WARNINGS = `
WARNING:

    !!! This feature is EXPERIMENTAL      !!!

    !!! NO AUTHENTICATION checks are done !!!
        - This means that any access/secret keys or anonymous requests
        - will allow access to the filesystem over the network.
`;

function print_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimLeft());
    console.warn(ARGUMENTS.trimLeft());
    console.warn(OPTIONS.trimLeft());
    console.warn(WARNINGS.trimLeft());
    process.exit(1);
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        if (argv.help || argv.h) return print_usage();
        const port = Number(argv.port) || 6001;
        const fs_root = argv._[0];
        if (!fs_root) return print_usage();

        if (!fs.existsSync(fs_root)) {
            console.error('Error: Root path not found', fs_root);
            return print_usage();
        }

        console.warn(WARNINGS);
        console.log('nsfs: setting up ...', { fs_root, port });

        const noop = /** @type {any} */ () => {
            // TODO
        };
        // const object_sdk = {
        //     get_auth_token: noop,
        //     set_auth_token: noop,
        //     authorize_request_account: noop,
        //     read_bucket_sdk_website_info: noop,
        //     read_bucket_sdk_namespace_info: noop,
        //     read_bucket_sdk_caching_info: noop,
        //     read_bucket_sdk_policy_info: noop,
        //     read_bucket_usage_info: noop,
        // };

        const bs = new BucketSpaceFS({ fs_root });
        const ns = new NamespaceFS({ fs_root });
        const object_sdk = new ObjectSDK(null, null, null);
        object_sdk._get_bucketspace = () => bs;
        object_sdk._get_bucket_namespace = async name => ns;
        object_sdk.get_auth_token = noop;
        object_sdk.set_auth_token = noop;
        object_sdk.authorize_request_account = noop;
        object_sdk.read_bucket_sdk_website_info = noop;
        object_sdk.read_bucket_sdk_namespace_info = noop;
        object_sdk.read_bucket_sdk_caching_info = noop;
        object_sdk.read_bucket_sdk_policy_info = noop;
        object_sdk.read_bucket_usage_info = noop;

        const http_server = http.createServer((req, res) => {
            endpoint_utils.prepare_rest_request(req);
            Object.assign(req, { object_sdk, virtual_hosts: [] });
            return s3_rest.handler(req, res);
        });

        http_server.listen(port);
        await events.once(http_server, 'listening');
        console.log(`nsfs: listening on http://localhost:${port}`);

    } catch (err) {
        console.error('nsfs: exit on error', err.stack || err);
        process.exit(2);
    }
}

exports.main = main;

if (require.main === module) main();
