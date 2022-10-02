/* Copyright (C) 2020 NooBaa */
'use strict';

const path = require('path');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const SensitiveString = require('../util/sensitive_string');
const { S3Error } = require('../endpoint/s3/s3_errors');

//TODO:  dup from namespace_fs - need to handle and not dup code
function isDirectory(ent) {
    if (!ent) throw new Error('isDirectory: ent is empty');
    if (ent.mode) {
        // eslint-disable-next-line no-bitwise
        return (((ent.mode) & nb_native().fs.S_IFMT) === nb_native().fs.S_IFDIR);
    } else if (ent.type) {
        return ent.type === nb_native().fs.DT_DIR;
    } else {
        throw new Error(`isDirectory: ent ${ent} is not supported`);
    }
}

/**
 * @implements {nb.BucketSpace}
 */
class BucketSpaceFS {

    constructor({ fs_root }) {
        this.fs_root = fs_root;
        this.fs_context = {
            uid: process.getuid(),
            gid: process.getgid(),
            backend: '',
            warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
        };
    }

    ////////////
    // BUCKET //
    ////////////

    async list_buckets() {
        try {
            const entries = await nb_native().fs.readdir(this.fs_context, this.fs_root);
            const dirs_only = entries.filter(entree => isDirectory(entree));
            const buckets = dirs_only.map(e => ({ name: new SensitiveString(e.name) }));
            return { buckets };
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('BucketSpaceFS: root dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw err;
        }
    }

    async read_bucket(params) {
        try {
            const { name } = params;
            const bucket_path = path.join(this.fs_root, name);
            console.log(`BucketSpaceFS: read_bucket ${bucket_path}`);
            const bucket_dir_stat = await nb_native().fs.stat(this.fs_context, bucket_path);
            if (!isDirectory(bucket_dir_stat)) {
                throw new S3Error(S3Error.NoSuchBucket);
            }
            const owner_account = {
                email: new SensitiveString('nsfs@noobaa.io'),
                id: '12345678',
            };
            const nsr = {
                resource: 'nsfs',
                path: '',
            };
            return {
                name,
                owner_account,
                namespace: {
                    read_resources: [nsr],
                    write_resource: nsr,
                    should_create_underlying_storage: true,
                },
                tiering: { name, tiers: [] },
                usage_by_pool: { last_update: 0, pools: [] },
                num_objects: { last_update: 0, value: 0 },
                storage: { last_update: 0, values: {} },
                data: { last_update: 0 },
                host_tolerance: undefined,
                node_tolerance: undefined,
                writable: true,
                tag: '',
                bucket_type: 'NAMESPACE',
                versioning: 'DISABLED',
                mode: 'OPTIMAL',
                undeletable: 'NOT_EMPTY',
            };
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('BucketSpaceFS: bucket dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw err;
        }
    }

    async create_bucket(params) {
        try {
            const { name } = params;
            const bucket_path = path.join(this.fs_root, name);
            console.log(`BucketSpaceFS: create_bucket ${bucket_path}`);
            // eslint-disable-next-line no-bitwise
            const unmask_mode = config.BASE_MODE_DIR & ~config.NSFS_UMASK;
            await nb_native().fs.mkdir(this.fs_context, bucket_path, unmask_mode);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('BucketSpaceFS: root dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw err;
        }
    }

    async delete_bucket(params) {
        try {
            const { name } = params;
            const bucket_path = path.join(this.fs_root, name);
            console.log(`BucketSpaceFS: delete_fs_bucket ${bucket_path}`);
            await nb_native().fs.rmdir(this.fs_context, bucket_path);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('BucketSpaceFS: root dir not found', err);
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
