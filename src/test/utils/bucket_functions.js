/* Copyright (C) 2016 NooBaa */
'use strict';

class BucketFunctions {

    constructor(client) {
        this._client = client;
    }

    async listBuckets(server_ip) {
        try {
            await this._client.bucket.list_buckets();
        } catch (err) {
            console.log(`${server_ip} FAILED to get bucket list`, err);
            throw err;
        }
    }

    async createBucket(name) {
        try {
            let buck = await this._client.bucket.create_bucket({ name });
            return buck;
        } catch (err) {
            console.log('Create bucket ERR', err);
            throw err;
        }
    }

    async deleteBucket(name) {
        try {
            await this._client.bucket.delete_bucket({ name });
        } catch (err) {
            console.log('Delete bucket ERR', err);
            throw err;
        }
    }

    async changeTierSetting(bucket, data_frags, parity_frags, replicas) {
        if (replicas && (data_frags || parity_frags)) {
            throw new Error('Both erasure coding and replicas cannot be set simultaneously ');
        } else if (!replicas && !(data_frags && parity_frags)) {
            throw new Error('Both erasure coding and replicas cannot be empty');
        }

        let chunk_coder_config = {};
        if (replicas) {
            chunk_coder_config.replicas = replicas;
        } else {
            chunk_coder_config.data_frags = data_frags;
            chunk_coder_config.parity_frags = parity_frags;
        }

        try {
            const read_bucket = await this._client.bucket.read_bucket({ name: bucket });
            await this._client.tier.update_tier({
                name: read_bucket.tiering.tiers[0].tier,
                chunk_coder_config: chunk_coder_config
            });
        } catch (err) {
            console.log('Update tier ERR', err);
            throw err;
        }
    }


    async setQuotaBucket(bucket_name, size, unit) {
        console.log(`Setting quota ${size} ${unit} for bucket ${bucket_name}`);
        try {
            await this._client.bucket.update_bucket({
                name: bucket_name,
                quota: {
                    size,
                    unit //'GIGABYTE', 'TERABYTE', 'PETABYTE'
                }
            });
        } catch (err) {
            console.log(`$FAILED setting quota bucket `, err);
            throw err;
        }
    }

    async disableQuotaBucket(server_ip, bucket_name) {
        console.log('Disabling quota bucket');
        try {
            await this._client.bucket.update_bucket({
                name: bucket_name,
                quota: null
            });
        } catch (err) {
            console.log(`${server_ip} FAILED disable quota bucket `, err);
            throw err;
        }
    }

    async checkFreeSpace(bucket_name) {
        console.log('Checking free space in bucket ' + bucket_name);
        try {
            const system_info = await this._client.system.read_system({});
            const buckets = system_info.buckets;
            const indexBucket = buckets.findIndex(values => values.name === bucket_name);
            const space = buckets[indexBucket].data.free;
            console.log(`Free space in bucket ${bucket_name} is ${space / 1024 / 1024} MB}`);
            return space;
        } catch (err) {
            console.log(`FAILED to check free space in bucket`, err);
            throw err;
        }
    }

    async checkAvilableSpace(bucket_name) {
        console.log('Checking avilable space in bucket ' + bucket_name);
        try {
            const system_info = await this._client.system.read_system({});
            const buckets = system_info.buckets;
            const indexBucket = buckets.findIndex(values => values.name === bucket_name);
            const avilable_space = buckets[indexBucket].data.available_for_upload;
            console.log(`Avilable space in bucket ${bucket_name} is ${avilable_space / 1024 / 1024} MB`);
            return avilable_space;
        } catch (err) {
            console.log(`FAILED to check avilable space in bucket`, err);
            throw err;
        }
    }

    async checkSpilloverFreeSpace(bucket_name) {
        console.log('Checking spillover free space in bucket ' + bucket_name);
        try {
            const system_info = await this._client.system.read_system({});
            const buckets = system_info.buckets;
            const indexBucket = buckets.findIndex(values => values.name === bucket_name);
            const spillover_free_space = buckets[indexBucket].data.spillover_free;
            console.log(`Spillover free space in bucket ${bucket_name} is ${spillover_free_space / 1024 / 1024} MB`);
            return spillover_free_space;
        } catch (err) {
            console.log(`FAILED to check spillover free space in bucket`, err);
            throw err;
        }
    }

    async setSpillover(bucket_name, pool) {
        console.log('Setting spillover ' + pool + ' for bucket ' + bucket_name);
        try {
            await this._client.bucket.update_bucket({
                name: bucket_name,
                spillover: pool
            });
        } catch (err) {
            console.log('Failed to set spillover ' + pool + ' for bucket ' + bucket_name + err);
            throw err;
        }
    }

    //Attaching bucket to the pool with spread data placement
    async editBucketDataPlacement(pool, bucket_name, data_placement) {
        if (data_placement !== 'SPREAD' && data_placement !== 'MIRROR') {
            throw new Error(`data_placement is ${data_placement} and must be SPREAD or MIRROR`);
        }
        console.log('Getting tier for bucket ' + bucket_name);
        const system_info = await this._client.system.read_system({});
        const buckets = system_info.buckets;
        const indexBucket = buckets.findIndex(values => values.name === bucket_name);
        const tier = system_info.buckets[indexBucket].tiering.name;
        console.log('Editing bucket data placement to pool ' + pool);
        try {
            await this._client.tier.update_tier({
                attached_pools: [pool],
                data_placement,
                name: tier
            });
        } catch (err) {
            console.log('Failed to set data placement for bucket ' + bucket_name + err);
            throw err;
        }
    }

    //checking that bucket with enable or disable spillover
    async checkIsSpilloverHasStatus(bucket_name, status) {
        console.log('Checking for spillover status ' + status + ' for bucket ' + bucket_name);
        try {
            const system_info = await this._client.system.read_system({});
            const buckets = system_info.buckets;
            const indexBucket = buckets.findIndex(values => values.name === bucket_name);
            const spilloverPool = system_info.buckets[indexBucket].spillover;
            if ((status) && (spilloverPool !== null)) {
                console.log('Spillover for bucket ' + bucket_name + ' enabled and uses ' + spilloverPool);
            } else if ((!status) && (spilloverPool === null)) {
                console.log('Spillover for bucket ' + bucket_name + ' disabled ');
            }
        } catch (err) {
            console.log('Failed to check spillover for bucket ' + bucket_name + err);
            throw err;
        }
    }

    async getInternalStoragePool() {
        const system_info = await this._client.system.read_system({});
        for (let i = 0; i < system_info.pools.length; i++) {
            if (system_info.pools[i].resource_type === 'INTERNAL') {
                return system_info.pools[i].name;
            }
        }
    }

    async createNamespaceBucket(name, namespace) {
        console.log('Creating namespace bucket with namespace ' + namespace);
        try {
            await this._client.bucket.create_bucket({
                name,
                namespace: {
                    read_resources: [namespace],
                    write_resource: namespace
                }
            });
        } catch (err) {
            throw new Error('Failed to create Namespace bucket ', err);
        }
    }

    async updateNamesapceBucket(name, read_resources = [], write_resource) {
        console.log(`updating bucket: ${name}, read_resources: ${read_resources}, write_resource: ${write_resource}`);
        try {
            await this._client.bucket.update_bucket({
                name,
                namespace: {
                    read_resources,
                    write_resource
                }
            });
        } catch (err) {
            throw new Error('Failed to update Namespace bucket ', err);
        }
    }

}

exports.BucketFunctions = BucketFunctions;
