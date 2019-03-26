/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const api = require('../../api');
const blobops = require('../utils/blobops');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const ops = require('../utils/basic_server_ops');
const dbg = require('../../util/debug_module')(__filename);
const AzureFunctions = require('../../deploy/azureFunctions');
const { CloudFunction } = require('../utils/cloud_functions');
const { BucketFunctions } = require('../utils/bucket_functions');
const test_name = 'cloud_test';
dbg.set_process_name(test_name);

let bf_compatible;
let cf_compatible;
const server = [];
const cloud_list = ['AWS', 'AZURE', 'COMPATIBLE'];

//defining the required parameters
const {
    server_ip,
    location = 'westus2',
    resource,
    storage,
    vnet,
    id = 0,
    upgrade,
    name = 'compatible',
    compatible_ip,
    compatible_password,
} = argv;

//define colors
const NC = "\x1b[0m";
// const RED = "\x1b[31m";
const YELLOW = "\x1b[33;1m";

const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
const suffix = name + id;

server.name = suffix;

function usage() {
    console.log(`
    --server_ip             -   noobaa server ip.
    --location              -   azure location (default: ${location})
    --resource              -   azure resource group
    --storage               -   azure storage on the resource group
    --vnet                  -   azure vnet on the resource group
    --id                    -   an id that is attached to the agents name
    --name                  -   compatible s3 server name (default: ${name})
    --upgrade               -   location of the file for upgrade
    --compatible_ip         -   use an already installed compatible s3 (by ip)
    --compatible_password   -   the compatible s3 password
    --help                  -   show this help.
    `);
}

if (argv.help) {
    usage();
    process.exit(1);
}

// we require this here so --help will not call datasets help.
const dataset = require('./dataset.js');

console.log(`${YELLOW}resource: ${resource}, storage: ${storage}, vnet: ${vnet}${NC}`);

const rpc = api.new_rpc('wss://' + server_ip + ':8443');
const client = rpc.new_client({});

const server_s3ops = new S3OPS({ ip: server_ip });
const report = new Report();
const bf = new BucketFunctions(client);
const cf = new CloudFunction(client);
const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

const conf = {
    aws: true,
    azure: true,
    compatible_V2: true,
    compatible_V4: true
};

let connections_mapping = {
    COMPATIBLE: {
        auth_method: 'AWS_V4',
        name: 'COMPATIBLEConnection',
        endpoint: "",
        endpoint_type: "S3_COMPATIBLE",
        identity: "123",
        secret: "abc"
    }
};

const dataset_params = {
    server_ip,
    bucket: 'first.bucket',
    part_num_low: 2,
    part_num_high: 10,
    aging_timeout: 30,
    max_depth: 10,
    min_depth: 1,
    size_units: 'MB',
    file_size_low: 50,
    file_size_high: 200,
    dataset_size: 1024 * 5,
};

//Define test cases
const cases = [
    'create compatible 2 http resource',
    'create compatible 2 https resource',
    'create compatible 4 http resource',
    'create compatible 4 https resource',
    'create AWS resource',
    'create AZURE resource',
    'delete all file from resource aws',
    'delete all file from resource azure',
    'delete all file from resource compatible2http',
    'delete all file from resource compatible2https',
    'delete all file from resource compatible4http',
    'delete all file from resource compatible4https',
    'delete resource aws',
    'delete resource azure',
    'delete resource compatible2http',
    'delete resource compatible2https',
    'delete resource compatible4http',
    'delete resource compatible4https',
];
report.init_reporter({ suite: test_name, conf, mongo_report: true, cases: cases });

const AWSDefaultConnection = cf.getAWSConnection();
connections_mapping = Object.assign(connections_mapping, { AWS: AWSDefaultConnection });
connections_mapping = Object.assign(connections_mapping, { AZURE: blobops.AzureDefaultConnection });

