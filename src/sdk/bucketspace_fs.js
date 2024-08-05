/* Copyright (C) 2020 NooBaa */
'use strict';

const path = require('path');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const SensitiveString = require('../util/sensitive_string');
const { S3Error } = require('../endpoint/s3/s3_errors');
const RpcError = require('../rpc/rpc_error');
const js_utils = require('../util/js_utils');
const P = require('../util/promise');
const BucketSpaceSimpleFS = require('./bucketspace_simple_fs');
const _ = require('lodash');
const util = require('util');
const bucket_policy_utils = require('../endpoint/s3/s3_bucket_policy_utils');
const nsfs_schema_utils = require('../manage_nsfs/nsfs_schema_utils');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();

const mongo_utils = require('../util/mongo_utils');
const { CONFIG_SUBDIRS } = require('../manage_nsfs/manage_nsfs_constants');

const KeysSemaphore = require('../util/keys_semaphore');
const { get_umasked_mode, isDirectory, validate_bucket_creation,
    create_config_file, delete_config_file, get_bucket_tmpdir_full_path, folder_delete,
    update_config_file, entity_enum, translate_error_codes, is_path_exists } = require('../util/native_fs_utils');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;
const { anonymous_access_key } = require('./object_sdk');
const { get_account_by_principal } = require('../manage_nsfs/manage_nsfs_validations');

const dbg = require('../util/debug_module')(__filename);
const bucket_semaphore = new KeysSemaphore(1);



class BucketSpaceFS extends BucketSpaceSimpleFS {
    constructor({config_root}, stats) {
        super({ fs_root: ''});
        this.fs_root = '';
        this.accounts_dir = path.join(config_root, CONFIG_SUBDIRS.ACCOUNTS);
        this.root_accounts_dir = path.join(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS);
        this.access_keys_dir = path.join(config_root, CONFIG_SUBDIRS.ACCESS_KEYS);
        this.bucket_schema_dir = path.join(config_root, CONFIG_SUBDIRS.BUCKETS);
        this.config_root = config_root;
        this.stats = stats;
        this.fs_context = {
            uid: process.getuid(),
            gid: process.getgid(),
            warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
            fs_backend: config.NSFS_NC_CONFIG_DIR_BACKEND,
            report_fs_stats: this.stats?.update_fs_stats
        };
    }

    //TODO:  dup from namespace_fs - need to handle and not dup code

    /**
     * @param {nb.ObjectSDK} object_sdk
     * @param {string} [fs_backend]
     * @returns {nb.NativeFSContext}
     */
    prepare_fs_context(object_sdk, fs_backend) {
        const fs_context = object_sdk?.requesting_account?.nsfs_account_config;
        if (!fs_context) throw new RpcError('UNAUTHORIZED', 'nsfs_account_config is missing');
        fs_context.warn_threshold_ms = config.NSFS_WARN_THRESHOLD_MS;
        fs_context.backend = fs_backend;
        if (this.stats) fs_context.report_fs_stats = this.stats.update_fs_stats;
        return fs_context;
    }

    _get_bucket_config_path(bucket_name) {
       return path.join(this.bucket_schema_dir, bucket_name + '.json');
    }

    async _get_root_account_config_path(name) {
        const iam_account_path = path.join(this.root_accounts_dir, name, name + '.symlink');
        if (await is_path_exists(this.fs_context, iam_account_path)) {
            return iam_account_path;
        }
        return this._get_account_config_path(name);
    }

    _get_account_config_path(id) {
        return path.join(this.accounts_dir, id + '.json');
    }

    _get_access_keys_config_path(access_key) {
        return path.join(this.access_keys_dir, access_key + '.symlink');
    }

    async _get_account_by_name(name) {
        const account_config_path = await this._get_root_account_config_path(name);
        try {
            await nb_native().fs.stat(this.fs_context, account_config_path);
            return true;
        } catch (err) {
            return false;
        }
    }

