/* Copyright (C) 2016 NooBaa */
'use strict';

const api = require('../../api');
const auth_params = {
    email: 'demo@noobaa.com',
    password: 'DeMo1',
    system: 'demo'
};

class BucketFunctions {

    constructor(server_ip, report) {
        this._rpc = api.new_rpc('wss://' + server_ip + ':8443');
        this._client = this._rpc.new_client({});
        this._report = report;
    }

    async report_success(params) {
        if (this._report) {
            await this._report.success(params);
        }
    }

    async report_fail(params) {
        if (this._report) {
            await this._report.fail(params);
        }
    }

    async listBuckets(server_ip) {
        await this._client.create_auth_token(auth_params);
        try {
            await this._client.bucket.list_buckets();
            await this.report_success(`List_Bucket`);
        } catch (err) {
            await this.report_fail(`List_Bucket`);
            console.log(`${server_ip} FAILED to get bucket list`, err);
            throw err;
        }
    }

    async createBucket(server_ip, name) {
        await this._client.create_auth_token(auth_params);
        try {
            await this._client.bucket.create_bucket({ name });
            await this.report_success(`Create_Bucket`);
        } catch (err) {
            await this.report_fail(`Create_Bucket`);
            console.log('Create bucket ERR', err);
            throw err;
        }
    }

    async deleteBucket(server_ip, name) {
        await this._client.create_auth_token(auth_params);
        try {
            await this._client.bucket.delete_bucket({ name });
            await this.report_success(`Delete_Bucket`);
        } catch (err) {
            await this.report_fail(`Delete_Bucket`);
            console.log('Delete bucket ERR', err);
            throw err;
        }
    }

    async changeTierSetting(server_ip, bucket, data_frags, parity_frags, replicas) {
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
            await this._client.create_auth_token(auth_params);
            const read_bucket = await this._client.bucket.read_bucket({ name: bucket });
            await this._client.tier.update_tier({
                name: read_bucket.tiering.tiers[0].tier,
                chunk_coder_config: chunk_coder_config
            });
            await this.report_success(`Update_Tier`);
        } catch (err) {
            await this.report_fail(`Update_Tier`);
            console.log('Update tier ERR', err);
            throw err;
        }
    }


    async setQuotaBucket(server_ip, bucket_name, size, unit) {
        console.log(`Setting quota ${size} ${unit} for bucket ${bucket_name}`);
        await this._client.create_auth_token(auth_params);
        try {
            await this._client.bucket.update_bucket({
                name: bucket_name,
                quota: {
                    size,
                    unit //'GIGABYTE', 'TERABYTE', 'PETABYTE'
                }
            });
            await this.report_success(`Set_Quota_Bucket`);
        } catch (err) {
            await this.report_fail(`Set_Quota_Bucket`);
            console.log(`${server_ip} FAILED setting quota bucket `, err);
            throw err;
        }
    }

    async disableQuotaBucket(server_ip, bucket_name) {
        console.log('Disabling quota bucket');
        await this._client.create_auth_token(auth_params);
        try {
            await this._client.bucket.update_bucket({
                name: bucket_name,
                quota: null
            });
            await this.report_success(`Disable_Quota_Bucket`);
        } catch (err) {
            await this.report_fail(`Disable_Quota_Bucket`);
            console.log(`${server_ip} FAILED disable quota bucket `, err);
            throw err;
        }
    }

    async checkAvailableSpace(server_ip, bucket_name) {
        console.log('Checking available space in bucket ' + bucket_name);
        try {
            await this._client.create_auth_token(auth_params);
            const system_info = await this._client.system.read_system({});
            const buckets = system_info.buckets;
            const indexBucket = buckets.findIndex(values => values.name === bucket_name);
            const space = buckets[indexBucket].data.free;
            console.log('Available space in bucket ' + bucket_name + ' is ' + space);
            return space;
        } catch (err) {
            console.log(`${server_ip} FAILED to check bucket size`, err);
            throw err;
        }
    }

    async setSpillover(server_ip, bucket_name, pool) {
        console.log('Setting spillover ' + pool + ' for bucket ' + bucket_name);
        await this._client.create_auth_token(auth_params);
        try {
            await this._client.bucket.update_bucket({
                name: bucket_name,
                spillover: pool
            });
            await this.report_success(`Set_Spillover`);
        } catch (err) {
            await this.report_fail(`Set_Spillover`);
            console.log('Failed to set spillover ' + pool + ' for bucket ' + bucket_name + err);
            throw err;
        }
    }

    //Attaching bucket to the pool with spread data placement
    async editBucketDataPlacement(pool, bucket_name, server_ip) {
        console.log('Getting tier for bucket ' + bucket_name);
        await this._client.create_auth_token(auth_params);
        const system_info = await this._client.system.read_system({});
        const buckets = system_info.buckets;
        const indexBucket = buckets.findIndex(values => values.name === bucket_name);
        const tier = system_info.buckets[indexBucket].tiering.name;
        console.log('Editing bucket data placement to pool ' + pool);
        try {
            await this._client.tier.update_tier({
                attached_pools: [pool],
                data_placement: 'SPREAD',
                name: tier
            });
            await this.report_success(`Change_DataPlacement`);
        } catch (err) {
            await this.report_fail(`Change_DataPlacement`);
            console.log('Failed to set data placement for bucket ' + bucket_name + err);
            throw err;
        }
    }

    //checking that bucket with enable or disable spillover
    async checkIsSpilloverHasStatus(bucket_name, status, server_ip) {
        console.log('Checking for spillover status ' + status + ' for bucket ' + bucket_name);
        await this._client.create_auth_token(auth_params);
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

    async getInternalStoragePool(server_ip) {
        await this._client.create_auth_token(auth_params);
        const system_info = await this._client.system.read_system({});
        for (let i = 0; i < system_info.pools.length; i++) {
            if (system_info.pools[i].resource_type === 'INTERNAL') {
                return system_info.pools[i].name;
            }
        }
    }

    async createNamespaceBucket(name, namespace) {
        console.log('Creating namespace bucket with namespace ' + namespace);
        await this._client.create_auth_token(auth_params);
        try {
            await this._client.bucket.create_bucket({
                name,
                namespace: {
                    read_resources: [namespace],
                    write_resource: namespace
                }
            });
            await this.report_success(`Create_Namespace_Bucket`);
        } catch (err) {
            await this.report_fail(`Create_Namespace_Bucket`);
            throw new Error('Failed to create Namespace bucket ', err);
        }
    }

    async updateNamesapceBucket(name, read_resources = [], write_resource) {
        console.log(`updating bucket: ${name}, read_resources: ${read_resources}, write_resource: ${write_resource}`);
        await this._client.create_auth_token(auth_params);
        try {
            await this._client.bucket.update_bucket({
                name,
                namespace: {
                    read_resources,
                    write_resource
                }
            });
            await this.report_success(`Update_Namespace_Bucket`);
        } catch (err) {
            await this.report_fail(`Update_Namespace_Bucket`);
            throw new Error('Failed to update Namespace bucket ', err);
        }
    }

}

exports.BucketFunctions = BucketFunctions;