let cloud_pools = [];
let bucket_names = [];
let connections_names = [];
let remote_bucket_names = [];
const cloudPoolForCompatible = 'AZURE-for-compatible';

async function set_rpc_and_create_auth_token(client_to_auth) {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client_to_auth.create_auth_token(auth_params);
}

async function create_noobaa_for_compatible() {
    try {
        if (compatible_ip) {
            server.ip = compatible_ip;
            server.name = await azf.getMachineByIp(compatible_ip);
            server.secret = compatible_password;
            server.s3ops = new S3OPS({ ip: compatible_ip, system_verify_name: server.name });
            console.log(server);
        } else {
            const new_secret = await azf.createServer({
                serverName: server.name,
                vnet,
                storage,
                ipType: 'Static',
                createSystem: true
            });
            console.log(`${YELLOW}${server.name} secret is: ${new_secret}${NC}`);
            server.secret = new_secret;
            const ip = await azf.getIpAddress(server.name + '_pip');
            console.log(`${YELLOW}${server.name} and ip is: ${ip}${NC}`);
            server.ip = ip;
            server.s3ops = new S3OPS({ ip, system_verify_name: server.name });
        }
        if (!_.isUndefined(upgrade)) {
            await ops.upload_and_upgrade(server.ip, upgrade);
        }
    } catch (err) {
        console.log(err);
        throw new Error('Can\'t create server and upgrade servers', err);
    }

    try {
        server.internal_ip = await azf.getPrivateIpAddress(`${server.name}_nic`, `${server.name}_ip`);
        connections_mapping.COMPATIBLE.endpoint = 'https://' + server.internal_ip;
        const rpc2 = api.new_rpc('wss://' + server.ip + ':8443');
        const client2 = rpc2.new_client({});
        await set_rpc_and_create_auth_token(client2);
        bf_compatible = new BucketFunctions(client2);
        cf_compatible = new CloudFunction(client2);
    } catch (err) {
        console.log(err);
        throw new Error('Failed creating RPC', err);
    }

    try {
        await cf_compatible.createConnection(connections_mapping.AZURE, 'AZURE');
        await cf_compatible.createCloudPool(connections_mapping.AZURE.name, cloudPoolForCompatible, "noobaa-for-compatible");
        report.success('create AZURE resource');
    } catch (err) {
        report.fail('create AZURE resource');
        throw err;
    }

}

async function clean_cloud_bucket(s3ops, bucket) {
    let run_list = true;
    console.log(`cleaning all files from ${bucket} in ${s3ops.ip}`);
    while (run_list) {
        const list_files = await s3ops.get_list_files(bucket, '', { maxKeys: 1000 });
        if (list_files.length < 1000) {
            run_list = false;
        }
        for (const file of list_files) {
            await s3ops.delete_file(bucket, file.Key);
        }
    }
}

async function prepareCompatibleCloudPoolsEnv(type, version) {
    for (const protocol of ['http', 'https']) {
        try {
            //TODO: ????????? should we remove version 4 of http due to bug #3642 ?????????
            // if (version === 4 && protocol === 'http') {
            //     console.log(`noobaa compatible v4 with http is not working.`);
            // } else {
            connections_mapping.COMPATIBLE.auth_method = 'AWS_V' + version;
            connections_mapping.COMPATIBLE.endpoint = protocol + '://' + server.internal_ip;
            connections_mapping.COMPATIBLE.name = 'COMPATIBLEConnection' + version + protocol;
            connections_names.push(connections_mapping.COMPATIBLE.name);
            await cf.createConnection(connections_mapping[type], type);
            const target_bucket = `noobaa-cloud-test-${protocol}${version}`;
            remote_bucket_names.push(target_bucket);
            const cloud_pool_name = `${type}${version}${protocol}-bucket`;
            cloud_pools.push(cloud_pool_name);
            await bf_compatible.createBucket(target_bucket);
            await bf_compatible.editBucketDataPlacement(cloudPoolForCompatible, target_bucket, 'SPREAD');
            await cf.createCloudPool(connections_mapping[type].name, cloud_pool_name, target_bucket);
            const bucket = cloud_pool_name.toLowerCase();
            await bf.createBucket(bucket);
            bucket_names.push(bucket);
            await bf.editBucketDataPlacement(cloud_pool_name, bucket, 'SPREAD');
            report.success(`create compatible ${version} ${protocol} resource`);
            // }
        } catch (err) {
            report.fail(`create compatible ${version} ${protocol} resource`);
            throw err;
        }
    }
}

