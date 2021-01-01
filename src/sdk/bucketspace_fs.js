/* Copyright (C) 2020 NooBaa */
'use strict';

const fs = require('fs');
const path = require('path');
const SensitiveString = require('../util/sensitive_string');
const { S3Error } = require('../endpoint/s3/s3_errors');

/**
 * @implements {nb.BucketSpace}
 */
class BucketSpaceFS {

    constructor({ fs_root }) {
        this.fs_root = fs_root;
    }

    ////////////
    // BUCKET //
    ////////////

    async list_buckets() {
        try {
            const entries = await fs.promises.readdir(this.fs_root, { withFileTypes: true });
            const dirs_only = entries.filter(e => e.isDirectory());
            const buckets = dirs_only.map(e => ({ name: new SensitiveString(e.name) }));
            return { buckets };
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('nsfs: root dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw err;
        }
    }

    async read_bucket(params) {
        try {
            const { name } = params;
            const bucket_path = path.join(this.fs_root, name);
            console.log(`bsfs: read_bucket ${bucket_path}`);
            const bucket_dir_stat = await fs.promises.stat(bucket_path);
            if (!bucket_dir_stat.isDirectory()) {
                throw new S3Error(S3Error.NoSuchBucket);
            }
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
            if (err.code === 'ENOENT') {
                console.error('bsfs: bucket dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw err;
        }
    }

    async create_bucket(params) {
        try {
            const { name } = params;
            const bucket_path = path.join(this.fs_root, name);
            console.log(`bsfs: create_bucket ${bucket_path}`);
            await fs.promises.mkdir(bucket_path);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('bsfs: root dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw err;
        }
    }

    async delete_bucket(params) {
        try {
            const { name } = params;
            const bucket_path = path.join(this.fs_root, name);
            console.log(`nsfs: delete_fs_bucket ${bucket_path}`);
            await fs.promises.rmdir(bucket_path);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('nsfs: root dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
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
}

module.exports = BucketSpaceFS;
