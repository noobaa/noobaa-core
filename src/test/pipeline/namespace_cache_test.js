/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const api = require('../../api');
const crypto = require('crypto');
//const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
const { CloudFunction } = require('../utils/cloud_functions');
const { BucketFunctions } = require('../utils/bucket_functions');

const test_name = 'namespace_cache';
dbg.set_process_name(test_name);

require('../../util/dotenv').load();

const {
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    COS_ACCESS_KEY_ID,
    COS_SECRET_ACCESS_KEY,
    CACHE_TTL_MS,
    SYSTEM_NAME,
} = process.env;

const DEFAULT_CACHE_TTL_MS = 60000;

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

let errors = [];
let failures_in_test = false;

//define colors
// const YELLOW = "\x1b[33;1m";
const RED = "\x1b[31m";
const NC = "\x1b[0m";

const files_cloud = {
    files_AWS: [],
    files_COS: []
};

//defining the required parameters
const {
    mgmt_ip,
    mgmt_port_https,
    s3_ip,
    s3_port,
    skip_clean = false,
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
    --clean_start       -   fail the test if connection, resource or bucket exists
    --help              -   show this help.
    `);
}

if (help) {
    usage();
    process.exit(1);
}

const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
const client = rpc.new_client({});

let report = new Report();

const cases = [
    'read via namespace AWS',
    'read via namespace COS',
    'verify list files AWS',
    'verify list files COS',
    'create namespace bucket AWS',
    'create namespace bucket COS',
    'update namespace bucket w resource',
    'upload via noobaa to namespace AWS',
    'upload via noobaa to namespace COS',
    'delete via namespace AWS',
    'delete via namespace COS',
    'verify md5 via list on AWS',
    'verify md5 via list on COS',
    'create external connection AWS',
    'create external connection COS',
    'create namespace resource AWS',
    'create namespace resource COS',
    'delete namespace resource AWS',
    'delete namespace resource COS',
    'delete connection AWS',
    'delete connection COS',
    'delete namespace bucket',
];
// report.init_reporter({ suite: test_name, conf: { aws: true, cos: true }, mongo_report: true, cases: cases });
report.init_reporter({ suite: test_name, conf: { cos: true }, mongo_report: true, cases: cases });

let cf = new CloudFunction(client);
const bucket_functions = new BucketFunctions(client);

const AWSDefaultConnection = cf.getAWSConnection();
const COSDefaultConnection = cf.getCOSConnection();

// const s3ops = new S3OPS({ ip: s3_ip, port: s3_port });
const s3ops = new S3OPS({ ip: s3_ip, port: s3_port, use_https: false, sig_ver: 'v2',
        access_key: 'vZnfG4rgxGL9NP0a2sHh', secret_key: 'V19A8Fi3gsjD7w5OxjBH9WT3XJ3sSWCtNuvQmDys'});
const s3opsAWS = new S3OPS({
    ip: 's3.amazonaws.com',
    access_key: AWSDefaultConnection.identity,
    secret_key: AWSDefaultConnection.secret,
    system_verify_name: 'AWS',
});
const s3opsCOS = new S3OPS({
    ip: 's3.us-south.cloud-object-storage.appdomain.cloud',
    access_key: COSDefaultConnection.identity,
    secret_key: COSDefaultConnection.secret,
    system_verify_name: 'COS',
});

const connections_mapping = { COS: COSDefaultConnection, AWS: AWSDefaultConnection };

//variables for using creating namespace resource
const namespace_mapping = {
    AWS: {
        s3ops: s3opsAWS,
        pool: 'cloud-resource-aws',
        bucket1: 'QA-Bucket',
        bucket2: 'qa-aws-bucket',
        namespace: 'aws-resource-namespace',
        gateway: 'aws-gateway-bucket'
    },
    COS: {
        s3ops: s3opsCOS,
        pool: 'cloud-resource-cos',
        bucket1: 'test-nb-ft1',
        bucket2: 'test-nb-ft2',
        namespace: 'cos-resource-namespace',
        gateway: 'cos-gateway-bucket'
    }
};

/*const dataSet = [
    { size_units: 'KB', data_size: 1 },
    { size_units: 'KB', data_size: 500 },
    { size_units: 'MB', data_size: 1 },
    { size_units: 'MB', data_size: 100 },
];*/

const baseUnit = 1024;
const unit_mapping = {
    KB: {
        data_multiplier: baseUnit ** 1,
        dataset_multiplier: baseUnit ** 2
    },
    MB: {
        data_multiplier: baseUnit ** 2,
        dataset_multiplier: baseUnit ** 1
    },
    GB: {
        data_multiplier: baseUnit ** 3,
        dataset_multiplier: baseUnit ** 0
    }
};

async function getPropertiesFromS3Bucket(s3ops_arg, bucket, file_name, get_from_cache) {
    try {
        const object_list = await s3ops_arg.get_object(bucket, file_name, { get_from_cache: get_from_cache });
        console.log('Getting md5 data from file ' + file_name);
        return {
            md5: crypto.createHash('md5').update(object_list.Body).digest('base64'),
            size: object_list.Body.length
        };
    } catch (err) {
        throw new Error(`Getting md5 data from file ${file_name} ${err}`);
    }
}

async function compereMD5betweenCloudAndNooBaa(type, cloud_bucket, noobaa_bucket, force_cache_read, file_name) {
    console.log(`Compering NooBaa cache bucket to ${type} for ${file_name}`);
    const cloudProperties = await getPropertiesFromS3Bucket(namespace_mapping[type].s3ops, cloud_bucket, file_name, false);
    const cloudMD5 = cloudProperties.md5;
    const noobaaProperties = await getPropertiesFromS3Bucket(s3ops, noobaa_bucket, file_name, force_cache_read);
    const noobaaMD5 = noobaaProperties.md5;
    if (cloudMD5 === noobaaMD5) {
        console.log(`Noobaa cache bucket for (${noobaa_bucket}) contains the md5 ${
            noobaaMD5} and the cloud md5 is: ${JSON.stringify(cloudProperties)} for file ${file_name}`);
    } else {
        console.warn(`file: ${file_name} size is ${cloudProperties.size} on ${
            type} and ${noobaaProperties.size} on noobaa`);
        throw new Error(`Noobaa cache bucket for (${noobaa_bucket}) contains the md5 ${
            noobaaMD5} instead of ${cloudProperties} for file ${file_name}`);
    }
}

/*async function uploadDataSetToCloud(type, bucket) {
    for (const size of dataSet) {
        const { data_multiplier } = unit_mapping[size.size_units.toUpperCase()];
        const file_name = 'file_' + size.data_size + size.size_units + (Math.floor(Date.now() / 1000));
        files_cloud[`files_${type}`].push(file_name);
        await namespace_mapping[type].s3ops.put_file_with_md5(bucket, file_name, size.data_size, data_multiplier);
    }
}

async function upload_directly_to_cloud(type) {
    console.log(`Uploading files into ${type}`);
    const { data_multiplier } = unit_mapping.KB;
    const file_name = 'file_namespace_test_' + (Math.floor(Date.now() / 1000));
    files_cloud[`files_${type}`].push(file_name);
    try {
        await namespace_mapping[type].s3ops.put_file_with_md5(namespace_mapping[type].bucket2, file_name, 15, data_multiplier);
    } catch (err) {
        throw new Error(`Failed to upload directly into ${type}`);
    }
}

async function isFilesAvailableInNooBaaBucket(gateway, files, type) {
    console.log(`Checking uploaded files ${files} in noobaa s3 server bucket ${gateway}`);
    const list_files = await s3ops.get_list_files(gateway);
    const keys = list_files.map(key => key.Key);
    let report_fail = false;
    for (const file of files) {
        if (keys.includes(file)) {
            console.log('Server contains file ' + file);
        } else {
            report_fail = true;
            report.fail(`verify list files ${type}`);
            throw new Error(`Server is not contains uploaded file ${file} in bucket ${gateway}`);
        }
    }
    if (!report_fail) {
        report.success(`verify list files ${type}`);
    }
}*/

async function uploadFileToNoobaaS3(bucket, file_name) {
    let { data_multiplier } = unit_mapping.KB;
    try {
        await s3ops.put_file_with_md5(bucket, file_name, 15, data_multiplier);
    } catch (err) {
        throw new Error(`Failed upload file ${file_name} ${err}`);
    }
}

async function _delete_namespace_bucket(bucket) {
    console.log('Deleting namespace bucket ' + bucket);
    try {
        await bucket_functions.deleteBucket(bucket);
        report.success('delete namespace bucket');
    } catch (err) {
        report.fail('delete namespace bucket');
        throw new Error(`Failed to delete namespace bucket with error ${err}`);
    }
}

async function set_rpc_and_create_auth_token() {
    const auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: SYSTEM_NAME ? SYSTEM_NAME : 'demo'
    };
    return client.create_auth_token(auth_params);
}

async function _create_resource(type) {
    try {
        //create connection
        await cf.createConnection(connections_mapping[type], type);
        report.success(`create external connection ${type}`);
    } catch (e) {
        report.fail(`create external connection ${type}`);
        if (!clean_start && e.rpc_code !== 'CONNECTION_ALREADY_EXIST') {
            throw new Error(e);
        }
    }
    try {
        // create namespace resource
        await cf.createNamespaceResource(connections_mapping[type].name,
            namespace_mapping[type].namespace, namespace_mapping[type].bucket2);
        report.success(`create namespace resource ${type}`);
    } catch (e) {
        report.fail(`create namespace resource ${type}`);
        if (!clean_start && e.rpc_code !== 'IN_USE') {
            throw new Error(e);
        }
    }
    try {
        //create a namespace bucket
        await bucket_functions.createNamespaceBucket(namespace_mapping[type].gateway,
            namespace_mapping[type].namespace, { ttl_ms: CACHE_TTL_MS ? CACHE_TTL_MS : DEFAULT_CACHE_TTL_MS });
        report.success(`create namespace bucket ${type}`);
    } catch (e) {
        console.log("error:", e, "==", e.rpc_code);
        report.fail(`create namespace bucket ${type}`);
        if (!clean_start && e.rpc_code !== 'BUCKET_ALREADY_OWNED_BY_YOU') {
            throw new Error(e);
        }
    }
}

/*async function _upload_check_cache_and_cloud(type) {
    //upload dataset
    await uploadDataSetToCloud(type, namespace_mapping[type].bucket2);
    await upload_directly_to_cloud(type);
    await isFilesAvailableInNooBaaBucket(namespace_mapping[type].gateway, files_cloud[`files_${type}`], type);
    for (const file of files_cloud[`files_${type}`]) {
        try {
            await compereMD5betweenCloudAndNooBaa(type, namespace_mapping[type].bucket2, namespace_mapping[type].gateway, false, file);
            report.success(`read via namespace ${type}`);
        } catch (err) {
            console.log('Failed upload via cloud , check via noobaa');
            throw err;
        }
    }
}*/

async function upload_via_noobaa({ type, file_name, bucket }) {
    //Try to upload a file to noobaa s3 server
    if (!file_name) {
        file_name = 'file_namespace_test_' + (Math.floor(Date.now() / 1000));
    }
    if (!bucket) {
        bucket = namespace_mapping[type].gateway;
    }
    console.log(`uploading ${file_name} via noobaa bucket ${bucket}`);
    files_cloud[`files_${type}`].push(file_name);
    try {
        await uploadFileToNoobaaS3(bucket, file_name);
        report.success(`upload via noobaa to namespace ${type}`);
    } catch (e) {
        report.fail(`upload via noobaa to namespace ${type}`);
        throw new Error(`Failed to upload files into ${type}: ${e}`);
    }
    return file_name;
}

async function list_files_in_cloud(type) {
    const list_files_obj = await namespace_mapping[type].s3ops.get_list_files(namespace_mapping[type].bucket2);
    return list_files_obj.map(file => file.Key);
}

async function check_via_cloud(type, file_name) {
    console.log(`checking via ${type}: ${namespace_mapping[type].bucket2}`);
    const list_files = await list_files_in_cloud(type);
    console.log(`${type} files list ${list_files}`);
    if (list_files.includes(file_name)) {
        console.log(`${file_name} was uploaded via noobaa and found via ${type}`);
    } else {
        throw new Error(`${file_name} was uploaded via noobaa and was not found via ${type}`);
    }
    return true;
}

async function _upload_via_noobaa_check_via_cache_and_cloud({ type, file_name, bucket }) {
    //Try to upload a file to noobaa s3 server, verify it was uploaded to the cloud
    //Compare object in cache and cloud
    const uploaded_file_name = await upload_via_noobaa({ type, file_name, bucket });
    await check_via_cloud(type, uploaded_file_name);
    await compereMD5betweenCloudAndNooBaa(type, namespace_mapping[type].bucket2,
        namespace_mapping[type].gateway, true, uploaded_file_name);
    await compereMD5betweenCloudAndNooBaa(type, namespace_mapping[type].bucket2,
        namespace_mapping[type].gateway, false, uploaded_file_name);
}

/*async function update_read_write_and_check(clouds, name, read_resources, write_resource) {
    let should_fail;
    const run_on_clouds = _.clone(clouds);
    try {
        await bucket_functions.updateNamesapceBucket(name, write_resource, read_resources);
        report.success('update namespace bucket w resource');
    } catch (e) {
        report.fail('update namespace bucket w resource');
        throw new Error(e);
    }
    await P.delay(30 * 1000);
    console.error(`${RED}TODO: REMOVE THIS DELAY, IT IS TEMP OVERRIDE FOR BUG #4831${NC}`);
    const uploaded_file_name = await upload_via_noobaa({ type: run_on_clouds[0], bucket: name });
    //checking that the file was written into the read/write cloud
    await check_via_cloud(run_on_clouds[0], uploaded_file_name);
    run_on_clouds.shift();
    for (let cycle = 0; cycle < run_on_clouds.length; cycle++) {
        //checking that the file was not written into the read only clouds
        try {
            should_fail = await check_via_cloud(run_on_clouds[cycle], uploaded_file_name);
        } catch (e) {
            console.log(`${e}, as should`);
        }
        if (should_fail) {
            throw new Error(`Upload succeed To the read only cloud (${run_on_clouds[cycle]}) while it shouldn't`);
        }
    }
}

