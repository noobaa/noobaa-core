/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const RandStream = require('../../util/rand_stream');
const AWS = require('aws-sdk');
const azure_storage = require('../../util/azure_storage_wrap');
const s3ops = require('../qa/s3ops');
const api = require('../../api');

require('../../util/dotenv').load();

let failures_in_test = false;
let errors = [];
let files_azure = [];
let files_aws = [];

//defining the required parameters
const {
    server_ip = '52.247.206.235',
} = argv;

let rpc;
let client;

const connections_mapping = {
    AWS: {
        name: 'AWSConnection',
        endpoint: "https://s3.amazonaws.com",
        endpoint_type: "AWS",
        identity: 'AKIAJJCHBZVA3VSS2YCQ',
        secret: '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'
    },
    AZURE: {
        name: 'AZUREConnection',
        endpoint: "https://azureconnection.blob.core.windows.net",
        endpoint_type: "AZURE",
        identity: "azureconnection",
        secret: "UsMgM/8uX2FMAwW765fSBATLjROZn+JbxxHLYXDUfBmV0vtpiYkGnRrB8hkSvVcV92pbSxG4J1j/q0IFy3nb6g=="
    }
};
const blobService = azure_storage.createBlobService(connections_mapping.AZURE.identity, connections_mapping.AZURE.secret, connections_mapping.AZURE.endpoint);
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
    {size_units: 'KB', data_size: 1},
    {size_units: 'KB', data_size: 500},
    {size_units: 'MB', data_size: 1},
    {size_units: 'MB', data_size: 100},
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

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

function createNamespaceResource(connection, name, target_bucket) {
    console.log('Creating namespace with connection ' + connection);
    return client.pool.create_namespace_resource({
        connection,
        name,
        target_bucket
    })
        .catch(err => {
            saveErrorAndResume('Failed to create namespace resource ', err);
            failures_in_test = true;
            throw err;
        });
}

function createGatewayBucket(name, namespace) {
    console.log('Creating gateway bucket with namespace ' + namespace);
    return client.bucket.create_bucket({
        name,
        namespace: {
            read_resources: [namespace],
            write_resource: namespace
        }
    })
        .catch(err => {
            saveErrorAndResume('Failed to create gateway bucket ', err);
            failures_in_test = true;
            throw err;
        });
}

function createCloudPool(connection, name, target_bucket) {
    console.log('Creating cloud pool ' + connection);
    return client.pool.create_cloud_pool({
        connection,
        name,
        target_bucket
    })
        .catch(err => {
            saveErrorAndResume('Failed to create cloud pool ', err);
            failures_in_test = true;
            throw err;
        });
}

function waitingForHealthyPool(poolName) {
    let retries = 0;
    let healthy = false;
    console.log('Waiting for pool getting healthy');
    return promise_utils.pwhile(
        () => healthy === false && retries !== 36,
        () => P.resolve(client.system.read_system({}))
            .then(res => {
                let poolIndex = res.pools.findIndex(pool => pool.name === 'cloud-resource-aws');
                let status = res.pools[poolIndex].mode;
                if (status === 'OPTIMAL') {
                    console.log('Pool ' + poolName + ' is healthy');
                    healthy = true;
                } else {
                    retries += 1;
                    console.log('Pool ' + poolName + ' has status ' + status + ' waiting for OPTIMAL extra 5 seconds');
                }
            })
            .delay(5000));
}

function deleteConnection(connection_name) {
    console.log('Deleting connection ' + connection_name);
    return client.account.delete_external_connection({
        connection_name
    })
        .catch(err => {
            saveErrorAndResume('Failed to delete connection ', err);
            failures_in_test = true;
            throw err;
        });
}

function uploadFileToAzure(container, file_name, size) {
    console.log('Uploading file ' + file_name + ' to azure container ' + container);
    let streamFile = new RandStream(size, {
        highWaterMark: 1024 * 1024,
    });
    return P.fromCallback(callback => blobService.createBlockBlobFromStream(container, file_name, streamFile, size, callback))
        .catch(err => {
            saveErrorAndResume('Uploading to AZURE file ' + file_name + ' with error ' + err);
            failures_in_test = true;
            throw err;
        });
}

function uploadDataSetToAzure(container) {
    return P.each(dataSet, size => {
        let { data_multiplier } = unit_mapping[size.size_units.toUpperCase()];
        let file_name = 'file_' + size.data_size + size.size_units + (Math.floor(Date.now() / 1000));
        const actual_size = size.data_size * data_multiplier;
        files_azure.push(file_name);
        return uploadFileToAzure(container, file_name, actual_size);
    });
}

