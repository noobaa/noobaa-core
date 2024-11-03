/* Copyright (C) 2020 NooBaa */
'use strict';

const SensitiveString = require('../util/sensitive_string');
// const { S3Error } = require('../endpoint/s3/s3_errors');
const noobaa_s3_client = require('../sdk/noobaa_s3_client/noobaa_s3_client');

/**
 * @implements {nb.BucketSpace}
 */
class BucketSpaceS3 {

    constructor({ s3_params }) {
        this.s3 = noobaa_s3_client.get_s3_client_v3_params(s3_params);
    }

    async read_account_by_access_key({ access_key }) {
        return {};
    }

    async read_bucket_sdk_info({ name }) {
        return {};
    }


    ////////////
    // BUCKET //
    ////////////

    async list_buckets(params) {
        try {
            console.log(`bss3: list_buckets`);
            const res = await this.s3.listBuckets({});
            const buckets = res.Buckets ?? [];
            const buckets_with_name_change = buckets.map(b => ({ name: new SensitiveString(b.Name) }));
            return { buckets_with_name_change };
        } catch (err) {
            noobaa_s3_client.fix_error_object(err);
            this._translate_error_code(err);
            throw err;
        }
    }

    async read_bucket(params) {
        try {
            const { name } = params;
            console.log(`bss3: read_bucket ${name}`);
            await this.s3.headBucket({ Bucket: name });
            return {
                name,
                bucket_type: 'NAMESPACE',
                versioning: 'DISABLED',
                namespace: { read_resources: [], write_resources: [] },
                tiering: { name, tiers: [] },
                usage_by_pool: { last_update: 0, pools: [] },
                storage: { last_update: 0, values: {} },
                data: { last_update: 0 },
                num_objects: { last_update: 0, value: 0 },
                host_tolerance: 0,
                node_tolerance: 0,
                writable: true,
                mode: 'OPTIMAL',
                undeletable: 'NOT_EMPTY',
            };
        } catch (err) {
            noobaa_s3_client.fix_error_object(err);
            this._translate_error_code(err);
            throw err;
        }
    }

    async create_bucket(params) {
        try {
            const { name } = params;
            console.log(`bss3: create_bucket ${name}`);
            await this.s3.createBucket({ Bucket: name });
        } catch (err) {
            noobaa_s3_client.fix_error_object(err);
            this._translate_error_code(err);
            throw err;
        }
    }

    async delete_bucket(params) {
        try {
            const { name } = params;
            console.log(`bss3: delete_fs_bucket ${name}`);
            await this.s3.deleteBucket({ Bucket: name });
        } catch (err) {
            noobaa_s3_client.fix_error_object(err);
            this._translate_error_code(err);
            throw err;
        }
    }

    //////////////////////
    // BUCKET LIFECYCLE //
    //////////////////////

    async get_bucket_lifecycle_configuration_rules(params) {
        // TODO
    }

    async set_bucket_lifecycle_configuration_rules(params) {
        // TODO
    }

    async delete_bucket_lifecycle(params) {
        // TODO
    }

    ///////////////////////
    // BUCKET VERSIONING //
    ///////////////////////

    async set_bucket_versioning(params) {
        // TODO
    }

    ////////////////////
    // BUCKET TAGGING //
    ////////////////////

    async put_bucket_tagging(params) {
        // TODO
    }

    async delete_bucket_tagging(params) {
        // TODO
    }

    async get_bucket_tagging(params) {
        // TODO
    }

    ///////////////////////
    // BUCKET ENCRYPTION //
    ///////////////////////

    async put_bucket_encryption(params) {
        // TODO
    }

    async get_bucket_encryption(params) {
        // TODO
    }

    async delete_bucket_encryption(params) {
        // TODO
    }

    ////////////////////
    // BUCKET WEBSITE //
    ////////////////////

    async put_bucket_website(params) {
        // TODO
    }

    async delete_bucket_website(params) {
        // TODO
    }

    async get_bucket_website(params) {
        // TODO
    }

    ////////////////////
    // BUCKET POLICY  //
    ////////////////////

    async put_bucket_policy(params) {
        // TODO
    }

    async delete_bucket_policy(params) {
        // TODO
    }

    async get_bucket_policy(params) {
        // TODO
    }

    /////////////////////////
    // DEFAULT OBJECT LOCK //
    /////////////////////////

    async get_object_lock_configuration(params, object_sdk) {
        // TODO
    }

    async put_object_lock_configuration(params, object_sdk) {
        // TODO
    }


    _translate_error_code(err) {
        // TODO
        if (err.code === 'NoSuchBucket') err.rpc_code = 'NO_SUCH_BUCKET';
        return err;
    }
}

module.exports = BucketSpaceS3;
