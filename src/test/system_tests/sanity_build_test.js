/* Copyright (C) 2016 NooBaa */
"use strict";

const _ = require('lodash');
const api = require('../../api');
const dbg = require('../../util/debug_module')(__filename);
const ops = require('../utils/basic_server_ops');
const argv = require('minimist')(process.argv);
const blobops = require('../utils/blobops');

const { CloudFunction } = require('../utils/cloud_functions');
const { BucketFunctions } = require('../utils/bucket_functions');

const TEST_CTX = {
    client: null,
    bucketfunc: null,
    cloudfunc: null,
    aws_connection: null,
    azure_connection: null,
    compatible_v2: null,
    compatible_v4: null,
};

function show_usage() {
    dbg.original_console();
    console.info(`
sanity_build_test.js
Basic sanity test to be run as part of smoke testing. Configures the system, upgrades it and perform 2 simple I/O flows
Usage:
    --help                      Show this usage
    --upgrade_pack <path>       Path to upgrade package
    --target_ip <ip>            IP of server to test
    \n
    Examples:
    \tnode src/test/system_tests/sanity_build_test.js --upgrade_pack ~/Downloads/noobaa-NVA-2.8.0-ede90e8.tar.gz --target_ip 52.151.33.226
`);
}

function stop() {
    process.exit(3);
}

async function main() {
    if (argv.help) {
        show_usage();
        process.exit(0);
    }

    if (_.isUndefined(argv.upgrade_pack)) {
        console.error('Missing upgrade_pack paramter!');
        show_usage();
        stop();
    }

    if (_.isUndefined(argv.target_ip)) {
        console.error('Missing target_ip paramter!');
        show_usage();
        stop();
    }

    await run_test(argv.target_ip, argv.upgrade_pack, false);
    console.log('Finished Sanity Build Test Successfully');
    process.exit(0);
}

async function run_configuration_test(target_ip, mng_port) {
    try {
        await init_test(target_ip, mng_port);
        await create_configuration();
    } catch (err) {
        dbg.error('failed configuration test', err);
        throw err;
    }
}

async function run_test(target_ip, upgrade_pack, dont_verify_version, skip_configuration) {
    await init_test(target_ip);

    try {
        if (!skip_configuration) {
            await create_configuration();
        }
    } catch (error) {
        console.warn('Caught', error);
        stop();
    }

    await upgrade_and_test(target_ip, upgrade_pack, dont_verify_version);
    await TEST_CTX.client.system.read_system();
}

async function init_test(target_ip, mng_port = '8080') {
    const auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    TEST_CTX._rpc = api.new_rpc();
    TEST_CTX.client = TEST_CTX._rpc.new_client({
        address: 'ws://' + target_ip + ':' + mng_port
    });
    await TEST_CTX.client.create_auth_token(auth_params);

    TEST_CTX.bucketfunc = new BucketFunctions(TEST_CTX.client);
    TEST_CTX.cloudfunc = new CloudFunction(TEST_CTX.client);

    TEST_CTX.aws_connection = await TEST_CTX.cloudfunc.getAWSConnection();
    TEST_CTX.aws_connection.name = `${TEST_CTX.aws_connection.name}12`;
    TEST_CTX.azure_connection = blobops.AzureDefaultConnection;
    TEST_CTX.azure_connection.name = `${TEST_CTX.azure_connection.name}24`;
    TEST_CTX.compatible_v2 = {
        name: 'compatible_V2',
        endpoint_type: 'S3_COMPATIBLE',
        endpoint: `http://${target_ip}`,
        identity: '123',
        secret: 'abc',
        auth_method: 'AWS_V2'
    };
    TEST_CTX.compatible_v4 = {
        name: 'compatible_V4',
        endpoint_type: 'S3_COMPATIBLE',
        endpoint: `http://127.0.0.1`,
        identity: '123',
        secret: 'abc',
        auth_method: 'AWS_V4'
    };

}

//Create configuration on the server to test while upgrading
async function create_configuration() {
    TEST_CTX._rpc.disable_validation(); //Ugly hack, for now live with it
    //create resources and bucket
    await _create_resources_and_buckets();

    //Create various accounts 
    await _create_accounts();

    //Create lambda funcs
    await _create_lambda();


    //Create system config
    await _create_configuration();

    await TEST_CTX.client.system.read_system();
    TEST_CTX._rpc.enable_validation();
}

