/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const api = require('../../api');
const crypto = require('crypto');
const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');
const blobops = require('../utils/blobops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const bf = require('../utils/bucket_functions');
const dbg = require('../../util/debug_module')(__filename);

const test_name = 'namespace';
dbg.set_process_name(test_name);

require('../../util/dotenv').load();

let rpc;
let client;
let errors = [];
let failures_in_test = false;

const files_cloud = {
    files_AWS: [],
    files_AZURE: []
};

//defining the required parameters
const {
    server_ip,
    skip_clean = false,
    help = false
} = argv;

function usage() {
    console.log(`
    --server_ip     -   noobaa server ip.
    --skip_clean    -   skipping cleaning env
    --help          -   show this help.
    `);
}

if (help) {
    usage();
    process.exit(1);
}

let report = new Report();

report.init_reporter({ suite: test_name, conf: server_ip });

let connections_mapping = {
    AWS: {
        name: 'AWSConnection',
        endpoint: "https://s3.amazonaws.com",
        endpoint_type: "AWS",
        identity: 'AKIAJJCHBZVA3VSS2YCQ',
        secret: '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'
    }
};

const s3ops = new S3OPS();
const s3opsAWS = new S3OPS(connections_mapping.AWS.identity, connections_mapping.AWS.secret);

connections_mapping = Object.assign({ AZURE: blobops.AzureDefaultConnection }, connections_mapping);

//variables for using creating namespace resource
const namespace_mapping = {
    AWS: {
        pool: 'cloud-resource-aws',
        bucket1: 'QA-Bucket',
        bucket2: 'qa-aws-bucket',
        namespace: 'aws-resource-namespace',
        gateway: 'aws-gateway-bucket'
    },
    AZURE: {
        pool: 'cloud-resource-azure',
        bucket1: 'container1',
        bucket2: 'container2',
        bucket3: 'container3',
        namespace: 'azure-resource-namespace',
        gateway: 'azure-gateway-bucket'
    }
};

const dataSet = [
    { size_units: 'KB', data_size: 1 },
    { size_units: 'KB', data_size: 500 },
    { size_units: 'MB', data_size: 1 },
    { size_units: 'MB', data_size: 100 },
];

const baseUnit = 1024;
const unit_mapping = {
    KB: {
        data_multiplier: Math.pow(baseUnit, 1),
        dataset_multiplier: Math.pow(baseUnit, 2)
    },
    MB: {
        data_multiplier: Math.pow(baseUnit, 2),
        dataset_multiplier: Math.pow(baseUnit, 1)
    },
    GB: {
        data_multiplier: Math.pow(baseUnit, 3),
        dataset_multiplier: Math.pow(baseUnit, 0)
    }
};

function saveErrorAndResume(message, err) {
    console.error(message, err);
    errors.push(`${message} ${err}`);
    failures_in_test = true;
}

async function createNamespaceResource(connection, name, target_bucket) {
    console.log('Creating namespace resource with connection ' + connection);
    try {
        await client.pool.create_namespace_resource({
            connection,
            name,
            target_bucket
        });
        await report.success(`Create_Namespace_Resource_${connection}`);
    } catch (err) {
        await report.fail(`Create_Namespace_Resource_${connection}`);
        saveErrorAndResume('Failed to create namespace resource ', err);
        throw err;
    }
}

async function createGatewayBucket(name, namespace) {
    console.log('Creating gateway bucket with namespace ' + namespace);
    try {
        await client.bucket.create_bucket({
            name,
            namespace: {
                read_resources: [namespace],
                write_resource: namespace
            }
        });
        await report.success(`Create_Gateway_Bucket_${name}`);
    } catch (err) {
        await report.fail(`Create_Gateway_Bucket_${name}`);
        saveErrorAndResume('Failed to create gateway bucket ', err);
        throw err;
    }
}

async function createCloudPool(connection, name, target_bucket) {
    console.log('Creating cloud pool ' + connection);
    try {
        await client.pool.create_cloud_pool({
            connection,
            name,
            target_bucket
        });
        await report.success(`Create_Cloud_Pool_${connection}`);
    } catch (err) {
        await report.fail(`Create_Cloud_Pool_${connection}`);
        saveErrorAndResume('Failed to create cloud pool ', err);
        throw err;
    }
}

async function waitingForHealthyPool(poolName) {
    console.log('Waiting for pool getting healthy');
    for (let retries = 36; retries >= 0; --retries) {
        try {
            if (retries === 0) {
                throw new Error('Failed to get healthy status');
            } else {
                const system_info = await client.system.read_system({});
                let poolIndex = system_info.pools.findIndex(pool => pool.name === 'cloud-resource-aws');
                let status = system_info.pools[poolIndex].mode;
                if (system_info.pools[poolIndex].mode === 'OPTIMAL') {
                    console.log('Pool ' + poolName + ' is healthy');
                    break;
                } else {
                    console.log('Pool ' + poolName + ' has status ' + status + ' waiting for OPTIMAL extra 5 seconds');
                    await P.delay(5 * 1000);
                }
            }
        } catch (e) {
            console.log('something went wrong:', e);
        }
    }
}

async function createConnection(connetction, type) {
    console.log(`Creating ${type} connection`);
    try {
        await client.account.add_external_connection(connetction);
        await report.success(`Create_Connection_${type}`);
    } catch (err) {
        await report.fail(`Create_Connection_${type}`);
        saveErrorAndResume('Failed to cretae connection ', err);
        throw err;
    }
}

async function deleteConnection(connection_name) {
    console.log('Deleting connection ' + connection_name);
    try {
        await client.account.delete_external_connection({
            connection_name
        });
        await report.success(`Delete_Connection_${connection_name}`);
    } catch (err) {
        await report.fail(`Delete_Connection_${connection_name}`);
        saveErrorAndResume('Failed to delete connection ', err);
        throw err;
    }
}

async function getMD5fromS3Bucket(ops, ip, bucket, file_name) {
    try {
        const object_list = await ops.get_object(ip, bucket, file_name);
        console.log('Getting md5 data from file ' + file_name);
        return crypto.createHash('md5').update(object_list.Body).digest('base64');
    } catch (err) {
        saveErrorAndResume(`Getting md5 data from file ${file_name}`, err);
        throw err;
    }
}

async function comperMD5betweencloudAndNooBaa(type, bucket, noobaa_bucket, file_name) {
    console.log(`Compering NooBaa bucket to ${type}`);
    let cloudMD5;
    if (type === 'AWS') {
        cloudMD5 = await getMD5fromS3Bucket(s3opsAWS, 's3.amazonaws.com', bucket, file_name);
    } else if (type === 'AZURE') {
        cloudMD5 = await blobops.getMD5Blob(bucket, file_name, saveErrorAndResume);
    }
    const noobaaMD5 = await getMD5fromS3Bucket(s3ops, server_ip, noobaa_bucket, file_name);
    if (cloudMD5 === noobaaMD5) {
        console.log(`Noobaa bucket contains the md5 ${noobaaMD5} and the cloud md5 is: ${cloudMD5} for file ${file_name}`);
    } else {
        saveErrorAndResume(`Noobaa bucket contains the md5 ${noobaaMD5} instead of ${cloudMD5} for file ${file_name}`);
    }
}

async function uploadDataSetTocloud(type, bucket) {
    for (const size of dataSet) {
        const { data_multiplier } = unit_mapping[size.size_units.toUpperCase()];
        const file_name = 'file_' + size.data_size + size.size_units + (Math.floor(Date.now() / 1000));
        const actual_size = size.data_size * data_multiplier;
        files_cloud[`files_${type}`].push(file_name);
        if (type === 'AWS') {
            await uploadFileDirectlyToAWS(bucket, file_name, size.data_size, data_multiplier);
        } else if (type === 'AZURE') {
            await blobops.uploadRandomFileDirectlyToAzure(bucket, file_name, actual_size, saveErrorAndResume);
        }
    }
}

async function upload_directly_to_cloud(type) {
    console.log(`Uploading files into ${type}`);
    const { data_multiplier } = unit_mapping.KB;
    const file_name = 'file_namespace_test_' + (Math.floor(Date.now() / 1000));
    files_cloud[`files_${type}`].push(file_name);
    try {
        if (type === 'AWS') {
            await uploadFileDirectlyToAWS(namespace_mapping.AWS.bucket2, file_name, 15, data_multiplier);
        } else if (type === 'AZURE') {
            const actual_size = 15 * data_multiplier;
            await blobops.uploadRandomFileDirectlyToAzure(namespace_mapping.AZURE.bucket2, file_name, actual_size, saveErrorAndResume);
        }
    } catch (err) {
        throw new Error(`Failed to upload directly into ${type}`);
    }
}

function uploadFileDirectlyToAWS(bucket, file_name, size, multiplier) {
    const s3bucket = new AWS.S3({
        endpoint: connections_mapping.AWS.endpoint,
        accessKeyId: connections_mapping.AWS.identity,
        secretAccessKey: connections_mapping.AWS.secret,
        s3ForcePathStyle: true,
        sslEnabled: false,
        region: 'us-east-1',
    });
    const actual_size = size * multiplier;

    let data = crypto.randomBytes(actual_size);
    let md5 = crypto.createHash('md5').update(data).digest('hex');

    let params = {
        Bucket: bucket,
        Key: file_name,
        Body: data,
        Metadata: {
            md5: md5
        },
    };
    console.log(`>>> UPLOAD - About to upload object... ${file_name}, md5: ${md5}, size: ${data.length}`);
    let start_ts = Date.now();
    return P.ninvoke(s3bucket, 'putObject', params)
        .then(res => {
            console.log('Upload object took', (Date.now() - start_ts) / 1000, 'seconds');
            return md5;
        })
        .catch(err => {
            console.error(`Put failed ${file_name}!`, err);
            throw err;
        });
}

async function isFilesAvailableInNooBaaBucket(gateway, files) {
    console.log('Checking uploaded files ' + files + ' in noobaa s3 server bucket ' + gateway);
    const list_files = await s3ops.get_list_files(server_ip, gateway);
    const keys = list_files.map(key => key.Key);
    for (const file of files) {
        if (keys.includes(file)) {
            console.log('Server contains file ' + file);
        } else {
            saveErrorAndResume(`Server is not contains uploaded file ${file} in bucket ${gateway}`);
        }
    }
}

async function uploadFileToNoobaaS3(bucket, file_name) {
    let { data_multiplier } = unit_mapping.KB;
    try {
        await s3ops.put_file_with_md5(server_ip, bucket, file_name, 15, data_multiplier);
    } catch (err) {
        saveErrorAndResume(`Failed upload file ${file_name}`, err);
        throw err;
    }
}

async function deleteGatewayBucket(bucket) {
    console.log('Deleting gateway bucket ' + bucket);
    try {
        await bf.deleteBucket(server_ip, bucket);
    } catch (err) {
        saveErrorAndResume(`Failed to delete gateway bucket with error`, err);
        throw err;
    }
}

async function deleteCloudPool(pool) {
    console.log('Deleting cloud pool ' + pool);
    try {
        await client.pool.delete_pool({
            name: pool
        });
        await report.success(`Delete_Cloud_Pool_${pool}`);
    } catch (err) {
        await report.fail(`Delete_Cloud_Pool_${pool}`);
        saveErrorAndResume(`Failed to delete cloud pool error`, err);
        throw err;
    }
}

async function deleteNamespace(namespace) {
    console.log('Deleting cloud pool ' + namespace);
    try {
        await client.pool.delete_namespace_resource({
            name: namespace
        });
        await report.success(`Delete_Namespace_Resource_${namespace}`);
    } catch (err) {
        await report.fail(`Delete_Namespace_Resource_${namespace}`);
        saveErrorAndResume(`Failed to delete cloud pool error`, err);
        throw err;
    }
}

async function set_rpc_and_create_auth_token() {
    rpc = api.new_rpc('wss://' + server_ip + ':8443');
    client = rpc.new_client({});
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
}

async function create_resource(type) {
    //create connection
    await createConnection(connections_mapping[type], type);
    //creating cloud resource
    await createCloudPool(connections_mapping[type].name, namespace_mapping[type].pool, namespace_mapping[type].bucket1);
    //waiting until the resource is "healthy"
    await waitingForHealthyPool(namespace_mapping[type].pool);
    // create namespace resource 
    await createNamespaceResource(connections_mapping[type].name, namespace_mapping[type].namespace, namespace_mapping[type].bucket2);
}

async function upload_via_cloud_check_via_noobaa(type) {
    //create a namespace bucket
    await createGatewayBucket(namespace_mapping[type].gateway, namespace_mapping[type].namespace);
    //upload dataset
    await uploadDataSetTocloud(type, namespace_mapping[type].bucket2);
    await upload_directly_to_cloud(type);
    await isFilesAvailableInNooBaaBucket(namespace_mapping[type].gateway, files_cloud[`files_${type}`]);
    for (const file of files_cloud[`files_${type}`]) {
        await comperMD5betweencloudAndNooBaa(type, namespace_mapping[type].bucket2, namespace_mapping[type].gateway, file);
    }
}

async function upload_via_noobaa_check_via_cloud(type, file_name) { //TODO fix to include all clouds.
    //Try to upload a file to noobaa s3 server, verify it was uploaded to the Azure container
    console.log(`uploading ${file_name} via noobaa bucket ${
        namespace_mapping[type].gateway} and checking via ${type}: ${namespace_mapping[type].bucket2}`);
    files_cloud[`files_${type}`].push(file_name);
    await uploadFileToNoobaaS3(namespace_mapping[type].gateway, file_name);
    let list_files = [];
    if (type === 'AWS') {
        const list_files_obj = await s3opsAWS.get_list_files('s3.amazonaws.com', namespace_mapping[type].bucket2, file_name);
        list_files = list_files_obj[0].Key;
    } else if (type === 'AZURE') {
        list_files = await blobops.getListFilesAzure(namespace_mapping[type].bucket2, saveErrorAndResume);
    }
    console.log(`${type} files list ${list_files}`);
    if (list_files.includes(file_name)) {
        console.log(`${file_name} was uploaded via noobaa and found via ${type}`);
    } else {
        saveErrorAndResume(`${file_name} was uploaded via noobaa and was not found via ${type}`);
    }
}

async function clean_env() {
    //deleting files from noobaa sever gateway buckets
    for (const type of ['AWS', 'AZURE']) {
        for (const file of files_cloud[`files_${type}`]) {
            await s3ops.delete_file(server_ip, namespace_mapping[type].gateway, file);
        }
    }
    //cleaning env
    await deleteGatewayBucket(namespace_mapping.AWS.gateway);
    await deleteGatewayBucket(namespace_mapping.AZURE.gateway);
    await deleteNamespace(namespace_mapping.AZURE.namespace);
    await deleteNamespace(namespace_mapping.AWS.namespace);
    await deleteCloudPool(namespace_mapping.AWS.pool);
    await deleteCloudPool(namespace_mapping.AZURE.pool);
    await deleteConnection(connections_mapping.AWS.name);
    await deleteConnection(blobops.AzureDefaultConnection.name);
}

async function main() {
    try {
        await set_rpc_and_create_auth_token();
        for (const type of ['AWS', 'AZURE']) {
            await create_resource(type);
            await upload_via_cloud_check_via_noobaa(type);
            await upload_via_noobaa_check_via_cloud(type, 'file_azure_15KB');
        }
        if (!skip_clean) {
            await clean_env();
        }
        await report.print_report();
        if (failures_in_test) {
            console.error('Errors during namespace test');
            console.error(`${JSON.stringify(_.countBy(errors), null, 4)}`);
            process.exit(1);
        } else {
            console.log('namespace tests were successful!');
            process.exit(0);
        }
    } catch (err) {
        saveErrorAndResume('something went wrong', err);
        await report.print_report();
        process.exit(1);
    }
}

P.resolve()
    .then(main);
