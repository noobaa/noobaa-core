/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const auth_params = {
    email: 'demo@noobaa.com',
    password: 'DeMo1',
    system: 'demo'
};


function listBuckets(server_ip) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(res => client.bucket.list_buckets())
        .catch(err => {
            console.log(`${server_ip} FAILED to get bucket list`, err);
            throw err;
        });

}

function createBucket(server_ip, name) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(res => client.bucket.create_bucket({ name: name }))
        .catch(err => {
            console.log('Create bucket ERR', err);
            throw err;
        });
}

function deleteBucket(server_ip, name) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(res => client.bucket.delete_bucket({ name: name }))
        .catch(err => {
            console.log('Delete bucket ERR', err);
            throw err;
        });
}

function changeTierSetting(server_ip, bucket, data_frags, parity_frags, replicas) {
    if (replicas && (data_frags || parity_frags)) {
        throw new Error('Both erasure coding and replicas cannot be set simultaneously ');
    } else if (!replicas && !(data_frags && parity_frags)) {
        throw new Error('Both erasure coding and replicas cannot be empty');
    }

    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    let chunk_coder_config = {};
    if (replicas) {
        chunk_coder_config.replicas = replicas;
    } else {
        chunk_coder_config.data_frags = data_frags;
        chunk_coder_config.parity_frags = parity_frags;
    }

    return client.create_auth_token(auth_params)
        .then(() => client.bucket.read_bucket({ name: bucket }))
        .then(res => client.tier.update_tier({
            name: res.tiering.tiers[0].tier,
            chunk_coder_config: chunk_coder_config
        }))
        .catch(err => {
            console.log('Update tier ERR', err);
            throw err;
        });
}


function setQuotaBucket(server_ip, bucket_name, size, unit) {
    console.log(`Setting quota ${size} ${unit} for bucket ${bucket_name}`);
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(() => client.bucket.update_bucket({
            name: bucket_name,
            quota: {
                size,
                unit //'GIGABYTE', 'TERABYTE', 'PETABYTE'
            }
        }))
        .catch(err => {
            console.log(`${server_ip} FAILED setting quota bucket `, err);
            throw err;
        });
}

function disableQuotaBucket(server_ip, bucket_name) {
    console.log('Disabling quota bucket');
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(() => client.bucket.update_bucket({
            name: bucket_name,
            quota: null
        }))
        .catch(err => {
            console.log(`${server_ip} FAILED disable quota bucket `, err);
            throw err;
        });
}

function checkAvailableSpace(server_ip, bucket_name) {
    console.log('Checking available space in bucket ' + bucket_name);
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(() => client.system.read_system({}))
        .then(res => {
            let buckets = res.buckets;
            let indexBucket = buckets.findIndex(values => values.name === bucket_name);
            let space = buckets[indexBucket].data.free;
            console.log('Available space in bucket ' + bucket_name + ' is ' + space);
            return space;
        })
        .catch(err => {
            console.log(`${server_ip} FAILED to check bucket size`, err);
            throw err;
        });
}

function setSpillover(server_ip, bucket_name, pool) {
    console.log('Setting spillover ' + pool + ' for bucket ' + bucket_name);
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(() => client.bucket.update_bucket({
            name: bucket_name,
            spillover: pool
        }))
        .catch(err => {
            console.log('Failed to set spillover ' + pool + ' for bucket ' + bucket_name + err);
            throw err;
        });
}
//Attaching bucket to the pool with spread data placement
function editBucketDataPlacement(pool, bucket_name, server_ip) {
    console.log('Getting tier for bucket ' + bucket_name);
    let tier;
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(() => client.system.read_system({}))
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
            console.log('Failed to set data placement for bucket ' + bucket_name + error);
            throw error;
        });
}

//checking that bucket with enable or disable spillover
function checkIsSpilloverHasStatus(bucket_name, status, server_ip) {
    console.log('Checking for spillover status ' + status + ' for bucket ' + bucket_name);
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(() => client.system.read_system({}))
        .then(res => {
            let buckets = res.buckets;
            let indexBucket = buckets.findIndex(values => values.name === bucket_name);
            let spilloverPool = res.buckets[indexBucket].spillover;
            if ((status) && (spilloverPool !== null)) {
                console.log('Spillover for bucket ' + bucket_name + ' enabled and uses ' + spilloverPool);
            } else if ((!status) && (spilloverPool === null)) {
                console.log('Spillover for bucket ' + bucket_name + ' disabled ');
            }
        })
        .catch(error => {
            console.log('Failed to check spillover for bucket ' + bucket_name + error);
            throw error;
        });
}

function getInternalStoragePool(server_ip) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(() => client.system.read_system({}))
        .then(system => {
            for (let i = 0; i < system.pools.length; i++) {
                if (system.pools[i].resource_type === 'INTERNAL') {
                    return system.pools[i].name;
                }
            }
        });
}
exports.listBuckets = listBuckets;
exports.createBucket = createBucket;
exports.deleteBucket = deleteBucket;
exports.changeTierSetting = changeTierSetting;
exports.setQuotaBucket = setQuotaBucket;
exports.setSpillover = setSpillover;
exports.disableQuotaBucket = disableQuotaBucket;
exports.checkAvailableSpace = checkAvailableSpace;
exports.editBucketDataPlacement = editBucketDataPlacement;
exports.checkIsSpilloverHasStatus = checkIsSpilloverHasStatus;
exports.getInternalStoragePool = getInternalStoragePool;