async function upgrade_and_test(target_ip, upgrade_pack, dont_verify_version) {
    ops.disable_rpc_validation();
    console.info('Basic sanity test started, Upgrading MD server at', target_ip);
    try {
        await ops.upload_and_upgrade(target_ip, upgrade_pack, dont_verify_version);
    } catch (error) {
        console.warn('Upgrading failed with', error, error.stack);
        stop();

    }

    console.info('Upgrade successful, waiting on agents to upgrade');
    try {
        await ops.wait_on_agents_upgrade(target_ip);
    } catch (error) {
        console.warn('Agents failed to upgrade', error, error.stack);
        stop();
    }

    console.info('Agents upgraded successfuly, generating 1MB file');
    let path = await ops.generate_random_file(1);
    console.info('Verifying ul/dl of 1MB file', path);
    try {
        await ops.verify_upload_download(target_ip, path);
    } catch (error) {
        console.warn('Verifying ul/dl 1MB file failed with', error, error.stack);
        stop();
    }

    console.info('ul/dl 1MB file successful, generating 20MB file');
    path = await ops.generate_random_file(20);
    console.info('Verifying ul/dl of 20MB file', path);
    try {
        await ops.verify_upload_download(target_ip, path);
    } catch (error) {
        console.warn('Verifying ul/dl 20MB file failed with', error, error.stack);
        stop();
    }

    console.info('ul/dl 20MB file successful, verifying agent download');
    try {
        await ops.get_agent_setup(target_ip);
    } catch (error) {
        console.warn('Verifying agent download failed with', error, error.stack);
        stop();
    }
}

async function _create_resources_and_buckets() {
    console.info('Creating various resources and buckets');
    //Create all supported connections
    await TEST_CTX.cloudfunc.createConnection(TEST_CTX.aws_connection, 'AWS');
    await TEST_CTX.cloudfunc.createConnection(TEST_CTX.azure_connection, 'Azure');
    await TEST_CTX.cloudfunc.createConnection(TEST_CTX.compatible_v2, 'S3_V2');
    await TEST_CTX.cloudfunc.createConnection(TEST_CTX.compatible_v4, 'S3_V4');
    //TODO: Add await TEST_CTX.cloudfunc.createConnection(TEST_CTX.gcloud_connection, 'GCP');

    //Create Cloud Resources
    await TEST_CTX.cloudfunc.createCloudPool(TEST_CTX.aws_connection.name, 'AWS-Resource', 'QA-Bucket');
    await TEST_CTX.cloudfunc.createCloudPool(TEST_CTX.azure_connection.name, 'AZURE-Resource', 'container3');

    //Create Compatible V2 and V4 buckets on the same system & then cloud resources on them
    await TEST_CTX.bucketfunc.createBucket('compatible.v2');
    await TEST_CTX.bucketfunc.createBucket('compatible.v4');
    await TEST_CTX.cloudfunc.createCloudPool(TEST_CTX.compatible_v2.name, 'COMP-S3-V2-Resource', 'compatible.v2');
    await TEST_CTX.cloudfunc.createCloudPool(TEST_CTX.compatible_v4.name, 'COMP-S3-V4-Resource', 'compatible.v4');

    //Create bucket with various RP & Placement
    let buck1 = await TEST_CTX.bucketfunc.createBucket('ec.no.quota');
    let buck2 = await TEST_CTX.bucketfunc.createBucket('replica.with.quota');

    await TEST_CTX.bucketfunc.changeTierSetting('ec.no.quota', 4, 2); //EC 4+2 
    await TEST_CTX.client.tier.update_tier({
        name: buck1.tiering.tiers[0].tier,
        attached_pools: ['AWS-Resource', 'COMP-S3-V2-Resource'],
        data_placement: 'MIRROR'
    });
    await TEST_CTX.bucketfunc.setQuotaBucket('replica.with.quota', 2, 'TERABYTE');
    await TEST_CTX.client.tier.update_tier({
        name: buck2.tiering.tiers[0].tier,
        attached_pools: ['AZURE-Resource', 'COMP-S3-V4-Resource'],
        data_placement: 'SPREAD'
    });

    //Create namespace resources
    await TEST_CTX.cloudfunc.createNamespaceResource(TEST_CTX.aws_connection.name, 'NSAWS', 'qa-aws-bucket');
    await TEST_CTX.cloudfunc.createNamespaceResource(TEST_CTX.azure_connection.name, 'NSAzure', 'container2');

    //Create namespace bucket
    await TEST_CTX.bucketfunc.createNamespaceBucket('ns.over.azure.aws', 'NSAWS');
    await TEST_CTX.bucketfunc.updateNamesapceBucket('ns.over.azure.aws', ['NSAWS', 'NSAzure'], 'NSAzure');

    //Spillover configuration is already applied on first.bucket, no need to add one
}

