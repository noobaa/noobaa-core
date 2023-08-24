/* Copyright (C) 2020 NooBaa */
'use strict';

const path = require('path');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const SensitiveString = require('../util/sensitive_string');
const { S3Error } = require('../endpoint/s3/s3_errors');
const RpcError = require('../rpc/rpc_error');
const net = require('net');
const js_utils = require('../util/js_utils');
const P = require('../util/promise');
const BucketSpaceFS = require('./bucketspace_fs');

const VALID_BUCKET_NAME_REGEXP =
    /^(([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/;

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


class BucketSpaceMultiFS extends BucketSpaceFS {
    constructor({fs_root, iam_dir, multi_fs_config_dir}) {
        super({fs_root});
        this.fs_root = fs_root;
        this.iam_dir = iam_dir;
        this.multi_fs_config_dir = multi_fs_config_dir;
        this.fs_context = {
            uid: process.getuid(),
            gid: process.getgid(),
            warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
        };
    }

    async read_account_by_access_key({ access_key }) {
        try {
            console.log('GGG read_account_by_access_key', this.iam_dir, access_key);
            if (!access_key) throw new Error('no access key');
            const iam_path = path.join(this.iam_dir, access_key);
            console.log('GGG read_account_by_access_key', access_key, iam_path);
            const { data } = await nb_native().fs.readFile(this.fs_context, iam_path);
            const account = JSON.parse(data.toString());
            account.name = new SensitiveString(account.name);
            account.email = new SensitiveString(account.email);
            for (const k of account.access_keys) {
                k.access_key = new SensitiveString(k.access_key);
                k.secret_key = new SensitiveString(k.secret_key);
            }
            console.log('GGG read_account_by_access_key', access_key, account);
            return account;
        } catch (err) {
            throw new RpcError('NO_SUCH_ACCOUNT', `Account with access_key not foundSSSSS`, err);
        }
    }

    async read_bucket_sdk_info({ name }) {
        const bucket_path = path.join(this.fs_root, name);
        const { data } = await nb_native().fs.readFile(this.fs_context, bucket_path + ".json");
        const bucket = JSON.parse(data.toString());
        bucket.system_owner = new SensitiveString(bucket.system_owner);
        bucket.bucket_owner = new SensitiveString(bucket.bucket_owner);
        return bucket;
    }


    ////////////
    // BUCKET //
    ////////////

    async list_buckets() {
        try {
            const entries = await nb_native().fs.readdir(this.fs_context, this.fs_root);
            const bucket_config_files = entries.filter(entree => !isDirectory(entree));

            let buckets = await P.map(bucket_config_files, bucket_config_file => this.get_bucket_name(bucket_config_file.name));
            buckets = buckets.filter(bucket => bucket.name.unwrap());
            return { buckets };
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('BucketSpaceFS: root dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw err;
        }
    }

    async get_bucket_name(bucket_config_file_name) {
        const bucket_path = path.join(this.fs_root, bucket_config_file_name);
        const { data } = await nb_native().fs.readFile(this.fs_context, bucket_path);
        const bucket = JSON.parse(data.toString());
        return { name: new SensitiveString(bucket.name) };
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

    async create_bucket(params, sdk) {
        try {
            let should_create_underlying_storage = false;
            if (!sdk.requesting_account.nsfs_account_config || !sdk.requesting_account.nsfs_account_config.new_buckets_path) {
                throw new RpcError('MISSING_NSFS_ACCOUNT_CONFIGURATION');
            }
            this.validate_bucket_creation(params);
            const { name } = params;
            const bucket_path = path.join(this.fs_root, name);
            console.log(`BucketSpaceFS: create_bucket ${bucket_path}`);
            // eslint-disable-next-line no-bitwise
            const unmask_mode = config.BASE_MODE_DIR & ~config.NSFS_UMASK;
            await nb_native().fs.mkdir(this.fs_context, bucket_path, unmask_mode);

            // bucket configuration file start
            console.log('creating bucket on default namespace resource', sdk.requesting_account.nsfs_account_config);
            if (!sdk.requesting_account.nsfs_account_config || !sdk.requesting_account.nsfs_account_config.new_buckets_path) {
                throw new RpcError('MISSING_NSFS_ACCOUNT_CONFIGURATION');
            }

            const nsr = {
                resource: {
                    fs_root_path: sdk.nsfs_fs_root,
                },
                path: path.join(sdk.requesting_account.nsfs_account_config.new_buckets_path, params.name)
            };
            should_create_underlying_storage = true;

            const bucket = this.new_bucket_defaults(params.name, sdk.requesting_account._id, params.tag, params.lock_enabled);
            bucket.system_owner = new SensitiveString(sdk.requesting_account.email);
            bucket.bucket_owner = new SensitiveString(sdk.requesting_account.email);
            bucket.namespace = {
                read_resources: [nsr],
                write_resource: nsr,
                should_create_underlying_storage
            };
            bucket.force_md5_etag = params.force_md5_etag;
            const create_bucket = JSON.stringify(bucket);
            await nb_native().fs.writeFile(
                this.fs_context,
                bucket_path + ".json",
                Buffer.from(create_bucket), {
                    mode: this.get_umasked_mode(config.BASE_MODE_FILE)
                }
            );
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('BucketSpaceFS: root dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw err;
        }
    }

    get_umasked_mode(mode) {
        // eslint-disable-next-line no-bitwise
        return mode & ~config.NSFS_UMASK;
    }


    new_bucket_defaults(name, owner_account_id, tag, lock_enabled) {
        return {
            name: name,
            tag: js_utils.default_value(tag, ''),
            owner_account: owner_account_id,
            versioning: config.WORM_ENABLED && lock_enabled ? 'ENABLED' : 'DISABLED',
            object_lock_configuration: config.WORM_ENABLED ? {
                object_lock_enabled: lock_enabled ? 'Enabled' : 'Disabled',
            } : undefined,
        };
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

    validate_bucket_creation(params) {
        if (params.name.length < 3 ||
            params.name.length > 63 ||
            net.isIP(params.name) ||
            !VALID_BUCKET_NAME_REGEXP.test(params.name)) {
            throw new RpcError('INVALID_BUCKET_NAME');
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
        const { name, policy } = params;
        console.log("name, policy GGGGGGGGGG", name, policy);
        const bucket_path = path.join(this.fs_root, name);
        const { data } = await nb_native().fs.readFile(this.fs_context, bucket_path + ".json");
        const bucket = JSON.parse(data.toString());
        bucket.s3_policy = policy;
        const update_bucket = JSON.stringify(bucket);
        await nb_native().fs.writeFile(
            this.fs_context,
            bucket_path + ".json",
            Buffer.from(update_bucket), {
                mode: this.get_umasked_mode(config.BASE_MODE_FILE)
            }
        );
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

module.exports = BucketSpaceMultiFS;
exports.BucketSpaceMultiFS = BucketSpaceMultiFS;