function getListFilesAzure(bucket) {
    let blobs = [];
    console.log('Getting list from azure container ' + bucket);
    return P.fromCallback(callback => blobService.listBlobsSegmented(bucket, null, callback))
        .then(res => {
            res.entries.forEach(function(blob) {
                blobs.push(blob.name);
            });
        })
        .then(() => blobs)
        .catch(err => {
            saveErrorAndResume('Failed to get list from azure ' + err);
            failures_in_test = true;
            throw err;
        });
}

function uploadFileToAWS(bucket, file_name, size) {
    const s3 = new AWS.S3({
        endpoint: connections_mapping.AWS.endpoint,
        accessKeyId: connections_mapping.AWS.identity,
        secretAccessKey: connections_mapping.AWS.secret,
        s3ForcePathStyle: true,
        signatureVersion: 's3',
        computeChecksums: false,
        s3DisableBodySigning: true,
        region: 'us-east-1',
        params: {
            Bucket: bucket
        },
    });
    let streamFile = new RandStream(size, {
        highWaterMark: 1024 * 1024,
    });
    console.log('Uploading file ' + file_name + ' to AWS S3 bucket ' + bucket);
    return P.fromCallback(callback => s3.putObject({
        Key: file_name,
        ContentLength: size,
        Body: streamFile
    }, callback))
        .catch(err => {
            saveErrorAndResume('Failed upload file ' + file_name + err);
            failures_in_test = true;
            throw err;
        });
}

function uploadDataSetToAWS(bucket) {
    return P.each(dataSet, size => {
        let { data_multiplier } = unit_mapping[size.size_units.toUpperCase()];
        let file_name = 'file_' + size.data_size + size.size_units + (Math.floor(Date.now() / 1000));
        const actual_size = size.data_size * data_multiplier;
        files_aws.push(file_name);
        return uploadFileToAWS(bucket, file_name, actual_size);
    });
}

function isUploadedSetAvailable(gateway, files) {
    console.log('Checking uploaded files ' + files + ' in noobaa s3 server bucket ' + gateway);
    let keys = [];
    return s3ops.get_list_files(server_ip, gateway)
        .then(res => {
            res.forEach(function(key) {
                keys.push(key.Key);
            });
        })
        .then(() => files.forEach(function(file) {
            if (keys.includes(file)) {
                console.log('Server contains file ' + file);
            } else {
                saveErrorAndResume('Server is not contains uploaded file ' + file + ' in bucket ' + gateway);
                failures_in_test = true;
            }
        }));
}

function uploadFileToNoobaaS3(bucket, file_name) {
    let { data_multiplier } = unit_mapping.KB;
    return s3ops.put_file_with_md5(server_ip, bucket, file_name, 15, data_multiplier)
        .catch(err => {
            saveErrorAndResume('Failed upload file ' + file_name + err);
            failures_in_test = true;
            throw err;
        });
}

function deleteGatewayBucket(bucket) {
    console.log('Deleting gateway bucket ' + bucket);
    return client.bucket.delete_bucket({
        name: bucket
    })
        .catch(err => {
            saveErrorAndResume('Failed to delete gateway bucket with error' + err);
            failures_in_test = true;
            throw err;
        });
}

function deleteCloudPool(pool) {
    console.log('Deleting cloud pool ' + pool);
    return client.pool.delete_pool({
        name: pool
    })
        .catch(err => {
            saveErrorAndResume('Failed to delete cloud pool error' + err);
            failures_in_test = true;
            throw err;
        });
}

function deleteNamespace(namespace) {
    console.log('Deleting cloud pool ' + namespace);
    return client.pool.delete_namespace_resource({
        name: namespace
    })
        .catch(err => {
            saveErrorAndResume('Failed to delete cloud pool error' + err);
            failures_in_test = true;
            throw err;
        });
}