async function _create_accounts() {
    console.info('Creating various accounts');
    //no login with s3 access
    const ac1 = {
        name: 'ac_nologin_hasaccess',
        email: 'ac_nologin_hasaccess',
        has_login: false,
        s3_access: true,
        default_pool: 'first.pool',
        allowed_buckets: {
            full_permission: false,
            permission_list: [
                'first.bucket'
            ]
        },
        allow_bucket_creation: true
    };

    const ac2 = {
        name: "ac_login_all_buckets",
        email: "ac_login_all_buckets@demo.com",
        has_login: true,
        password: "9v8MQq2Q",
        must_change_password: true,
        s3_access: true,
        default_pool: "first.pool",
        allowed_buckets: {
            full_permission: false,
            permission_list: ['first.bucket', 'ec.no.quota', 'replica.with.quota']
        },
        allow_bucket_creation: true
    };

    const ac3 = {
        name: "ac_login_full",
        email: "ac_login_full@noobaa.com",
        has_login: true,
        password: "c1QiXLlJ",
        must_change_password: false,
        s3_access: true,
        default_pool: "first.pool",
        allowed_buckets: { full_permission: true },
        allow_bucket_creation: false
    };

    const ac4 = {
        name: "ac_with_limit",
        email: "ac_with_limit@noobaa.com",
        has_login: true,
        password: "c1QiGkl2",
        must_change_password: false,
        s3_access: true,
        default_pool: "first.pool",
        allowed_buckets: { full_permission: true },
        allow_bucket_creation: true
    };
    const ac4_update = {
        email: ac4.email,
        ips: [
            { start: '10.0.0.1', end: '10.0.0.100' },
            { start: '127.0.0.1', end: '127.0.0.1' },
            { start: '78.10.124.210', end: '78.10.124.210' }
        ]
    };

    await TEST_CTX.client.account.create_account(ac1);
    await TEST_CTX.client.account.create_account(ac2);
    await TEST_CTX.client.account.create_account(ac3);
    await TEST_CTX.client.account.create_account(ac4);
    await TEST_CTX.client.account.update_account(ac4_update);
}

async function _create_configuration() {
    console.info('Creating various configuration');
    //NTP
    await TEST_CTX.client.cluster_server.update_time_config({
        ntp_server: 'time.windows.com',
        timezone: 'Asia/Jerusalem'
    });

    //DNS
    await TEST_CTX.client.cluster_server.update_dns_servers({
        dns_servers: ['8.8.8.8', '8.8.4.4']
    });

    //rsyslog
    await TEST_CTX.client.system.configure_remote_syslog({
        enabled: true,
        address: '127.0.0.1',
        protocol: 'TCP',
        port: 8001
    });

    //TODO Proxy
}

async function _create_lambda() {
    console.info('Creating various functions and triggers');
    //Create func
    const code_buffer = Buffer.from([80, 75, 3, 4, 10, 0, 0, 0, 8, 0, 217, 98, 219, 76, 166, 14, 198, 22, 88, 0, 0, 0, 119, 0, 0, 0, 7, 0,
        0, 0, 109, 97, 105, 110, 46, 106, 115, 75, 43, 205, 75, 46, 201, 204, 207, 83, 200, 77, 204, 204, 211, 208, 84, 168, 230, 82, 80,
        200, 73, 45, 81, 72, 84, 176, 85, 48, 180, 6, 114, 146, 243, 243, 138, 243, 115, 82, 245, 114, 242, 211, 53, 18, 60, 18, 21, 84,
        170, 19, 107, 19, 52, 65, 50, 137, 218, 218, 32, 42, 45, 63, 95, 3, 200, 175, 229, 226, 74, 131, 153, 5, 22, 2, 25, 117, 104, 1,
        178, 118, 117, 160, 184, 58, 68, 41, 0, 80, 75, 1, 2, 20, 0, 10, 0, 0, 0, 8, 0, 217, 98, 219, 76, 166, 14, 198, 22, 88, 0, 0, 0,
        119, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 109, 97, 105, 110, 46, 106, 115, 80, 75, 5, 6, 0, 0, 0, 0, 1,
        0, 1, 0, 53, 0, 0, 0, 125, 0, 0, 0, 0, 0
    ]);

    await TEST_CTX.client.func.create_func({
        config: {
            name: 'testfunc',
            version: '$LATEST',
            'description': 'testytestytesyfunc',
            'runtime': 'nodejs6',
            'handler': 'main.main',
            'memory_size': 128,
            'timeout': 450
        },
        code: { zipfile_b64: code_buffer.toString('base64') }
    });

    //Create triggers
    await TEST_CTX.client.bucket.add_bucket_lambda_trigger({
        bucket_name: 'first.bucket',
        object_suffix: '.dat',
        func_name: 'testfunc',
        event_name: 'ObjectRemoved'
    });
}

if (require.main === module) {
    main();
}

exports.run_test = run_test;
exports.run_configuration_test = run_configuration_test;
