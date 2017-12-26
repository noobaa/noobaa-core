/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const P = require('../../util/promise');
const s3ops = require('../utils/s3ops');
const api = require('../../api');
const promise_utils = require('../../util/promise_utils');
const AzureFunctions = require('../../deploy/azureFunctions');
const af = require('../utils/agent_functions');

require('../../util/dotenv').load();

let failures_in_test = false;
let errors = [];
let bucket;

//defining the required parameters
const {
    server_ip,
    location = 'westus2',
    resource,
    storage,
    vnet,
    agents_number = 3,
    failed_agents_number = 1,
    help = false
} = argv;

let rpc;
let client;
let pool_files = [];
let over_files = [];
let healthy_pool;
const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
const suffix = 'spill';

function usage() {
    console.log(`
    --location              -   azure location (default: ${location})
    --bucket                -   bucket to run on (default: ${bucket})
    --resource              -   azure resource group
    --storage               -   azure storage on the resource group
    --vnet                  -   azure vnet on the resource group
    --agents_number         -   number of agents to add (default: ${agents_number})
    --failed_agents_number  -   number of agents to fail (default: ${failed_agents_number})
    --server_ip             -   noobaa server ip.
    --help                  -   show this help.
    `);
}

if (help) {
    usage();
    process.exit(1);
}

console.log(`resource: ${resource}, storage: ${storage}, vnet: ${vnet}`);
const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

let osesSet = [
    'ubuntu12', 'ubuntu14', 'ubuntu16',
    'centos6', 'centos7',
    'redhat6', 'redhat7',
    'win2008', 'win2012', 'win2016'
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
let { data_multiplier } = unit_mapping.MB;

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}
//for bucket set enable(true)/disable(false) spillover
function setSpillover(bucket_name, status) {
    console.log('Setting spillover ' + status + ' for bucket ' + bucket_name);
    return client.bucket.update_bucket({
        name: bucket_name,
        use_internal_spillover: status
    })
        .catch(err => {
            saveErrorAndResume('Failed to set spillover ' + status + ' for bucket ' + bucket_name + err);
            failures_in_test = true;
            throw err;
        });
}

function createBucketWithEnableSpillover() {
    bucket = 'spillover.bucket' + (Math.floor(Date.now() / 1000));
    console.log('Creating bucket ' + bucket + ' with default pool first.pool');
    return s3ops.create_bucket(server_ip, bucket)
        .then(() => s3ops.get_list_buckets(server_ip))
        .then(res => {
            if (res.includes(bucket)) {
                console.log('Bucket is successfully added');
            } else {
                saveErrorAndResume(`Created bucket ${server_ip} bucket is not returns on list`, res);
            }
        })
        .then(() => setSpillover(bucket, true))
        .catch(err => {
            saveErrorAndResume('Failed creating bucket with enable spillover ' + err);
            failures_in_test = true;
            throw err;
        });
}
//checking that bucket with enable or disable spillover
function checkIsSpilloverHasStatus(bucket_name, status) {
    console.log('Checking for spillover status ' + status + ' for bucket ' + bucket_name);
    return client.system.read_system({})
        .then(res => {
            let buckets = res.buckets;
            let indexBucket = buckets.findIndex(values => values.name === bucket_name);
            let spilloverStatus = res.buckets[indexBucket].spillover_enabled;
            if (spilloverStatus === status) {
                console.log('Spillover for bucket ' + bucket_name + ' has status ' + status);
            } else {
                saveErrorAndResume('Spillover is disable for bucket ' + bucket_name);
                failures_in_test = true;
            }
        });
}

function checkAvailableSpace(bucket_name) {
    console.log('Checking available space in bucket ' + bucket_name);
    return client.system.read_system({})
        .then(res => {
            let buckets = res.buckets;
            let indexBucket = buckets.findIndex(values => values.name === bucket_name);
            let space = buckets[indexBucket].data.free;
            console.log('Available space in bucket ' + bucket_name + ' is ' + space);
            return space;
        });
}

