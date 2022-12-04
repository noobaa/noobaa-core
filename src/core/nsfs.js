/* Copyright (C) 2020 NooBaa */
'use strict';

const fs = require('fs');
const util = require('util');
const minimist = require('minimist');
const SensitiveString = require('../util/sensitive_string');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nsfs');
dbg.original_console();

const config = require('../../config');
const nb_native = require('../util/nb_native');
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

    --http_port <port>     (default 6001)           Set the S3 endpoint listening HTTP port to serve.
    --https_port <port>    (default 6443)           Set the S3 endpoint listening HTTPS port to serve.
    --uid <uid>            (default process uid)    Send requests to the Filesystem with uid.
    --gid <gid>            (default process gid)    Send requests to the Filesystem with gid.
    --backend <fs>         (default "")             Set default backend fs "".
    --debug <level>        (default 0)              Increase debug level
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
        if (argv.debug) {
            const debug_level = Number(argv.debug) || 5;
            dbg.set_module_level(debug_level, 'core');
            nb_native().fs.set_debug_level(debug_level);
        }
        const http_port = Number(argv.http_port) || 6001;
        const https_port = Number(argv.https_port) || 6443;
        const backend = argv.backend || (process.env.GPFS_DL_PATH ? 'GPFS' : '');
        const fs_root = argv._[0];
        if (!fs_root) return print_usage();

        let fs_config = {
            uid: Number(argv.uid) || process.getuid(),
            gid: Number(argv.gid) || process.getgid(),
            backend,
            warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
        };

        if (!fs.existsSync(fs_root)) {
            console.error('Error: Root path not found', fs_root);
            return print_usage();
        }

        console.warn(WARNINGS);
        console.log('nsfs: setting up ...', { fs_root, http_port, https_port, backend });

        const endpoint = require('../endpoint/endpoint');
        await endpoint.start_endpoint({
            http_port,
            https_port,
            init_request_sdk: (req, res) => init_request_sdk(req, res, fs_root, fs_config),
        });

        console.log('nsfs: listening on', util.inspect(`http://localhost:${http_port}`));
        console.log('nsfs: listening on', util.inspect(`https://localhost:${https_port}`));

    } catch (err) {
        console.error('nsfs: exit on error', err.stack || err);
        process.exit(2);
    }
}

function init_request_sdk(req, res, fs_root, fs_config) {
    const noop = /** @type {any} */ () => {
        // TODO
    };

    const bs = new BucketSpaceFS({ fs_root });
    const object_sdk = new ObjectSDK(null, null, null);

    // resolve namespace and bucketspace
    const namespaces = {};
    object_sdk._get_bucketspace = () => bs;
    object_sdk._get_bucket_namespace = async bucket_name => {
        const existing_ns = namespaces[bucket_name];
        if (existing_ns) return existing_ns;
        const ns_fs = new NamespaceFS({
            fs_backend: fs_config.backend,
            bucket_path: fs_root + '/' + bucket_name,
            bucket_id: '000000000000000000000000',
            namespace_resource_id: undefined
        });
        namespaces[bucket_name] = ns_fs;
        return ns_fs;
    };

    object_sdk.get_auth_token = noop;
    object_sdk.set_auth_token = noop;
    object_sdk.authorize_request_account = noop;
    object_sdk.read_bucket_sdk_website_info = noop;
    object_sdk.read_bucket_sdk_namespace_info = noop;
    object_sdk.read_bucket_sdk_caching_info = noop;
    object_sdk.read_bucket_sdk_policy_info = async bucket_name => ({
        s3_policy: {
                version: '2012-10-17',
                statement: [
                {
                    effect: 'allow',
                    action: [ 's3:*' ],
                    principal: [ new SensitiveString('*')],
                    resource: [ `arn:aws:s3:::${bucket_name}/*` ]
                }]
        },
        system_owner: undefined,
        bucket_owner: undefined,
    });
    object_sdk.read_bucket_usage_info = noop;
    object_sdk.requesting_account = {
        nsfs_account_config: fs_config
    };
    req.object_sdk = object_sdk;
}

exports.main = main;

if (require.main === module) main();