async function createCloudPools(type) {
    if (type === "COMPATIBLE") {
        await prepareCompatibleCloudPoolsEnv(type, 2); //Report inside
    } else {
        try {
            const cloud_pool_name = `${type}-bucket`;
            await cf.createConnection(connections_mapping[type], type);
            connections_names.push(connections_mapping[type].name);
            await cf.createCloudPool(connections_mapping[type].name, cloud_pool_name, "noobaa-cloud-test");
            cloud_pools.push(cloud_pool_name);
            const bucket = cloud_pool_name.toLowerCase();
            await bf.createBucket(bucket);
            bucket_names.push(bucket);
            report.success(`create ${type} resource`);
            await bf.editBucketDataPlacement(cloud_pool_name, bucket, 'SPREAD');
            report.success(`create ${type} resource`);
        } catch (err) {
            console.error(err);
            report.fail(`create ${type} resource`);
            throw err;
        }
    }
}

async function clean_env() {
    for (const bucket_name of bucket_names) {
        try {
            await clean_cloud_bucket(server_s3ops, bucket_name);
            report.success(`delete all file from resource ${bucket_name.slice(0, bucket_name.lastIndexOf('-'))}`);
        } catch (err) {
            report.fail(`delete all file from resource ${bucket_name.slice(0, bucket_name.lastIndexOf('-'))}`);
            throw err;
        }
        await bf.deleteBucket(bucket_name);
    }
    bucket_names = [];
    for (const cloud_pool of cloud_pools) {
        try {
            await cf.deleteCloudPool(cloud_pool);
            report.success(`delete resource ${cloud_pool.slice(0, cloud_pool.lastIndexOf('-'))}`);
        } catch (err) {
            report.fail(`delete resource ${cloud_pool.slice(0, cloud_pool.lastIndexOf('-'))}`);
            throw err;
        }
    }
    cloud_pools = [];
    for (const connections of connections_names) {
        await cf.deleteConnection(connections);
    }
    connections_names = [];
    for (const bucket_name of remote_bucket_names) {
        await clean_cloud_bucket(server.s3ops, bucket_name);
        await bf_compatible.deleteBucket(bucket_name);
    }
    remote_bucket_names = [];
}

async function run_dataset() {
    for (const bucket_name of bucket_names) {
        dataset_params.bucket = bucket_name;
        console.log(dataset_params);
        const report_params = {
            suite_name: 'cloud_test',
            cases_prefix: `${bucket_name.slice(0, bucket_name.lastIndexOf('-'))}`
        };
        await dataset.init_parameters({ dataset_params: dataset_params, report_params: report_params });
        try {
            await dataset.run_test(true);
        } catch (e) {
            console.log('Failed running dataset');
            throw e;
        }
    }
}

async function main() {
    try {
        await azf.authenticate();
        await create_noobaa_for_compatible();
        await set_rpc_and_create_auth_token(client);
        for (const type of cloud_list) {
            await createCloudPools(type);
        }
        await run_dataset();
        await clean_env();
        await prepareCompatibleCloudPoolsEnv("COMPATIBLE", 4);
        await run_dataset();
        await clean_env();
        console.log('cloud tests were successful!');
        await report.report();
        process.exit(0);
    } catch (err) {
        console.error('something went wrong', err);
        await report.report();
        process.exit(1);
    }
}

main();