function setQuotaBucket(bucket_name, size, unit) {
    console.log('Setting quota ' + size + unit + ' for bucket ' + bucket_name);
    return client.bucket.update_bucket({
        name: bucket_name,
        quota: {
            size,
            unit //'GIGABYTE', 'TERABYTE', 'PETABYTE'
        }
    })
        .catch(err => {
            saveErrorAndResume(`${server_ip} FAILED setting quota bucket `, err);
            failures_in_test = true;
            throw err;
        });
}

function disableQuotaBucket(bucket_name) {
    console.log('Disabling quota bucket');
    return client.bucket.update_bucket({
        name: bucket_name,
        quota: null
    })
        .catch(err => {
            saveErrorAndResume(`${server_ip} FAILED disable quota bucket `, err);
            failures_in_test = true;
            throw err;
        });
}

function uploadAndDeleteFiles(dataset_size, isOverSized, files) {
    let parts = 20;
    let partSize = dataset_size / parts;
    let file_size = Math.floor(partSize);
    let part = 0;
    console.log('Writing and deleting data till size amount to grow ' + dataset_size + ' MB');
    return promise_utils.pwhile(() => part < parts, () => {
    let file_name = 'file_part_' + part + file_size + (Math.floor(Date.now() / 1000));
        files.push(file_name);
        console.log('files list is ' + files);
        part += 1;
        console.log('Uploading file with size ' + file_size + ' MB');
        return s3ops.put_file_with_md5(server_ip, bucket, file_name, file_size, data_multiplier)
            .then(() => s3ops.delete_file(server_ip, bucket, file_name))
            .then(() => s3ops.put_file_with_md5(server_ip, bucket, file_name, file_size, data_multiplier))
            .catch(err => {
                saveErrorAndResume(`${server_ip} FAILED uploading and deleting files `, err);
                failures_in_test = true;
                throw err;
            });
    })
        .then(() => {
            if (isOverSized) {
                console.log('Uploading for getting over size ' + dataset_size);
                let file_name_over = 'file_over_' + file_size + (Math.floor(Date.now() / 1000));
                return s3ops.put_file_with_md5(server_ip, bucket, file_name_over, file_size, data_multiplier)
                    //When we get to the quota the writes should start failing
                    .catch(error => {
                        console.warn('Over size return error ' + error + ' - as should!!!');
                    });
            }
        });
}

function checkFileInPool(file_name, pool) {
    console.log('Checking file ' + file_name + ' is available and contains exactly in pool ' + pool);
    return client.object.read_object_mappings({
        bucket,
        key: file_name,
        adminfo: true
    })
        .then(res => {
        let chunkAvailable = res.parts.filter(chunk => chunk.chunk.adminfo.health === 'available').length;
        let partsInPool = res.parts.filter(chunk => chunk.chunk.frags[0].blocks[0].adminfo.pool_name.includes(pool)).length;
        let chunkNum = res.parts.length;
        let actualPool = res.parts[chunkNum - 1].chunk.frags[0].blocks[0].adminfo.pool_name;
            if (chunkAvailable === chunkNum) {
                console.log(`Available chunks ${chunkAvailable} all amount chunks ${chunkNum}`);
            } else {
                console.warn('Some chunk of file ' + file_name + ' has non available status');
            }
            if (partsInPool === chunkNum) {
                console.log(`All amount chunks ${chunkNum} in ${pool} parts ${partsInPool}`);
            } else {
                console.warn('Some chunk of file' + file_name + ' has pool ' + actualPool + ' instead ' + pool);
            }
    });
}