P.fcall(function() {
    rpc = api.new_rpc('wss://' + server_ip + ':8443');
    client = rpc.new_client({});
    rpc.disable_validation();
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
})
    //creating connection
    .then(() => {
        console.log('Creating AZURE connection');
        return P.resolve(client.account.add_external_connection(connections_mapping.AZURE));
    })
    .then(() => {
        console.log('Creating AWS connection');
        return P.resolve(client.account.add_external_connection(connections_mapping.AWS));
    })
    //creating two cloud resources
    .then(() => createCloudPool(connections_mapping.AWS.name, namespace_mapping.AWS.pool, namespace_mapping.AWS.bucket1))
    .then(() => createCloudPool(connections_mapping.AZURE.name, namespace_mapping.AZURE.pool, namespace_mapping.AZURE.bucket1))
    //waiting until both these resources are "healthy"
    .then(() => waitingForHealthyPool(namespace_mapping.AWS.pool))
    .then(() => waitingForHealthyPool(namespace_mapping.AZURE.pool))
    .then(() => createNamespaceResource(connections_mapping.AWS.name, namespace_mapping.AWS.namespace, namespace_mapping.AWS.bucket2))
    .then(() => createNamespaceResource(connections_mapping.AZURE.name, namespace_mapping.AZURE.namespace, namespace_mapping.AZURE.bucket2))
    //Create a namespace bucket over these 2 connections
    .then(() => createGatewayBucket(namespace_mapping.AWS.gateway, namespace_mapping.AWS.namespace))
    .then(() => createGatewayBucket(namespace_mapping.AZURE.gateway, namespace_mapping.AZURE.namespace))
    //Upload directly to the S3 bucket some objects, same for the azure container (4 different files on each)
    .then(() => uploadDataSetToAzure(namespace_mapping.AZURE.bucket2))
    .then(() => uploadDataSetToAWS(namespace_mapping.AWS.bucket2))
    //Upload directly to the S3 bucket some objects, same for the azure container 1 object with the same name on both
    .then(() => {
        console.log('Uploading file with the same name');
        let { data_multiplier } = unit_mapping.KB;
        let file_name = 'file_namespace_test_' + (Math.floor(Date.now() / 1000));
        const actual_size = 15 * data_multiplier;
        files_aws.push(file_name);
        files_azure.push(file_name);
        return uploadFileToAWS(namespace_mapping.AWS.bucket2, file_name, actual_size)
            .then(() => uploadFileToAzure(namespace_mapping.AZURE.bucket2, file_name, actual_size));
    })
    //list the files in the namespace bucket on noobaa server, verify all the unique files appear, and only 1 of the duplicate names
    .then(() => isUploadedSetAvailable(namespace_mapping.AZURE.gateway, files_azure))
    .then(() => isUploadedSetAvailable(namespace_mapping.AWS.gateway, files_aws))
    //Try to read a file from noobaa server s3 which is on the AWS bucket and azure container
    .then(() => P.each(files_azure, file => s3ops.get_object(server_ip, namespace_mapping.AZURE.gateway, file)))
    .then(() => P.each(files_aws, file => s3ops.get_object(server_ip, namespace_mapping.AWS.gateway, file)))
    //Try to upload a file to noobaa s3 server, verify it was uploaded to the Azure container
    .then(() => {
        let file_name = 'file_azure_15KB';
        files_azure.push(file_name);
        return uploadFileToNoobaaS3(namespace_mapping.AZURE.gateway, file_name);
    })
    .then(() => getListFilesAzure(namespace_mapping.AZURE.bucket2))
    .then(res => {
        console.log('Azure files list ' + res);
        if (res.includes('file_azure_15KB')) {
            console.log('Uploaded file to noobaa s3 server is contains in azure container');
        } else {
            saveErrorAndResume('Uploaded file to noobaa s3 server is not contains in azure container');
            failures_in_test = true;
        }
    })
    //deleting files from noobaa sever gateway buckets
    .then(() => P.each(files_azure, file => s3ops.delete_file(server_ip, namespace_mapping.AZURE.gateway, file)))
    .then(() => P.each(files_aws, file => s3ops.delete_file(server_ip, namespace_mapping.AWS.gateway, file)))
    //cleaning env
    .then(() => deleteGatewayBucket(namespace_mapping.AWS.gateway))
    .then(() => deleteGatewayBucket(namespace_mapping.AZURE.gateway))
    .then(() => deleteNamespace(namespace_mapping.AZURE.namespace))
    .then(() => deleteNamespace(namespace_mapping.AWS.namespace))
    .then(() => deleteCloudPool(namespace_mapping.AWS.pool))
    .then(() => deleteCloudPool(namespace_mapping.AZURE.pool))
    .then(() => deleteConnection(connections_mapping.AWS.name))
    .then(() => deleteConnection(connections_mapping.AZURE.name))
    .catch(err => {
        console.error('something went wrong :(' + err + errors);
        failures_in_test = true;
    })
    .then(() => {
        if (failures_in_test) {
            console.error(':( :( Errors during namespace test ): ):' + errors);
            process.exit(1);
        }
        console.log(':) :) :) namespace tests were successful! (: (: (:');
        process.exit(0);
    });
