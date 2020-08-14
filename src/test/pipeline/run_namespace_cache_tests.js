/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const api = require('../../api');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
const { CloudFunction } = require('../utils/cloud_functions');
const { BucketFunctions } = require('../utils/bucket_functions');
const { mk_test_name, NamespaceContext } = require('../utils/namespace_context');
const config = require('../../../config.js');
const { assert } = require('console');

const ns_cache_test_normal = require('./namespace_cache_normal_test');
const ns_cache_test_range_read = require('./namespace_cache_range_read_test');
const ns_cache_test_large_file = require('./namespace_cache_large_file_test');

const caching_tests = [
    ns_cache_test_normal,
    ns_cache_test_range_read,
];

if (config.NAMESPACE_CACHING.DISABLE_BUCKET_FREE_SPACE_CHECK) {
    caching_tests.push(ns_cache_test_large_file);
}

const test_suite_name = 'namespace_cache';
dbg.set_process_name(test_suite_name);

require('../../util/dotenv').load();

const {
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    COS_ACCESS_KEY_ID,
    COS_SECRET_ACCESS_KEY,
    CACHE_TTL_MS,
    SYSTEM_NAME,
    NB_ACCESS_KEY_ID,
    NB_SECRET_ACCESS_KEY,
} = process.env;

const DEFAULT_CACHE_TTL_MS = 10000;
const cache_ttl_ms = _.defaultTo(CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);

const block_size = config.NAMESPACE_CACHING.DEFAULT_BLOCK_SIZE;
// Check again since some test requires that block_size is greater than max inline size
assert(block_size >= (config.INLINE_MAX_SIZE * 3));

const cloud_list = [];
if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
    cloud_list.push('AWS');
}
if (COS_ACCESS_KEY_ID && COS_SECRET_ACCESS_KEY) {
    cloud_list.push('COS');
}
if (cloud_list.length === 0) {
    console.warn(`Missing cloud credentials, Exiting.`);
    process.exit(0);
}

//define colors
const GREEN = "\x1b[32;1m";
const NC = "\x1b[0m";

//defining the required parameters
const {
    mgmt_ip,
    mgmt_port_https,
    s3_ip,
    s3_port,
    skip_clean = false,
    skip_clean_conn = false,
    clean_start = true,
    help = false
} = argv;

function usage() {
    console.log(`
    --mgmt_ip           -   noobaa management ip.
    --mgmt_port_https   -   noobaa server management https port
    --s3_ip             -   noobaa s3 ip
    --s3_port           -   noobaa s3 port
    --skip_clean        -   skipping cleaning env
    --skip_clean_conn   -   skipping cleaning connection
    --clean_start       -   fail the test if connection, resource or bucket exists
    --help              -   show this help.
    `);
}

if (help) {
    usage();
    process.exit(1);
}

const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
const rpc_client = rpc.new_client({});

const cf = new CloudFunction(rpc_client);
const bucket_functions = new BucketFunctions(rpc_client);

const aws_connection = cf.getAWSConnection();
const cos_connection = cf.getCOSConnection();

const s3ops_nb = new S3OPS(NB_ACCESS_KEY_ID ? { ip: s3_ip, port: s3_port, use_https: false, sig_ver: 'v2',
    access_key: NB_ACCESS_KEY_ID, secret_key: NB_SECRET_ACCESS_KEY } : { ip: s3_ip, port: s3_port });

const s3ops_aws = new S3OPS({
    ip: 's3.amazonaws.com',
    access_key: aws_connection.identity,
    secret_key: aws_connection.secret,
    system_verify_name: 'AWS',
});
const s3ops_cos = new S3OPS({
    ip: 's3.us-east.cloud-object-storage.appdomain.cloud',
    access_key: cos_connection.identity,
    secret_key: cos_connection.secret,
    system_verify_name: 'COS',
});

const connections_mapping = { COS: cos_connection, AWS: aws_connection };

//variables for using creating namespace resource
const namespace_mapping = {
    AWS: {
        s3ops: s3ops_aws,
        pool: 'cloud-resource-aws',
        bucket1: 'QA-Bucket',
        bucket2: 'qa-aws-bucket',
        namespace: 'aws-resource-namespace',
        gateway: 'aws-gateway-bucket'
    },
    COS: {
        s3ops: s3ops_cos,
        pool: 'cloud-resource-cos',
        bucket1: 'nb-ft-test1',
        bucket2: 'nb-ft-test2',
        namespace: 'cos-resource-namespace',
        gateway: 'cos-gateway-bucket'
    }
};

const test_scenarios = [
    'delete object from namespace bucket via noobaa endpoint',
    'create external connection',
    'delete external connection',
    'create namespace resource',
    'delete namespace resource',
    'create namespace bucket with caching enabled',
    'delete namespace bucket with caching enabled',
];

const report = new Report();

