/* Copyright (C) 2020 NooBaa */
'use strict';

const util = require('util');
const minimist = require('minimist');

const dbg = require('../util/debug_module')(__filename);
if (!dbg.get_process_name()) dbg.set_process_name('nscache');
dbg.original_console();

const ObjectSDK = require('../sdk/object_sdk');
const NamespaceCache = require('../sdk/namespace_cache');
const NamespaceS3 = require('../sdk/namespace_s3');
const BucketSpaceS3 = require('../sdk/bucketspace_s3');
const NamespaceNB = require('../sdk/namespace_nb');
const endpoint_stats_collector = require('../sdk/endpoint_stats_collector');
const config = require('../../config');

const HELP = `
Help:

    "nscache" is a noobaa-core command runs a local S3 endpoint
    that serves and caches data from a remote endpoint.
    For more information refer to the noobaa docs.
`;

const USAGE = `
Usage:

    noobaa-core nscache <endpoint-url> [options...]
`;

const ARGUMENTS = `
Arguments:

    <endpoint-url>       The remote endpoint to cache (e.g "http://server:8080")
`;

const OPTIONS = `
Options:

    --access_key <key>
    --secret_key <key>
    --region <region>      (default us-east-1) Set the S3 region of the bucket in case it is AWS endpoint.
    --http_port <port>     (default 6001)   Set the S3 endpoint listening HTTP port to serve.
    --https_port <port>    (default 6443)   Set the S3 endpoint listening HTTPS port to serve.
`;

const WARNINGS = `
WARNING:

    !!! This feature is WORK IN PROGRESS - please stay tuned !!!

    !!! NO AUTHENTICATION checks are done !!!
        - This means that any access/secret keys or anonymous requests
        - will allow access to the filesystem over the network.
`;

function print_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(ARGUMENTS.trimStart());
    console.warn(OPTIONS.trimStart());
    console.warn(WARNINGS.trimStart());
    process.exit(1);
}

async function main(argv = minimist(process.argv.slice(2))) {
    try {
        if (argv.help || argv.h) return print_usage();

        const http_port = Number(argv.http_port) || 6001;
        const https_port = Number(argv.https_port) || 6443;
        const hub_endpoint = argv._[0];
        if (!hub_endpoint) return print_usage();

        console.warn(WARNINGS);
        console.log('nscache: setting up ...', argv);

        const noop = () => undefined;
        const s3_params = {
            // TODO
            endpoint: hub_endpoint,
            region: argv.region || config.DEFAULT_REGION, // notice: we don't validate the region input
            credentials: {
                accessKeyId: argv.access_key,
                secretAccessKey: argv.secret_key,
            },
        };
        const bs = new BucketSpaceS3({ s3_params });
        const ns_nb = new NamespaceNB(); // TODO need to setup rpc_client
        const object_sdk = new ObjectSDK({
            rpc_client: null,
            internal_rpc_client: null,
            object_io: null,
            stats: endpoint_stats_collector.instance(),
        });

        // resolve namespace and bucketspace
        const namespaces = {};
        object_sdk._get_bucketspace = () => bs;
        object_sdk._get_bucket_namespace = async bucket_name => {
            const existing_ns = namespaces[bucket_name];
            if (existing_ns) return existing_ns;
            const ns_hub = new NamespaceS3({
                s3_params,
                namespace_resource_id: '998877',
                stats: endpoint_stats_collector.instance(),
            });
            const ns_cache = new NamespaceCache({
                namespace_hub: ns_hub,
                namespace_nb: ns_nb,
                caching: { ttl_ms: 3600000 },
                active_triggers: null,
                stats: endpoint_stats_collector.instance(),
            });
            namespaces[bucket_name] = ns_cache;
            return ns_cache;
        };

        object_sdk.get_auth_token = noop;
        object_sdk.set_auth_token = noop;
        object_sdk.authorize_request_account = noop;
        object_sdk.read_bucket_sdk_website_info = noop;
        object_sdk.read_bucket_sdk_namespace_info = noop;
        object_sdk.read_bucket_sdk_caching_info = noop;
        object_sdk.read_bucket_sdk_policy_info = noop;
        object_sdk.read_bucket_usage_info = noop;

        const endpoint = require('../endpoint/endpoint');
        await endpoint.main({
            http_port,
            https_port,
            init_request_sdk: (req, res) => { req.object_sdk = object_sdk; },
        });

        console.log('nscache: listening on', util.inspect(`http://localhost:${http_port}`));
        console.log('nscache: listening on', util.inspect(`https://localhost:${https_port}`));

    } catch (err) {
        console.error('nscache: exit on error', err.stack || err);
        process.exit(2);
    }
}

exports.main = main;

if (require.main === module) main();
