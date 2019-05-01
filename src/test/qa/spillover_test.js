/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');
const af = require('../utils/agent_functions');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
const Report = require('../framework/report');
const AzureFunctions = require('../../deploy/azureFunctions');
const { BucketFunctions } = require('../utils/bucket_functions');
const { CloudFunction } = require('../utils/cloud_functions');
dbg.set_process_name('spillover');

let errors = [];
let failures_in_test = false;
const time_stemp = (Math.floor(Date.now() / 1000));
const bucket = 'spillover.bucket' + time_stemp;
const healthy_pool = 'healthy.pool' + time_stemp;

//defining the required parameters
const {
    server_ip,
    location = 'westus2',
    resource,
    storage,
    vnet,
    id = 0,
    agents_number = 3,
    failed_agents_number = 1,
    help = false
} = argv;


const s3ops = new S3OPS({ ip: server_ip });
//define colors
const NC = "\x1b[0m";
// const RED = "\x1b[31m";
const YELLOW = "\x1b[33;1m";

let pool_files = [];
let over_files = [];
const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
const suffix = 'spillover-' + id;

function usage() {
    console.log(`
    --location              -   azure location (default: ${location})
    --bucket                -   bucket to run on (default: spillover.bucket + timestemp)
    --resource              -   azure resource group
    --storage               -   azure storage on the resource group
    --vnet                  -   azure vnet on the resource group
    --agents_number         -   number of agents to add (default: ${agents_number})
    --failed_agents_number  -   number of agents to fail (default: ${failed_agents_number})
    --id                    -   an id that is attached to the agents name
    --server_ip             -   noobaa server ip.
    --help                  -   show this help.
    `);
}

if (help) {
    usage();
    process.exit(1);
}

console.log(`resource: ${resource}, storage: ${storage}, vnet: ${vnet}`);

const rpc = api.new_rpc('wss://' + server_ip + ':8443');
const client = rpc.new_client({});

let report = new Report();
let bf = new BucketFunctions(client, report);
const cf = new CloudFunction(client, report);
const azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);
report.init_reporter({
    suite: 'spillover_test',
    conf: { agents_number: agents_number, failed_agents_number: failed_agents_number },
    mongo_report: true
});

let osesSet = af.supported_oses();

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
    failures_in_test = true;
}


async function get_files_in_array() {
    const list_files = await s3ops.get_list_files(bucket);
    const keys = list_files.map(key => key.Key);
    return keys;
}

async function createBucketWithEnabledSpillover() {
    console.log('Creating bucket ' + bucket + ' with default pool first.pool');
    try {
        await s3ops.create_bucket(bucket);
        const list_buckets = await s3ops.get_list_buckets();
        if (list_buckets.includes(bucket)) {
            console.log('Bucket is successfully added');
        } else {
            saveErrorAndResume(`Created bucket ${server_ip} bucket is not returns on list`, list_buckets);
        }
        const internalpool = await bf.getInternalStoragePool(server_ip);
        await bf.setSpillover(bucket, internalpool);
    } catch (err) {
        saveErrorAndResume('Failed creating bucket with enable spillover ' + err);
        throw err;
    }
}

async function uploadFiles(dataset_size, files) {
    let number_of_files = Math.floor(dataset_size / 1024); //dividing to 1024 will get files in GB
    if (number_of_files < 1) number_of_files = 1; //making sure we have atlist 1 file.
    const file_size = Math.floor(dataset_size / number_of_files) + 1; //writing extra MB so we will be sure we reache max capacity.
    const parts_num = Math.floor(file_size / 100);
    const timeStemp = (Math.floor(Date.now() / 1000));
    console.log(`${YELLOW}Writing ${number_of_files} files with total size: ${dataset_size + number_of_files} MB${NC}`);
    for (let count = 0; count < number_of_files; count++) {
        const file_name = `file_${count}_${file_size}_${timeStemp}`;
        files.push(file_name);
        console.log(`Uploading ${file_name} with size ${file_size} MB`);
        try {
            await s3ops.upload_file_with_md5(bucket, file_name, file_size, parts_num, data_multiplier);
            await P.delay(1 * 1000);
        } catch (err) {
            saveErrorAndResume(`${server_ip} FAILED uploading files `, err);
            throw err;
        }
    }
    console.log('files list is ' + files);
}

