/* Copyright (C) 2020 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const SensitiveString = require('../util/sensitive_string');
// const { S3Error } = require('../endpoint/s3/s3_errors');

/**
 * @implements {nb.BucketSpace}
 */
class BucketSpaceS3 {

    constructor({ s3_params }) {
        this.s3 = new AWS.S3(s3_params);
    }

    ////////////
    // BUCKET //
    ////////////

    async list_buckets() {
        try {
            console.log(`bss3: list_buckets`);
            const res = await this.s3.listBuckets().promise();
            const buckets = res.Buckets.map(b => ({ name: new SensitiveString(b.Name) }));
            return { buckets };
        } catch (err) {
            this._translate_error_code(err);
            throw err;
        }
    }

    async read_bucket(params) {
        try {
            const { name } = params;
            console.log(`bss3: read_bucket ${name}`);
            await this.s3.headBucket({ Bucket: name }).promise();
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
            this._translate_error_code(err);
            throw err;
        }
    }

    async create_bucket(params) {
        try {
            const { name } = params;
            console.log(`bss3: create_bucket ${name}`);
            await this.s3.createBucket({ Bucket: name }).promise();
        } catch (err) {
            this._translate_error_code(err);
            throw err;
        }
    }

    async delete_bucket(params) {
        try {
            const { name } = params;
            console.log(`bss3: delete_fs_bucket ${name}`);
            await this.s3.deleteBucket({ Bucket: name }).promise();
        } catch (err) {
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