function editBucketDataPlacement(pool, bucket_name) {
    console.log('Getting tier for bucket ' + bucket_name);
    let tier;
    return client.system.read_system({})
        .then(res => {
            let buckets = res.buckets;
            let indexBucket = buckets.findIndex(values => values.name === bucket_name);
            tier = res.buckets[indexBucket].tiering.name;
            console.log('Editing bucket data placement to pool ' + pool);
            return client.tier.update_tier({
                attached_pools: [pool],
                data_placement: 'SPREAD',
                name: tier
            });
        })
        .catch(error => {
            saveErrorAndResume('Failed edit bucket data placement to pool ' + pool + error);
            failures_in_test = true;
        });
}

function createHealthyPool() {
    healthy_pool = 'healthy.pool' + (Math.floor(Date.now() / 1000));
    let list = [];
    return client.host.list_hosts({})
        .then(res => {
            let hosts = res.hosts;
            return P.each(hosts, host => {
                let mode = host.mode;
                if (mode === 'OPTIMAL') {
                    list.push(host.name);
                }
            });
        })
        .then(() => {
            console.log('Creating pool with online agents: ' + list);
            return client.pool.create_hosts_pool({
                hosts: list,
                name: healthy_pool
            });
        })
        .catch(error => {
            saveErrorAndResume('Failed create healthy pool ' + healthy_pool + error);
            failures_in_test = true;
        });
}

function assignNodesToPool(pool) {
    let listAgents = [];
    return client.host.list_hosts({})
        .then(res => {
            let hosts = res.hosts;
            return P.each(hosts, host => {
                let mode = host.mode;
                if (mode === 'OPTIMAL') {
                    listAgents.push(host.name);
                }
            });
        })
        .then(() => {
            console.log('Assigning online agents: ' + listAgents + ' to pool ' + pool);
            return client.pool.assign_hosts_to_pool({
                hosts: listAgents,
                name: pool
            });
        })
        .catch(error => {
            saveErrorAndResume('Failed assigning nodes to pool ' + pool + error);
            failures_in_test = true;
        });
}

function deletePool(pool) {
    console.log('Deleting pool ' + pool);
    return client.pool.delete_pool({
        name: pool
    })
        .catch(error => {
            saveErrorAndResume('Failed deleting pool ' + pool + error);
            failures_in_test = true;
        });
}

function clean_env() {
    console.log('Running cleaning data from ' + bucket);
    return s3ops.get_list_files(server_ip, bucket, '')
        .then(res => s3ops.delete_folder(server_ip, bucket, ...res))
        .delay(10000)
        .then(() => s3ops.delete_bucket(server_ip, bucket))
        .delay(10000)
        .then(() => assignNodesToPool('first.pool'))
        .then(() => deletePool(healthy_pool))
        .then(() => af.clean_agents(azf, osesSet, suffix));
}

