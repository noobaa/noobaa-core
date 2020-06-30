/* Copyright (C) 2016 NooBaa */
'use strict';

class BucketFunctions {

    constructor(client) {
        this._client = client;
    }

    async listBuckets() {
        try {
            await this._client.bucket.list_buckets();
        } catch (err) {
            console.error(`FAILED to get bucket list`, err);
            throw err;
        }
    }

    async createBucket(name) {
        try {
            const bucket = await this._client.bucket.create_bucket({ name });
            return bucket;
        } catch (err) {
            console.error('Create bucket ERR', err);
            throw err;
        }
    }

    async deleteBucket(name) {
        try {
            await this._client.bucket.delete_bucket({ name });
        } catch (err) {
            console.error('Delete bucket ERR', err);
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
            console.error('Update tier ERR', err);
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
            console.error(`FAILED setting quota bucket `, err);
            throw err;
        }
    }

    async disableQuotaBucket(bucket_name) {
        console.log('Disabling quota bucket');
        try {
            await this._client.bucket.update_bucket({
                name: bucket_name,
                quota: null
            });
        } catch (err) {
            console.error(`FAILED disable quota bucket `, err);
            throw err;
        }
    }

    async get_bucket_index(bucket_name) {
        try {
            const system_info = await this._client.system.read_system({});
            const buckets = system_info.buckets;
            const indexBucket = buckets.findIndex(values => values.name.unwrap() === bucket_name);
            return buckets[indexBucket];
        } catch (e) {
            console.error(`Failed to get the bucket "${bucket_name}" index number`, e);
            throw e;
        }
    }

    async checkFreeSpace(bucket_name) {
        console.log(`Checking free space in bucket ${bucket_name}`);
        try {
            const bucket = await this.get_bucket_index(bucket_name);
            const space = bucket.data.free;
            console.log(`Free space in bucket ${bucket_name} is ${space / 1024 / 1024} MB}`);
            return space;
        } catch (err) {
            console.error(`FAILED to check free space in bucket`, err);
            throw err;
        }
    }

    async checkAvailableSpace(bucket_name) {
        console.log(`Checking available space in bucket ${bucket_name}`);
        try {
            const bucket = await this.get_bucket_index(bucket_name);
            const available_space = bucket.data.available_for_upload;
            console.log(`Available space in bucket ${bucket_name} is ${available_space / 1024 / 1024} MB`);
            return available_space;
        } catch (err) {
            console.error(`FAILED to check available space in bucket ${bucket_name}`, err);
            throw err;
        }
    }

    //Attaching bucket to the pool with spread data placement
    async editBucketDataPlacement(pool, bucket_name, data_placement) {
        if (data_placement !== 'SPREAD' && data_placement !== 'MIRROR') {
            throw new Error(`data_placement is ${data_placement} and must be SPREAD or MIRROR`);
        }
        console.log('Getting tier for bucket ' + bucket_name);
        const bucket = await this.get_bucket_index(bucket_name);
        const tier = bucket.tiering.name;
        console.log('Editing bucket data placement to pool ' + pool);
        try {
            await this._client.tier.update_tier({
                attached_pools: [pool],
                data_placement,
                name: tier
            });
        } catch (err) {
            console.error(`Failed to set data placement for bucket ${bucket_name}`, err);
            throw err;
        }
    }

    async createNamespaceBucket(name, namespace, caching) {
        console.log(`Creating namespace bucket ${name} with namespace ${namespace}`);
        try {
            const namespaceConfig = {
                read_resources: [namespace],
                write_resource: namespace,
                caching
            };
            await this._client.bucket.create_bucket({
                name,
                namespace: namespaceConfig
            });
        } catch (e) {
            console.error(`Failed to create Namespace bucket ${name}`, e);
            throw e;
        }
    }

    async updateNamesapceBucket(name, write_resource, read_resources = []) {
        console.log(`updating bucket: ${name}, read_resources: ${read_resources}, write_resource: ${write_resource}`);
        try {
            await this._client.bucket.update_bucket({
                name,
                namespace: {
                    read_resources,
                    write_resource
                }
            });
        } catch (e) {
            console.error('Failed to update Namespace bucket', e);
            throw e;
        }
    }

}

exports.BucketFunctions = BucketFunctions;