async function test_failed_upload(dataset_size) {
    const file_size = Math.floor(dataset_size);
    const timeStemp = (Math.floor(Date.now() / 1000));
    console.log(`Tring to upload ${dataset_size} MB after we have reached the quota`);
    const file_name = `file_over_${file_size}_${timeStemp}`;
    try {
        await s3ops.put_file_with_md5(bucket, file_name, file_size, data_multiplier);
        report.success('fail ul over quota');
    } catch (error) { //When we get to the quota the writes should start failing
        console.log('Tring to upload pass the quota failed - as should');
        return;
    }
    report.fail('fail ul over quota');
    throw new Error(`We should have failed uploading pass the quota`);
}

async function checkFileInPool(file_name, pool) {
    let keep_run = true;
    let retry = 0;
    const MAX_RETRY = 15;
    let chunkAvailable;
    while (keep_run) {
        try {
            console.log(`Checking file ${file_name} is available and contains exactly in pool ${pool}`);
            const { chunks } = await client.object.read_object_mapping_admin({
                bucket,
                key: file_name,
            });
            chunkAvailable = chunks.filter(chunk => chunk.adminfo.health === 'available');
            const chunkAvailablelength = chunkAvailable.length;
            const partsInPool = chunks.filter(chunk =>
                chunk.frags[0].blocks[0].adminfo.pool_name.includes(pool)).length;
            const chunkNum = chunks.length;
            if (chunkAvailablelength === chunkNum) {
                console.log(`Available chunks: ${chunkAvailablelength}/${chunkNum} for ${file_name}`);
            } else {
                throw new Error(`Chanks for file ${file_name} should all be in ${
                    pool}, Expected ${chunkNum}, recived ${chunkAvailablelength}`);
            }
            if (partsInPool === chunkNum) {
                console.log(`All The ${chunkNum} chanks are in ${pool}`);
            } else {
                throw new Error(`Expected ${chunkNum} parts in ${pool} for file ${file_name}, recived ${partsInPool}`);
            }
            keep_run = false;
        } catch (e) {
            if (retry <= MAX_RETRY) {
                retry += 1;
                console.error(e);
                console.log(`Sleeping for 20 sec and retrying`);
                await P.delay(20 * 1000);
            } else {
                console.error(chunkAvailable);
                throw e;
            }
        }
    }
}

async function createHealthyPool() {
    let list = [];
    const list_hosts = await client.host.list_hosts({});
    try {
        for (const host of list_hosts.hosts) {
            if ((host.mode === 'OPTIMAL') && (host.name.includes(suffix))) {
                list.push(host.name);
            }
        }
        console.log('Creating pool with online agents: ' + list);
        await client.pool.create_hosts_pool({
            name: healthy_pool,
            hosts: list
        });
        return healthy_pool;
    } catch (error) {
        saveErrorAndResume('Failed create healthy pool ' + healthy_pool + error);
    }
}

async function assignNodesToPool(pool) {
    let listAgents = [];
    try {
        const list_hosts = await client.host.list_hosts({});
        for (const host of list_hosts.hosts) {
            if (host.mode === 'OPTIMAL') {
                listAgents.push(host.name);
            }
        }
        console.log('Assigning online agents: ' + listAgents + ' to pool ' + pool);
        await client.pool.assign_hosts_to_pool({
            name: pool,
            hosts: listAgents
        });
    } catch (error) {
        saveErrorAndResume('Failed assigning nodes to pool ' + pool + error);
    }
}

async function clean_env() {
    console.log('Running cleaning data from ' + bucket);
    await s3ops.delete_all_objects_in_bucket(bucket, true);
    await P.delay(10 * 1000);
    await s3ops.delete_bucket(bucket);
    await P.delay(10 * 1000);
    await assignNodesToPool('first.pool');
    await cf.deletePool(healthy_pool);
    await af.clean_agents(azf, server_ip, suffix);
}

async function set_rpc_and_create_auth_token() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
}

async function check_internal_spillover_without_agents() {

    /* On a system, create a bucket and before adding capacity to it (use an empty pool), 
       enable spillover and see that the files are written into the internal storage */
    try {
        await createBucketWithEnabledSpillover();
        report.success('create bucket with spillover');
        await bf.checkIsSpilloverHasStatus(bucket, true);
    } catch (e) {
        report.fail('create bucket with spillover');
        throw new Error(`Failed to write on internal spillover: ${e}`);
    }
    try {
        await s3ops.put_file_with_md5(bucket, 'spillover_file', 10, data_multiplier);
        await checkFileInPool('spillover_file', 'system-internal-storage-pool');
        report.success('write to spillover no agents');
    } catch (e) {
        report.fail('write to spillover no agents');
        throw new Error(`Failed to write on internal spillover: ${e}`);
    }
}