async function list_cloud_files_read_via_noobaa(type, noobaa_bucket) {
    const files_in_cloud_bucket = await list_files_in_cloud(type);
    for (const file of files_in_cloud_bucket) {
        try {
            await compereMD5betweenCloudAndNooBaa(type, namespace_mapping[type].bucket2, noobaa_bucket, file);
            report.success(`verify md5 via list on ${type}`);
        } catch (err) {
            report.fail(`verify md5 via list on ${type}`);
            throw err;
        }
    }
}*/

async function _clean_namespace_bucket(bucket, type) {
    const list_files = await s3ops.get_list_files(bucket);
    const keys = list_files.map(key => key.Key);
    if (keys) {
        for (const file of keys) {
            try {
                report.success(`delete via namespace ${type}`);
                await s3ops.delete_file(bucket, file);
            } catch (e) {
                report.fail(`delete via namespace ${type}`);
                console.error(`${RED}TODO: REMOVE THIS TRY CATCH, IT IS TEMP OVERRIDE FOR BUG #4832${NC}`);
            }
        }
    }
    await _delete_namespace_bucket(bucket);
}

async function clean_env(clouds) {
    for (const type of clouds) {
        try {
            await cf.deleteNamespaceResource(namespace_mapping[type].namespace);
            report.success(`delete namespace resource ${type}`);
        } catch (err) {
            report.fail(`delete namespace resource ${type}`);
        }
        try {
            await cf.deleteConnection(connections_mapping[type].name);
            report.success(`delete connection ${type}`);
        } catch (err) {
            report.fail(`delete connection ${type}`);
        }
    }
}

async function main(clouds) {
    try {
        await set_rpc_and_create_auth_token();
        for (const type of clouds) {
            await _create_resource(type);
            //await _upload_check_cache_and_cloud(type);
            await _upload_via_noobaa_check_via_cache_and_cloud({ type, file: 'file_cos_15KB', bucket: namespace_mapping[type].gateway });
            await _clean_namespace_bucket(namespace_mapping[type].gateway, type);
        }
        if (!skip_clean) {
            /*for (const type of clouds) {
                await _clean_namespace_bucket(bucket, type);
            }*/
            await clean_env(clouds);
        }
        await report.report();
        if (failures_in_test) {
            console.error('Errors during namespace test');
            console.error(`${JSON.stringify(_.countBy(errors), null, 4)}`);
            process.exit(1);
        } else {
            console.log('namespace cache tests were successful!');
            process.exit(0);
        }
    } catch (err) {
        console.error('something went wrong', err);
        await report.report();
        process.exit(1);
    }
}

main(cloud_list);