return azf.authenticate()
    .then(() => af.clean_agents(azf, osesSet, suffix))
    .then(() => P.fcall(function() {
            rpc = api.new_rpc('wss://' + server_ip + ':8443');
            client = rpc.new_client({});
            let auth_params = {
                email: 'demo@noobaa.com',
                password: 'DeMo1',
                system: 'demo'
            };
            return client.create_auth_token(auth_params);
    }))
    //On a system, create a bucket and before adding capacity to it (use an empty pool), enable spillover and see that the files are written into the internal storage
    .then(() => createBucketWithEnableSpillover())
    .then(() => checkIsSpilloverHasStatus(bucket, true))
    .then(() => s3ops.put_file_with_md5(server_ip, bucket, 'spillover_file', 10, data_multiplier))
    .then(() => checkFileInPool('spillover_file', 'system-internal-storage-pool'))
    //Add pool with resources to the bucket and see that all the files are moving from the internal storage to the pool (pullback)
    .then(() => af.createRandomAgents(azf, server_ip, storage, vnet, agents_number, suffix, osesSet))
    .then(res => createHealthyPool())
    .then(() => editBucketDataPlacement(healthy_pool, bucket))
    .then(() => checkFileInPool('spillover_file', healthy_pool))
    //Set Quota of X on the bucket, X should be smaller then the available space on the bucket
    .then(() => setQuotaBucket(bucket, 1, 'GIGABYTE'))
    //Start writing and and deleting data on it (more writes than deletes since we want the size to grow) and see that we are failing when we get into the quota
    .then(() => uploadAndDeleteFiles(1000, false, pool_files))
    .then(() => P.each(pool_files, file => checkFileInPool(file, healthy_pool)))
    //Change the Quota of X on the bucket, X should be larger then the available space on the bucket
    .then(() => checkAvailableSpace(bucket))
    .then(res => {
        let quotaGB = Math.floor(res / 1024 / 1024 / 1024);
        let overQuota = quotaGB + 1;
        let uploadSizeMB = res / 1024 / 1024;
        console.log('Setting quota ' + overQuota + ' GB with available size ' + uploadSizeMB + 'MB');
        return setQuotaBucket(bucket, overQuota, 'GIGABYTE')
        //Start writing and and deleting data on it (more writes than deletes since we want the size to grow)
            .then(() => uploadAndDeleteFiles(uploadSizeMB, true, pool_files));
    })
    .then(() => P.each(pool_files, file => checkFileInPool(file, healthy_pool)))
    //Remove the quota
    .then(() => disableQuotaBucket(bucket))
    //Continue to write and see that the writes pass
    .then(() => uploadAndDeleteFiles(500, false, over_files))
    .then(() => P.each(over_files, file => checkFileInPool(file, 'system-internal-storage-pool')))
    //start deleting data from the Bucket
    .then(() => {
        console.log('Deleting files from healthy pool till will be free space');
        let freeSpace = false;
        let fileNumber = 0;
        return promise_utils.pwhile(
            () => freeSpace === false,
            () => P.resolve(checkAvailableSpace(bucket))
                .then(res => {
                    let space = res / 1024 / 1024 / 1024;
                    if (space >= 1) {
                        freeSpace = true;
                    } else {
                        fileNumber += 1;
                        console.log('Waiting for free space and delete random file ' + pool_files[fileNumber]);
                        return s3ops.delete_file(server_ip, bucket, pool_files[fileNumber]);
                    }
                        fileNumber += 1;
                    })
                .delay(5000));
    })
    //Monitor the over uploaded objects , see that they start to be moved into the pool from the internal storage
    .then(() => checkFileInPool(over_files[0], healthy_pool))
    //write again and see that we writing into the internal storage again
    .then(() => checkAvailableSpace(bucket))
    .then(res => {
            let uploadSizeMB = Math.floor(res / 1024 / 1024);
            return uploadAndDeleteFiles(uploadSizeMB, true, pool_files);
    })
    .then(() => checkFileInPool(pool_files[pool_files.length - 1], 'system-internal-storage-pool'))
    //stop the writes and disable the spillover on the bucket
    .then(() => setSpillover(bucket, false))
    //try to write some more see that it fails
    .then(() => s3ops.put_file_with_md5(server_ip, bucket, 'spillover_file_without_internal_storage', 10, data_multiplier)
            .catch(error => {
                console.warn('Uploading without free space and disable spillover returns error ' + error + ' as should');
            }))
    .then(() => P.each(pool_files, file => s3ops.delete_file(server_ip, bucket, file)))
    //Monitor the over uploaded objects , see that they start to be moved into the pool from the internal storage
    .then(() => checkFileInPool(over_files[1], healthy_pool))
    .catch(err => {
        console.error('something went wrong :(' + err + errors);
        failures_in_test = true;
        throw err;
    })
    .then(() => {
        if (failures_in_test) {
            console.error(':( :( Errors during spillover test ): ):' + errors);
            process.exit(1);
        } else {
                return clean_env()
                .then(() => {
                    console.log(':) :) :) spillover test were successful! (: (: (:');
                    process.exit(0);
                });
        }
    });