async function check_file_evacuation(file, pool) {
    const base_time = Date.now();
    let file_in_pool;
    while (Date.now() - base_time < 180 * 1000) {
        try {
            await checkFileInPool(file, pool);
            file_in_pool = true;
            break;
        } catch (e) {
            await P.delay(15 * 1000);
        }
    }
    if (!file_in_pool) {
        throw new Error(`${file} was not evacuated from the spillover`);
    }
}

async function add_agents_and_check_evacuation() {
    try {
        //Add pool with resources to the bucket and see that all the files are moving from the internal storage to the pool (pullback)
        await af.createRandomAgents(azf, server_ip, storage, vnet, agents_number, suffix, osesSet);
        report.success('creating agents');
    } catch (e) {
        report.fail('creating agents');
        throw new Error(`Evacuation from the spillover failed: ${e}`);
    }
    try {
        await createHealthyPool();
        await bf.editBucketDataPlacement(healthy_pool, bucket, 'SPREAD');
        await check_file_evacuation('spillover_file', healthy_pool);
        report.success('spillback');
    } catch (e) {
        report.fail('spillback');
        throw new Error(`Evacuation from the spillover failed: ${e}`);
    }
}

async function list_files_in_a_pool(keys, pool) {
    const files = [];
    if (!keys) {
        keys = await get_files_in_array();
    }
    if (keys) {
        for (const file_name of keys) {
            try {
                await checkFileInPool(file_name, pool);
                files.push(file_name);
            } catch (e) {
                //object not resides according to policy on the pool
            }
        }
    }
    return files;
}

async function clean_all_files_from_bucket(skip_form_spillover = false, pool) {
    const keys = await get_files_in_array();
    if (keys) {
        if (skip_form_spillover) {
            const files = await list_files_in_a_pool(keys, pool);
            for (const file of files) {
                await s3ops.delete_file(bucket, file);
            }
        } else {
            for (const file of keys) {
                await s3ops.delete_file(bucket, file);
            }
        }
    }
}

async function aggregated_file_size(files_list, size, return_size = false) {
    const files_to_delete = [];
    let aggregated_size = 0;
    for (const file of files_list) {
        if (aggregated_size < size) {
            aggregated_size = await s3ops.get_file_size(bucket, file);
            files_to_delete.push(file);
        } else {
            break;
        }
    }
    if (return_size) {
        return aggregated_size;
    } else {
        return files_to_delete;
    }
}

//deleting files with at list "size" (MB)
async function clean_files_from_bucket(skip_form_spillover, pool, size) {
    const keys = await get_files_in_array();
    let files_to_delete = [];
    if (keys) {
        if (skip_form_spillover) {
            const files = await list_files_in_a_pool(keys, pool);
            files_to_delete = await aggregated_file_size(files, size);
            for (const file of files_to_delete) {
                await s3ops.delete_file(bucket, file);
            }
        } else {
            files_to_delete = await aggregated_file_size(keys, size);
            for (const file of files_to_delete) {
                await s3ops.delete_file(bucket, file);
            }
        }
    }
    return files_to_delete;
}

async function upload_and_check_evacuation() {
    //start deleting data from the Bucket (files from the agents)
    for (let count = 0; count < 5; count++) {
        const spillover_files = [];
        await uploadFiles(1024, spillover_files);
        await checkFileInPool(spillover_files[0], 'system-internal-storage-pool');
        await clean_files_from_bucket(false, healthy_pool, 1024);
        try {
            for (const file of spillover_files) {
                await check_file_evacuation(file, healthy_pool);
                report.success('spillback on free space');
            }
        } catch (e) {
            report.fail('spillback on free space');
            throw e;
        }
    }
}

async function wait_no_avilabe_space() {
    const base_time = Date.now();
    let is_no_avilable;
    while (Date.now() - base_time < 360 * 1000) {
        try {
            is_no_avilable = await bf.checkAvilableSpace(bucket);
            if (is_no_avilable === 0) {
                break;
            } else {
                await P.delay(15 * 1000);
            }
        } catch (e) {
            throw new Error(`Something went wrong with checkAvilableSpace`);
        }
    }
    if (is_no_avilable !== 0) {
        throw new Error(`Avilable space should have been 0 by now`);
    }
}