const test_cases = [];
const test_conf = {};

for (const tests of caching_tests) {
    test_scenarios.push(...tests.test_scenarios);
}

for (const t of test_scenarios) {
    for (const cloud of cloud_list) {
        test_cases.push(mk_test_name(t, cloud));
        test_conf[cloud] = true;
    }
}

report.init_reporter({ suite: test_suite_name, conf: test_conf, mongo_report: true, cases: test_cases });

const ns_context = new NamespaceContext({
    rpc_client,
    namespace_mapping,
    noobaa_s3ops: s3ops_nb,
    report,
    cache_ttl_ms,
    block_size
});
async function set_rpc_and_create_auth_token() {
    const auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: SYSTEM_NAME ? SYSTEM_NAME : 'demo'
    };
    return rpc_client.create_auth_token(auth_params);
}

async function create_account_resources(type) {
    let connection_name;
    try {
        connection_name = await cf.getConnection(connections_mapping[type].endpoint);
        if (connection_name) {
            console.log(`connection ${connections_mapping[type].endpoint} exists under the name ${connection_name}`);
        } else {
            //create connection
            await cf.createConnection(connections_mapping[type], type);
            connection_name = connections_mapping[type].name;
        }
        report.success(mk_test_name('create external connection', type));
    } catch (e) {
        report.fail(mk_test_name('create external connection', type));
        if (!clean_start && e.rpc_code !== 'CONNECTION_ALREADY_EXIST') {
            throw new Error(e);
        }
    }
    try {
        // create namespace resource
        await cf.createNamespaceResource(connection_name,
            namespace_mapping[type].namespace, namespace_mapping[type].bucket2);
        report.success(mk_test_name('create namespace resource', type));
    } catch (e) {
        report.fail(mk_test_name('create namespace resource', type));
        if (!clean_start && e.rpc_code !== 'IN_USE') {
            throw new Error(e);
        }
    }
    try {
        //create a namespace bucket
        await bucket_functions.createNamespaceBucket(namespace_mapping[type].gateway,
            namespace_mapping[type].namespace, { ttl_ms: cache_ttl_ms });
        report.success(mk_test_name('create namespace bucket with caching enabled', type));
    } catch (e) {
        console.log("error:", e, "==", e.rpc_code);
        report.fail(mk_test_name('create namespace bucket with caching enabled', type));
        if (!clean_start && e.rpc_code !== 'BUCKET_ALREADY_OWNED_BY_YOU') {
            throw new Error(e);
        }
    }
}

async function delete_account_resources(clouds) {
    for (const type of clouds) {
        try {
            await cf.deleteNamespaceResource(namespace_mapping[type].namespace);
            report.success(mk_test_name('delete namespace resource', type));
        } catch (err) {
            report.fail(mk_test_name('delete namespace resource', type));
        }
        if (!skip_clean_conn) {
            try {
                await cf.deleteConnection(connections_mapping[type].name);
                report.success(mk_test_name('delete external connection', type));
            } catch (err) {
                report.fail(mk_test_name('delete external connection', type));
            }
        }
    }
}

async function delete_namespace_bucket(bucket, type) {
    console.log('Deleting namespace bucket ' + bucket);
    await clean_namespace_bucket(bucket, type);

    try {
        await bucket_functions.deleteBucket(bucket);
        report.success(mk_test_name('delete namespace bucket with caching enabled', type));
    } catch (err) {
        report.fail(mk_test_name('delete namespace bucket with caching enabled', type));
        throw new Error(`Failed to delete namespace bucket ${bucket} with error ${err}`);
    }
}

async function clean_namespace_bucket(bucket, type) {
    const list_files = await s3ops_nb.get_list_files(bucket);
    const keys = list_files.map(key => key.Key);
    if (keys) {
        for (const file of keys) {
            try {
                await s3ops_nb.delete_file(bucket, file);
            } catch (e) {
                report.fail(mk_test_name('delete object from namespace bucket via noobaa endpoint', type));
            }
        }
        report.success(mk_test_name('delete object from namespace bucket via noobaa endpoint', type));
    }
}

async function main(clouds) {
    try {
        await set_rpc_and_create_auth_token();
        for (const type of clouds) {
            await create_account_resources(type);
            for (const tests of caching_tests) {
                console.log('=========================================================================');
                await tests.run({ type, ns_context });
            }
        }
        if (!skip_clean) {
            for (const type of clouds) {
                await delete_namespace_bucket(namespace_mapping[type].gateway, type);
            }
            await delete_account_resources(clouds);
        }
        await report.report();
        if (report.all_tests_passed()) {
            console.log(`${GREEN}namespace cache tests were successful!${NC}`);
            process.exit(0);
        } else {
            process.exit(1);
        }
    } catch (err) {
        console.error('something went wrong', err);
        await report.report();
        process.exit(1);
    }
}

main(cloud_list);