    async _get_account_by_id(id) {
        const account_config_path = this._get_account_config_path(id);
        try {
            await nb_native().fs.stat(this.fs_context, account_config_path);
            return true;
        } catch (err) {
            return false;
        }
    }

    async read_account_by_access_key({ access_key }) {
        try {
            if (!access_key) throw new Error('no access key');
            const iam_path = access_key === anonymous_access_key ? await this._get_root_account_config_path(config.ANONYMOUS_ACCOUNT_NAME) :
                this._get_access_keys_config_path(access_key);
            const { data } = await nb_native().fs.readFile(this.fs_context, iam_path);
            const account = JSON.parse(data.toString());
            nsfs_schema_utils.validate_account_schema(account);
            account.name = new SensitiveString(account.name);
            account.email = new SensitiveString(account.email);
            account.access_keys = await nc_mkm.decrypt_access_keys(account);
            for (const k of account.access_keys) {
                k.access_key = new SensitiveString(k.access_key);
                k.secret_key = new SensitiveString(k.secret_key);
            }
            if (account.nsfs_account_config.distinguished_name) {
                account.nsfs_account_config.distinguished_name = new SensitiveString(account.nsfs_account_config.distinguished_name);
            }
            return account;
        } catch (err) {
            dbg.error('BucketSpaceFS.read_account_by_access_key: failed with error', err);
            if (err.code === 'ENOENT') {
                throw new RpcError('NO_SUCH_ACCOUNT', `Account with access_key not found.`, err);
            }
            //account access failed
            new NoobaaEvent(NoobaaEvent.ACCOUNT_NOT_FOUND).create_event(access_key, {access_key: access_key}, err);
            throw new RpcError('NO_SUCH_ACCOUNT', err.message);
        }
    }