async function check_quota() {
    await bf.setQuotaBucket(bucket, 1, 'GIGABYTE');
    // Start writing and see that we are failing when we get into the quota
    await uploadFiles(1024, pool_files);
    await wait_no_avilabe_space(bucket);
    await test_failed_upload(1024);
    for (const file of pool_files) {
        await checkFileInPool(file, healthy_pool);
    }
}

async function check_quota_on_spillover() {
    const available_space = await bf.checkFreeSpace(bucket);
    const available_space_GB = Math.floor(available_space / 1024 / 1024 / 1024);
    const quota = available_space_GB + 1;
    const uploadSizeMB = Math.floor(available_space / 1024 / 1024);
    // Setting the quota so it will be on the spillover 
    console.log(`Setting quota to ${quota} GB, larger the the available space (${uploadSizeMB / 1024} GB)`);
    await bf.setQuotaBucket(bucket, quota, 'GIGABYTE');
    // Start writing
    await uploadFiles(uploadSizeMB, pool_files);
    await wait_no_avilabe_space(bucket);
    await test_failed_upload(1024);
    for (const file of pool_files) {
        await checkFileInPool(file, healthy_pool);
    }
}

async function disable_spillover_and_check() {
    for (let count = 0; count < 5; count++) {
        //Fill bucket 
        const free_space = await bf.checkFreeSpace(bucket);
        if (free_space !== 0) {
            const uploadSizeMB = Math.floor(free_space / 1024 / 1024);
            await uploadFiles(uploadSizeMB, pool_files);
        }
        const keys = await get_files_in_array();
        let spillover_files = await list_files_in_a_pool(keys, 'system-internal-storage-pool');
        //upload files into spillover if none exists
        if (spillover_files.length === 0) {
            await uploadFiles(1024, over_files);
        }
        //Disable spillover
        await bf.setSpillover(bucket, null);
        try {
            await test_failed_upload(1024);
            report.success('fail on no space and no spillover');
        } catch (e) {
            report.fail('fail on no space and no spillover');
            throw e;
        }
        spillover_files = await list_files_in_a_pool(keys, 'system-internal-storage-pool');
        const size = await aggregated_file_size(spillover_files, 10 * 1024 * 1024 * 1024, true); //making sure we get all files.
        await clean_files_from_bucket(true, healthy_pool, size);
        try {
            for (const file of spillover_files) {
                await checkFileInPool(file, healthy_pool);
            }
            report.success('spillback of files');
        } catch (err) {
            report.fail('spillback of files');
            throw err;
        }
    }
}

async function disable_quota_and_check() {
    await bf.disableQuotaBucket(server_ip, bucket);
    await P.delay(10 * 1000); //delay to get pool cool down
    //Continue to write and see that the writes pass
    await uploadFiles(500, over_files);
    try {
        for (const file of over_files) {
            await checkFileInPool(file, 'system-internal-storage-pool');
            report.success('ul over pool capacity');
        }
    } catch (e) {
        report.fail('ul over pool capacity');
        throw e;
    }
}

/*async function set_cloud_spillover() {
    const AWSDefaultConnection = cf.getAWSConnection();
    await cf.createConnection(AWSDefaultConnection, 'AWS');
    await cf.createCloudPool(AWSDefaultConnection.name, "qa-bucket", "QA-Bucket");
    await bf.setSpillover(bucket, "qa-bucket");
}*/

async function main() {
    await azf.authenticate();
    await af.clean_agents(azf, server_ip, suffix);
    await set_rpc_and_create_auth_token();
    try {
        await check_internal_spillover_without_agents();
        await add_agents_and_check_evacuation();
        await clean_all_files_from_bucket(false, healthy_pool);
        await check_quota();
        await check_quota_on_spillover();
        await disable_quota_and_check();
        await upload_and_check_evacuation();
        await disable_spillover_and_check();

        /* TODO: 1. change the spillover to cloud
                 2. repeate the steps above
         */
        await report.report();
        if (failures_in_test) {
            console.error('Errors during spillover test ' + errors);
            process.exit(1);
        } else {
            await clean_env();
            console.log('spillover test were successful!');
            process.exit(0);
        }
    } catch (err) {
        console.error('something went wrong ' + err + errors);
        process.exit(1);
    }
}

main();
