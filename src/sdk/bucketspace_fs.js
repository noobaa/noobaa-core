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
const BucketSpaceSimpleFS = require('./bucketspace_simple_fs');
const _ = require('lodash');
const util = require('util');

const dbg = require('../util/debug_module')(__filename);

const VALID_BUCKET_NAME_REGEXP =
    /^(([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/;
const ACCOUNT_PATH = 'accounts';
const BUCKET_PATH = 'buckets';


//TODO:  dup from namespace_fs - need to handle and not dup code

/**
 * @param {nb.ObjectSDK} object_sdk 
 * @returns {nb.NativeFSContext}
 */
function prepare_fs_context(object_sdk) {
    const fs_context = object_sdk?.requesting_account?.nsfs_account_config;
    if (!fs_context) throw new RpcError('UNAUTHORIZED', 'nsfs_account_config is missing');
    fs_context.warn_threshold_ms = config.NSFS_WARN_THRESHOLD_MS;
    // TODO: 
    //fs_context.backend = this.fs_backend || '';
    //if (this.stats) fs_context.report_fs_stats = this.stats.update_fs_stats;
    return fs_context;
}
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


class BucketSpaceFS extends BucketSpaceSimpleFS {
    constructor({config_root}) {
        super({ fs_root: ''});
        this.fs_root = '';
        this.iam_dir = path.join(config_root, ACCOUNT_PATH);
        this.bucket_schema_dir = path.join(config_root, BUCKET_PATH);
        this.config_root = config_root;
        this.fs_context = {
            uid: process.getuid(),
            gid: process.getgid(),
            warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
        };
    }

    _get_bucket_config_path(bucket_name) {
       return path.join(this.bucket_schema_dir, bucket_name + '.json');
    }

    _get_account_config_path(access_key) {
        return path.join(this.iam_dir, access_key + '.json');
    }

    _translate_object_error_codes(err) {
        if (err.rpc_code) return err;
        if (err.code === 'ENOENT') err.rpc_code = 'NO_SUCH_BUCKET';
        if (err.code === 'EEXIST') err.rpc_code = 'BUCKET_ALREADY_EXISTS';
        if (err.code === 'EPERM' || err.code === 'EACCES') err.rpc_code = 'UNAUTHORIZED';
        if (err.code === 'IO_STREAM_ITEM_TIMEOUT') err.rpc_code = 'IO_STREAM_ITEM_TIMEOUT';
        if (err.code === 'INTERNAL_ERROR') err.rpc_code = 'INTERNAL_ERROR';
        return err;
    }

    async read_account_by_access_key({ access_key }) {
        try {
            if (!access_key) throw new Error('no access key');
            const iam_path = this._get_account_config_path(access_key);
            const { data } = await nb_native().fs.readFile(this.fs_context, iam_path);
            const account = JSON.parse(data.toString());
            account.name = new SensitiveString(account.name);
            account.email = new SensitiveString(account.email);
            for (const k of account.access_keys) {
                k.access_key = new SensitiveString(k.access_key);
                k.secret_key = new SensitiveString(k.secret_key);
            }
            return account;
        } catch (err) {
            dbg.error('BucketSpaceFS.read_account_by_access_key: failed with error', err);
            throw new RpcError('NO_SUCH_ACCOUNT', `Account with access_key not found`, err);
        }
    }

    async read_bucket_sdk_info({ name }) {
        try {
            const bucket_config_path = this._get_bucket_config_path(name);
            dbg.log0('BucketSpaceFS.read_bucket_sdk_info: bucket_config_path', bucket_config_path);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            const is_valid = await this.check_bucket_config(bucket);
            if (!is_valid) {
                console.warn('BucketSpaceFS: one or more bucket config check is failed for bucket : ', name);
            }
            const nsr = {
                resource: {
                    fs_root_path: this.fs_root,
                },
                path: bucket.path
            };
            bucket.namespace = {
                read_resources: [nsr],
                write_resource: nsr,
                should_create_underlying_storage: bucket.should_create_underlying_storage,
            };

            bucket.bucket_info = {
                versioning: bucket.versioning
            };

            bucket.system_owner = new SensitiveString(bucket.system_owner);
            bucket.bucket_owner = new SensitiveString(bucket.bucket_owner);
            return bucket;
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async check_bucket_config(bucket) {
        const bucket_storage_path = path.join(this.fs_root, bucket.path);
        const bucket_dir_stat = await nb_native().fs.stat(this.fs_context, bucket_storage_path);
        if (!bucket_dir_stat) {
            return false;
        }
        //TODO: Bucket owner check
        return true;
    }


    ////////////
    // BUCKET //
    ////////////

    async list_buckets(object_sdk) {
        try {
            const entries = await nb_native().fs.readdir(this.fs_context, this.bucket_schema_dir);
            const bucket_config_files = entries.filter(entree => !isDirectory(entree) && entree.name.endsWith('.json'));
            //TODO : we need to add pagination support to list buckets for more than 1000 buckets.
            let buckets = await P.map(bucket_config_files, bucket_config_file => this.get_bucket_name(bucket_config_file.name));
            buckets = buckets.filter(bucket => bucket.name.unwrap());
            return this.validate_bucket_access(buckets, object_sdk);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('BucketSpaceFS: root dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw this._translate_object_error_codes(err);
        }
    }

    async validate_bucket_access(buckets, object_sdk) {
        const has_access_buckets = (await P.all(_.map(
            buckets,
            async bucket => {
                const ns = await object_sdk.read_bucket_sdk_namespace_info(bucket.name.unwrap());
                const has_access_to_bucket = object_sdk.is_nsfs_bucket(ns) ?
                    await this._has_access_to_nsfs_dir(ns, object_sdk) : false;
                return has_access_to_bucket && bucket;
            }))).filter(bucket => bucket);
            return { buckets: has_access_buckets };
    }

    async _has_access_to_nsfs_dir(ns, object_sdk) {
        const account = object_sdk.requesting_account;
        dbg.log0('_has_access_to_nsfs_dir: nsr: ', ns, 'account.nsfs_account_config: ', account && account.nsfs_account_config);
        // nsfs bucket
        if (!account || !account.nsfs_account_config || _.isUndefined(account.nsfs_account_config.uid) ||
            _.isUndefined(account.nsfs_account_config.gid)) return false;
        try {
            dbg.log0('_has_access_to_nsfs_dir: checking access:', ns.write_resource, account.nsfs_account_config.uid, account.nsfs_account_config.gid);
            await nb_native().fs.checkAccess({
                uid: account.nsfs_account_config.uid,
                gid: account.nsfs_account_config.gid,
                backend: ns.write_resource.resource.fs_backend,
                warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
            }, path.join(ns.write_resource.resource.fs_root_path, ns.write_resource.path || ''));

            return true;
        } catch (err) {
            dbg.log0('_has_access_to_nsfs_dir: failed', err);
            if (err.code === 'ENOENT' || err.code === 'EACCES' || (err.code === 'EPERM' && err.message === 'Operation not permitted')) return false;
            throw err;
        }
    }

    async get_bucket_name(bucket_config_file_name) {
        const bucket_path = path.join(this.bucket_schema_dir, bucket_config_file_name);
        const { data } = await nb_native().fs.readFile(this.fs_context, bucket_path);
        const bucket = JSON.parse(data.toString());
        return { name: new SensitiveString(bucket.name) };
    }

    async read_bucket(params) {
        return this.read_bucket_sdk_info(params);
    }

    async create_bucket(params, sdk) {
        if (!sdk.requesting_account.nsfs_account_config || !sdk.requesting_account.nsfs_account_config.new_buckets_path) {
            throw new RpcError('MISSING_NSFS_ACCOUNT_CONFIGURATION');
        }
        this.validate_bucket_creation(params);
        const { name } = params;
        const bucket_config_path = this._get_bucket_config_path(name);
        const bucket_path = path.join(sdk.requesting_account.nsfs_account_config.new_buckets_path, name);
        const bucket_storage_path = path.join(this.fs_root, sdk.requesting_account.nsfs_account_config.new_buckets_path, name);

        dbg.log0(`BucketSpaceFS.create_bucket 
            requesting_account=${util.inspect(sdk.requesting_account)},
            bucket_config_path=${bucket_config_path},
            bucket_storage_path=${bucket_storage_path}`);

        // create bucket configuration file
        const bucket = this.new_bucket_defaults(params.name, sdk.requesting_account.email,
            sdk.requesting_account._id, params.tag, params.lock_enabled);
        bucket.path = bucket_path;
        bucket.should_create_underlying_storage = true;
        bucket.force_md5_etag = params.force_md5_etag;
        bucket.bucket_owner = sdk.requesting_account.email;
        bucket.creation_date = new Date().toISOString();
        const create_bucket = JSON.stringify(bucket);

        // TODO: handle both bucket config json and directory creation atomically 
        try {
            await nb_native().fs.stat(this.fs_context, bucket_config_path);
            throw new RpcError('BUCKET_ALREADY_EXISTS', 'bucket configuration file already exists');
        } catch (err) {
            if (err.code !== 'ENOENT') throw this._translate_object_error_codes(err);
        }

        await nb_native().fs.writeFile(
            this.fs_context,
            bucket_config_path,
            Buffer.from(create_bucket), {
                mode: this.get_umasked_mode(config.BASE_MODE_FILE)
            }
        );

        // create bucket's underlying storage directory
        try {
            const fs_context = prepare_fs_context(sdk);
            // eslint-disable-next-line no-bitwise
            const unmask_mode = config.BASE_MODE_DIR & ~config.NSFS_UMASK;
            await nb_native().fs.mkdir(fs_context, bucket_storage_path, unmask_mode);
        } catch (err) {
            dbg.error('BucketSpaceFS: create_bucket could not create underlying directory - nsfs, deleting bucket', err);
            await nb_native().fs.unlink(this.fs_context, bucket_config_path);
            throw this._translate_object_error_codes(err);
        }
    }

    get_umasked_mode(mode) {
        // eslint-disable-next-line no-bitwise
        return mode & ~config.NSFS_UMASK;
    }


    new_bucket_defaults(name, email, owner_account_id, tag, lock_enabled) {
        return {
            name: name,
            tag: js_utils.default_value(tag, ''),
            owner_account: owner_account_id,
            system_owner: new SensitiveString(email),
            bucket_owner: new SensitiveString(email),
            versioning: config.NSFS_VERSIONING_ENABLED && lock_enabled ? 'ENABLED' : 'DISABLED',
            object_lock_configuration: config.WORM_ENABLED ? {
                object_lock_enabled: lock_enabled ? 'Enabled' : 'Disabled',
            } : undefined,
        };
    }

    async delete_bucket(params, object_sdk) {
        try {
            const { name } = params;
            const namespace_bucket_config = await object_sdk.read_bucket_sdk_namespace_info(params.name);
            dbg.log1('BucketSpaceFS.delete_bucket: namespace_bucket_config', namespace_bucket_config);
            if (namespace_bucket_config && namespace_bucket_config.should_create_underlying_storage) {
                const ns = await object_sdk._get_bucket_namespace(params.name);
                // delete underlying storage = the directory which represents the bucket
                dbg.log1('BucketSpaceFS.delete_bucket: deleting uls', this.fs_root, namespace_bucket_config.write_resource.path);
                await ns.delete_uls({
                    name,
                    full_path: path.join(this.fs_root, namespace_bucket_config.write_resource.path) // includes write_resource.path + bucket name (s3 flow)
                }, object_sdk);
            }
            const bucket_path = this._get_bucket_config_path(name);
            dbg.log1(`BucketSpaceFS: delete_fs_bucket ${bucket_path}`);

            // delete bucket config json file
            await nb_native().fs.unlink(this.fs_context, bucket_path);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('BucketSpaceFS: root dir not found', err);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw this._translate_object_error_codes(err);
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

    async set_bucket_versioning(params, object_sdk) {
        try {
            const ns = await object_sdk._get_bucket_namespace(params.name);
            await ns.set_bucket_versioning(params.versioning, object_sdk);
            const { name, versioning } = params;
            dbg.log0('BucketSpaceFS.put_bucket_policy: Bucket name, policy', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            bucket.versioning = versioning;
            const update_bucket = JSON.stringify(bucket);
            await nb_native().fs.writeFile(
                this.fs_context,
                bucket_config_path,
                Buffer.from(update_bucket), {
                    mode: this.get_umasked_mode(config.BASE_MODE_FILE)
                }
            );
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
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
        try {
            const { name, encryption } = params;
            dbg.log0('BucketSpaceFS.put_bucket_encryption: Bucket name, encryption', name, encryption);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            bucket.encryption = encryption;
            const update_bucket = JSON.stringify(bucket);
            await nb_native().fs.writeFile(
                this.fs_context,
                bucket_config_path,
                Buffer.from(update_bucket), {
                    mode: this.get_umasked_mode(config.BASE_MODE_FILE)
                }
            );
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async get_bucket_encryption(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_encryption: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            return bucket.encryption;
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async delete_bucket_encryption(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_encryption: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            bucket.encryption = undefined;
            const update_bucket = JSON.stringify(bucket);
            await nb_native().fs.writeFile(
                this.fs_context,
                bucket_config_path,
                Buffer.from(update_bucket), {
                    mode: this.get_umasked_mode(config.BASE_MODE_FILE)
                }
            );
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    ////////////////////
    // BUCKET WEBSITE //
    ////////////////////

    async put_bucket_website(params) {
        try {
            const { name, website } = params;
            dbg.log0('BucketSpaceFS.put_bucket_website: Bucket name, website', name, website);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            bucket.website = website;
            const update_bucket = JSON.stringify(bucket);
            await nb_native().fs.writeFile(
                this.fs_context,
                bucket_config_path,
                Buffer.from(update_bucket), {
                    mode: this.get_umasked_mode(config.BASE_MODE_FILE)
                }
            );
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async delete_bucket_website(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_website: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            bucket.website = undefined;
            const update_bucket = JSON.stringify(bucket);
            await nb_native().fs.writeFile(
                this.fs_context,
                bucket_config_path,
                Buffer.from(update_bucket), {
                    mode: this.get_umasked_mode(config.BASE_MODE_FILE)
                }
            );
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async get_bucket_website(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_website: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            return bucket.website;
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    ////////////////////
    // BUCKET POLICY  //
    ////////////////////

    async put_bucket_policy(params) {
        try {
            const { name, policy } = params;
            dbg.log0('BucketSpaceFS.put_bucket_policy: Bucket name, policy', name, policy);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            bucket.s3_policy = policy;
            const update_bucket = JSON.stringify(bucket);
            await nb_native().fs.writeFile(
                this.fs_context,
                bucket_config_path,
                Buffer.from(update_bucket), {
                    mode: this.get_umasked_mode(config.BASE_MODE_FILE)
                }
            );
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async delete_bucket_policy(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_policy: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            bucket.s3_policy = undefined;
            const update_bucket = JSON.stringify(bucket);
            await nb_native().fs.writeFile(
                this.fs_context,
                bucket_config_path,
                Buffer.from(update_bucket), {
                    mode: this.get_umasked_mode(config.BASE_MODE_FILE)
                }
            );
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
    }

    async get_bucket_policy(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_policy: Bucket name', name);
            const bucket_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_path);
            const bucket = JSON.parse(data.toString());
            dbg.log0('BucketSpaceFS.get_bucket_policy: policy', bucket.s3_policy);
            return {
                policy: bucket.s3_policy
            };
        } catch (err) {
            throw this._translate_object_error_codes(err);
        }
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