    async read_bucket_sdk_info({ name }) {
        try {
            const bucket_config_path = this._get_bucket_config_path(name);
            dbg.log0('BucketSpaceFS.read_bucket_sdk_info: bucket_config_path', bucket_config_path);
            let { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            nsfs_schema_utils.validate_bucket_schema(bucket);
            const is_valid = await this.check_bucket_config(bucket);
            if (!is_valid) {
                dbg.warn('BucketSpaceFS: one or more bucket config check is failed for bucket : ', name);
            }
            //also get bucket's account
            const account_config_path = this._get_account_config_path(bucket.owner_account);
            data = (await nb_native().fs.readFile(this.fs_context, account_config_path)).data;
            const account = JSON.parse(data.toString());
            nsfs_schema_utils.validate_account_schema(account);

            const nsr = {
                resource: {
                    fs_root_path: this.fs_root,
                    fs_backend: bucket.fs_backend
                },
                path: bucket.path
            };
            bucket.namespace = {
                read_resources: [nsr],
                write_resource: nsr,
                should_create_underlying_storage: bucket.should_create_underlying_storage,
            };

            bucket.bucket_info = {
                versioning: bucket.versioning,
                logging: bucket.logging,
            };

            bucket.name = new SensitiveString(bucket.name);
            bucket.bucket_owner = new SensitiveString(account.name);
            bucket.owner_account = {
                id: bucket.owner_account,
                email: new SensitiveString(account.email)
            };
            if (bucket.s3_policy) {
                for (const [s_index, statement] of bucket.s3_policy.Statement.entries()) {
                    const statement_principal = statement.Principal || statement.NotPrincipal;
                    if (statement_principal.AWS) {
                        const sensitive_arr = _.flatten([statement_principal.AWS]).map(principal => new SensitiveString(principal));
                        if (statement.Principal) bucket.s3_policy.Statement[s_index].Principal.AWS = sensitive_arr;
                        if (statement.NotPrincipal) bucket.s3_policy.Statement[s_index].NotPrincipal.AWS = sensitive_arr;
                    } else {
                        const sensitive_principal = new SensitiveString(statement_principal);
                        if (statement.Principal) bucket.s3_policy.Statement[s_index].Principal = sensitive_principal;
                        if (statement.NotPrincipal) bucket.s3_policy.Statement[s_index].NotPrincipal = sensitive_principal;
                    }
                }
            }

            return bucket;
        } catch (err) {
            const rpc_error = translate_error_codes(err, entity_enum.BUCKET);
            if (err.rpc_code === 'INVALID_SCHEMA') err.rpc_code = 'INVALID_BUCKET_STATE';
            new NoobaaEvent(NoobaaEvent[rpc_error.rpc_code]).create_event(name, {bucket_name: name}, err);
            throw rpc_error;
        }
    }

    async check_bucket_config(bucket) {
        const bucket_storage_path = path.join(this.fs_root, bucket.path);
        try {
            await nb_native().fs.stat(this.fs_context, bucket_storage_path);
            //TODO: Bucket owner check
            return true;
        } catch (err) {
            return false;
        }
    }


    ////////////
    // BUCKET //
    ////////////

    /**
     * list_buckets will read all bucket config files, and filter them according to the requesting account's 
     * permissions
     * a. First iteration - map_with_concurrency with concurrency rate of 10 entries at the same time.
     * a.1. if entry is dir file/entry is non json - we will return undefined
     * a.2. if bucket is unaccessible by bucket policy - we will return undefined
     * a.3. if underlying storage of the bucket is unaccessible by the account's uid/gid - we will return undefined
     * a.4. else - return the bucket config info.
     * b. Second iteration - filter empty entries - filter will remove undefined values produced by the map_with_concurrency().
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async list_buckets(object_sdk) {
        let entries;
        try {
            entries = await nb_native().fs.readdir(this.fs_context, this.bucket_schema_dir);
        } catch (err) {
            if (err.code === 'ENOENT') {
                dbg.error('BucketSpaceFS: root dir not found', err, this.bucket_schema_dir);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw translate_error_codes(err, entity_enum.BUCKET);
        }

        const account = object_sdk.requesting_account;
        const buckets = await P.map_with_concurrency(10, entries, async entry => {
            if (isDirectory(entry) || !entry.name.endsWith('.json')) {
                return;
            }
            const bucket_name = this.get_bucket_name(entry.name);
            let bucket;
            try {
                bucket = await object_sdk.read_bucket_sdk_config_info(bucket_name);
            } catch (err) {
                dbg.warn('list_buckets: read_bucket_sdk_config_info of bucket', bucket_name, 'got an error', err);
                // in case the config file was deleted during the bucket list - we will continue
                if (err.rpc_code !== 'NO_SUCH_BUCKET') throw err;
            }
            if (!bucket) return;
            const bucket_policy_accessible = await this.has_bucket_action_permission(bucket, account, 's3:ListBucket');
            if (!bucket_policy_accessible) return;
            const fs_accessible = await this.validate_fs_bucket_access(bucket, object_sdk);
            if (!fs_accessible) return;
            return bucket;
        });
        return { buckets: buckets.filter(bucket => bucket) };
    }

    get_bucket_name(bucket_config_file_name) {
        let bucket_name = path.basename(bucket_config_file_name);
        bucket_name = bucket_name.slice(0, bucket_name.indexOf('.json'));
        return bucket_name;
    }

    async read_bucket(params) {
        return this.read_bucket_sdk_info(params);
    }


    async create_bucket(params, sdk) {
        return bucket_semaphore.surround_key(String(params.name), async () => {
            if (!sdk.requesting_account.allow_bucket_creation) {
                throw new RpcError('UNAUTHORIZED', 'Not allowed to create new buckets');
            }
            // currently we do not allow IAM account to create a bucket (temporary)
            if (sdk.requesting_account.owner !== undefined) {
            dbg.warn('create_bucket: account is IAM account (currently not allowed to create buckets)');
                throw new RpcError('UNAUTHORIZED', 'Not allowed to create new buckets');
            }
            if (!sdk.requesting_account.nsfs_account_config || !sdk.requesting_account.nsfs_account_config.new_buckets_path) {
                throw new RpcError('MISSING_NSFS_ACCOUNT_CONFIGURATION');
            }
            const fs_context = this.prepare_fs_context(sdk);
            validate_bucket_creation(params);

            const { name } = params;
            const bucket_config_path = this._get_bucket_config_path(name);
            const bucket_storage_path = path.join(sdk.requesting_account.nsfs_account_config.new_buckets_path, name);

            dbg.log0(`BucketSpaceFS.create_bucket
                requesting_account=${util.inspect(sdk.requesting_account)},
                bucket_config_path=${bucket_config_path},
                bucket_storage_path=${bucket_storage_path}`);

            // initiate bucket defaults
            const create_uls = true;
            const bucket = this.new_bucket_defaults(sdk.requesting_account, params, create_uls, bucket_storage_path);
            const bucket_config = JSON.stringify(bucket);

            // create bucket configuration file
            try {
                // validate bucket details
                // We take an object that was stringify
                // (it unwraps ths sensitive strings, creation_date to string and removes undefined parameters)
                // for validating against the schema we need an object, hence we parse it back to object
                const bucket_to_validate = JSON.parse(bucket_config);
                dbg.log2("create_bucket: bucket properties before validate_bucket_schema", bucket_to_validate);
                nsfs_schema_utils.validate_bucket_schema(bucket_to_validate);
                await create_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path, bucket_config);
            } catch (err) {
                new NoobaaEvent(NoobaaEvent.BUCKET_CREATION_FAILED).create_event(name, {bucket_name: name}, err);
                throw translate_error_codes(err, entity_enum.BUCKET);
            }

            // create bucket's underlying storage directory
            try {
                await nb_native().fs.mkdir(fs_context, bucket_storage_path, get_umasked_mode(config.BASE_MODE_DIR));
                new NoobaaEvent(NoobaaEvent.BUCKET_CREATED).create_event(name, {bucket_name: name});
            } catch (err) {
                dbg.error('BucketSpaceFS: create_bucket could not create underlying directory - nsfs, deleting bucket', err);
                new NoobaaEvent(NoobaaEvent.BUCKET_DIR_CREATION_FAILED).create_event(name, {bucket: name, path: bucket_storage_path}, err);
                await nb_native().fs.unlink(this.fs_context, bucket_config_path);
                throw translate_error_codes(err, entity_enum.BUCKET);
            }
        });
    }


    new_bucket_defaults(account, { name, tag, lock_enabled, force_md5_etag }, create_uls, bucket_storage_path) {
        return {
            _id: mongo_utils.mongoObjectId(),
            name,
            tag: js_utils.default_value(tag, undefined),
            owner_account: account._id,
            creator: account._id,
            system_owner: account._id,
            versioning: config.NSFS_VERSIONING_ENABLED && lock_enabled ? 'ENABLED' : 'DISABLED',
            object_lock_configuration: config.WORM_ENABLED ? {
                object_lock_enabled: lock_enabled ? 'Enabled' : 'Disabled',
            } : undefined,
            creation_date: new Date().toISOString(),
            force_md5_etag: force_md5_etag,
            path: bucket_storage_path,
            should_create_underlying_storage: create_uls,
            fs_backend: account.nsfs_account_config.fs_backend
        };
    }

    /**
     * delete_bucket will delete the bucket config file and underlying directory if needed based on the requesting account permissions
     * 1. if bucket.should_create_underlying_storage - delete the underlying storage directory = the bucket's underlying FS directory in which the objects are stored
     * 2. else - check if there are no objects in the bucket, if any - throw err, else - delete export tmp file
     * 3. delete bucket config file
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<void>}
     */
    async delete_bucket(params, object_sdk) {
        const { name } = params;
        return bucket_semaphore.surround_key(String(name), async () => {
            const bucket_config_path = this._get_bucket_config_path(name);
            try {
                const { ns, bucket } = await object_sdk.read_bucket_full_info(name);
                const namespace_bucket_config = bucket && bucket.namespace;
                dbg.log1('BucketSpaceFS.delete_bucket: namespace_bucket_config', namespace_bucket_config);
                if (!namespace_bucket_config) throw new RpcError('INTERNAL_ERROR', 'Invalid Bucket configuration');

                if (namespace_bucket_config.should_create_underlying_storage) {
                    // 1. delete underlying storage (ULS = Underline Storage)
                    dbg.log1('BucketSpaceFS.delete_bucket: deleting uls', this.fs_root, namespace_bucket_config.write_resource.path);
                    const bucket_storage_path = path.join(this.fs_root, namespace_bucket_config.write_resource.path); // includes write_resource.path + bucket name (s3 flow)
                    try {
                        await ns.delete_uls({ name, full_path: bucket_storage_path }, object_sdk);
                    } catch (err) {
                        dbg.warn('delete_bucket: bucket name', name, 'with bucket_storage_path', bucket_storage_path,
                            'got an error while trying to delete_uls', err);
                        // in case the ULS was deleted - we will continue
                        if (err.rpc_code !== 'NO_SUCH_BUCKET') throw err;
                    }
                } else {
                    // 2. delete only bucket tmpdir
                    let list;
                    try {
                        list = await ns.list_objects({ ...params, bucket: name, limit: 1 }, object_sdk);
                    } catch (err) {
                        dbg.warn('delete_bucket: bucket name', name, 'got an error while trying to list_objects', err);
                        // in case the ULS was deleted - we will continue
                        if (err.rpc_code !== 'NO_SUCH_BUCKET') throw err;
                    }
                    if (list && list.objects && list.objects.length > 0) throw new RpcError('NOT_EMPTY', 'underlying directory has files in it');
                    const bucket_tmpdir_path = get_bucket_tmpdir_full_path(namespace_bucket_config.write_resource.path, bucket._id);
                    await folder_delete(bucket_tmpdir_path, this.fs_context, true);
                }
                // 3. delete bucket config json file
                dbg.log1(`BucketSpaceFS: delete_bucket: deleting config file ${bucket_config_path}`);
                await delete_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path);
                new NoobaaEvent(NoobaaEvent.BUCKET_DELETE).create_event(name, { bucket_name: name });
            } catch (err) {
                dbg.error('BucketSpaceFS: delete_bucket: bucket name', name, 'error', err);
                new NoobaaEvent(NoobaaEvent.BUCKET_DELETE_FAILED).create_event(name,
                    { bucket_name: name, bucket_path: bucket_config_path }, err);
                throw translate_error_codes(err, entity_enum.BUCKET);
            }
        });
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
            dbg.log0('BucketSpaceFS.set_bucket_versioning: Bucket name, versioning', name, versioning);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            bucket.versioning = versioning;
            dbg.log2("set_bucket_versioning: bucket properties before validate_bucket_schema",
                bucket);
            nsfs_schema_utils.validate_bucket_schema(bucket);
            const update_bucket = JSON.stringify(bucket);
            await update_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path, update_bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
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

    ////////////////////
    // BUCKET LOGGING //
    ////////////////////

    async put_bucket_logging(params) {
        try {
            const { name, logging } = params;
            dbg.log0('BucketSpaceFS.put_bucket_logging: Bucket name, logging', name, logging);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            bucket.logging = logging;
            const target_bucket_config_path = this._get_bucket_config_path(logging.log_bucket);
            let target_data;
            try {
                const { data: data1 } = await nb_native().fs.readFile(this.fs_context, target_bucket_config_path);
                target_data = data1;
            } catch (err) {
                dbg.error('ERROR with reading TARGET BUCKET data', logging.log_bucket, err);
                if (err.code === 'ENOENT') throw new RpcError('INVALID_TARGET_BUCKET', 'The target bucket for logging does not exist');
                throw err;
            }
            const target_bucket = JSON.parse(target_data.toString());
            if (target_bucket.owner_account !== bucket.owner_account) {
                dbg.error('TARGET BUCKET NOT OWNED BY USER', target_bucket, bucket);
                throw new RpcError('INVALID_TARGET_BUCKET', 'The owner for the bucket to be logged and the target bucket must be the same');
            }
            dbg.log2('put_bucket_logging: bucket properties before validate_bucket_schema', bucket);
            nsfs_schema_utils.validate_bucket_schema(bucket);
            const update_bucket = JSON.stringify(bucket);
            await update_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path, update_bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async delete_bucket_logging(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_logging: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            delete bucket.logging;
            dbg.log2("delete_bucket_logging: bucket properties before validate_bucket_schema", bucket);
            // on the safe side validate before changing configuration
            nsfs_schema_utils.validate_bucket_schema(bucket);
            const update_bucket = JSON.stringify(bucket);
            await update_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path, update_bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async get_bucket_logging(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_logging: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            return bucket.logging;
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
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
            // in case it is algorithm: 'AES256', the property would be undefined
            const bucket_to_validate = _.omitBy(bucket, _.isUndefined);
            dbg.log2("put_bucket_encryption: bucket properties before validate_bucket_schema",
            bucket_to_validate);
            nsfs_schema_utils.validate_bucket_schema(bucket_to_validate);
            const update_bucket = JSON.stringify(bucket);
            await update_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path, update_bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
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
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async delete_bucket_encryption(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_encryption: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            delete bucket.encryption;
            dbg.log2("delete_bucket_encryption: bucket properties before validate_bucket_schema", bucket);
            // on the safe side validate before changing configuration
            nsfs_schema_utils.validate_bucket_schema(bucket);
            const update_bucket = JSON.stringify(bucket);
            await update_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path, update_bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
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
            const bucket_to_validate = _.omitBy(bucket, _.isUndefined);
            dbg.log2("put_bucket_website: bucket properties before validate_bucket_schema",
            bucket_to_validate);
            nsfs_schema_utils.validate_bucket_schema(bucket_to_validate);
            const update_bucket = JSON.stringify(bucket);
            await update_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path, update_bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async delete_bucket_website(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_website: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            delete bucket.website;
            dbg.log2("delete_bucket_website: bucket properties before validate_bucket_schema", bucket);
            // on the safe side validate before changing configuration
            nsfs_schema_utils.validate_bucket_schema(bucket);
            const update_bucket = JSON.stringify(bucket);
            await update_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path, update_bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    /**
    * @param {object} params
    * @returns {Promise<object>}
    */
    async get_bucket_website(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_website: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            return { website: bucket.website };
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
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
            const bucket_to_validate = _.omitBy(bucket, _.isUndefined);
            dbg.log2("put_bucket_policy: bucket properties before validate_bucket_schema",
            bucket_to_validate);
            nsfs_schema_utils.validate_bucket_schema(bucket_to_validate);
            await bucket_policy_utils.validate_s3_policy(bucket.s3_policy, bucket.name,
                async principal => await get_account_by_principal(this.fs_context, this.accounts_dir,
                    this.root_accounts_dir, principal.unwrap())
            );
            const update_bucket = JSON.stringify(bucket);
            await update_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path, update_bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async delete_bucket_policy(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_policy: Bucket name', name);
            const bucket_config_path = this._get_bucket_config_path(name);
            const { data } = await nb_native().fs.readFile(this.fs_context, bucket_config_path);
            const bucket = JSON.parse(data.toString());
            delete bucket.s3_policy;
            dbg.log2("delete_bucket_policy: bucket properties before validate_bucket_schema", bucket);
            // on the safe side validate before changing configuration
            nsfs_schema_utils.validate_bucket_schema(bucket);
            const update_bucket = JSON.stringify(bucket);
            await update_config_file(this.fs_context, this.bucket_schema_dir, bucket_config_path, update_bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async get_bucket_policy(params, object_sdk) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_policy: Bucket name', name);
            const bucket_policy_info = await object_sdk.read_bucket_sdk_policy_info(name);
            dbg.log0('BucketSpaceFS.get_bucket_policy: policy', bucket_policy_info);
            return {
                policy: bucket_policy_info.s3_policy
            };
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
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

    /////////////////
    ///// UTILS /////
    /////////////////

    // TODO: move the following 3 functions - has_bucket_action_permission(), validate_fs_bucket_access(), _has_access_to_nsfs_dir()
    // so they can be re-used
    async has_bucket_action_permission(bucket, account, action, bucket_path = "") {
        const account_identifier = account._id;
        dbg.log1('has_bucket_action_permission:', bucket.name.unwrap(), account_identifier, bucket.owner_account);

        const is_system_owner = account_identifier === bucket.system_owner;

        // If the system owner account wants to access the bucket, allow it
        if (is_system_owner) return true;
        const is_owner = (bucket.owner_account === account_identifier);
        const bucket_policy = bucket.s3_policy;

        if (!bucket_policy) {
        // in case we do not have bucket policy
        // we allow IAM account to access a bucket that that is owned by their root account
        const is_iam_and_same_root_account_owner = account.owner !== undefined &&
            account.owner === bucket.owner_account.id;
            return is_owner || is_iam_and_same_root_account_owner;
        }
        if (!action) {
            throw new Error('has_bucket_action_permission: action is required');
        }

        let result = await bucket_policy_utils.has_bucket_policy_permission(
            bucket_policy,
            account_identifier,
            action,
            `arn:aws:s3:::${bucket.name.unwrap()}${bucket_path}`,
            undefined
        );

        //we (currently) allow account identified to be both id and name,
        //so if by-id failed, try also name
        if (result === 'IMPLICIT_DENY') {
            result = await bucket_policy_utils.has_bucket_policy_permission(
                bucket_policy,
                account.name.unwrap(),
                action,
                `arn:aws:s3:::${bucket.name.unwrap()}${bucket_path}`,
                undefined
            );
        }

        if (result === 'DENY') return false;
        return is_owner || result === 'ALLOW';
    }

    async validate_fs_bucket_access(bucket, object_sdk) {
        dbg.log1('bucketspace_fs.validate_fs_bucket_access:', bucket.name.unwrap());
        const ns = bucket.namespace;
        const is_nsfs_bucket = object_sdk.is_nsfs_bucket(ns);
        const accessible = is_nsfs_bucket ? await this._has_access_to_nsfs_dir(ns, object_sdk) : false;
        dbg.log1('bucketspace_fs.validate_fs_bucket_access:', bucket.name.unwrap(), is_nsfs_bucket, accessible);
        return accessible;
    }

    async _has_access_to_nsfs_dir(ns, object_sdk) {
        const account = object_sdk.requesting_account;
        dbg.log1('_has_access_to_nsfs_dir: nsr: ', ns, 'account.nsfs_account_config: ', account && account.nsfs_account_config);
        // nsfs bucket
        if (!account || !account.nsfs_account_config || _.isUndefined(account.nsfs_account_config.uid) ||
            _.isUndefined(account.nsfs_account_config.gid)) return false;
        try {
            dbg.log1('_has_access_to_nsfs_dir: checking access:', ns.write_resource, account.nsfs_account_config.uid, account.nsfs_account_config.gid);
            const path_to_check = path.join(ns.write_resource.resource.fs_root_path, ns.write_resource.path || '');
            const fs_context = this.prepare_fs_context(object_sdk, ns.write_resource.resource.fs_backend);
            await nb_native().fs.checkAccess(fs_context, path_to_check);
            return true;
        } catch (err) {
            dbg.log0('_has_access_to_nsfs_dir: failed', err);
            if (err.code === 'ENOENT' || err.code === 'EACCES' || (err.code === 'EPERM' && err.message === 'Operation not permitted')) return false;
            throw err;
        }
    }

    is_nsfs_containerized_user_anonymous(token) {
        return !token && !process.env.NC_NSFS_NO_DB_ENV;
    }

    is_nsfs_non_containerized_user_anonymous(token) {
        return !token && process.env.NC_NSFS_NO_DB_ENV;
    }
}

module.exports = BucketSpaceFS;
