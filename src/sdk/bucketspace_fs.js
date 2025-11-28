/* Copyright (C) 2020 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const path = require('path');
const { default: Ajv } = require('ajv');
const P = require('../util/promise');
const config = require('../../config');
const RpcError = require('../rpc/rpc_error');
const js_utils = require('../util/js_utils');
const nb_native = require('../util/nb_native');
const mongo_utils = require('../util/mongo_utils');
const KeysSemaphore = require('../util/keys_semaphore');
const {
    get_umasked_mode,
    validate_bucket_creation,
    get_bucket_tmpdir_full_path,
    folder_delete,
    entity_enum,
    translate_error_codes,
    get_process_fs_context
} = require('../util/native_fs_utils');
const { S3Error } = require('../endpoint/s3/s3_errors');
const { anonymous_access_key } = require('./object_sdk');
const s3_utils = require('../endpoint/s3/s3_utils');
const { ConfigFS, JSON_SUFFIX } = require('./config_fs');
const SensitiveString = require('../util/sensitive_string');
const BucketSpaceSimpleFS = require('./bucketspace_simple_fs');
const { account_id_cache } = require('../sdk/accountspace_fs');
const nsfs_schema_utils = require('../manage_nsfs/nsfs_schema_utils');
const bucket_policy_utils = require('../endpoint/s3/s3_bucket_policy_utils');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;
const native_fs_utils = require('../util/native_fs_utils');

const dbg = require('../util/debug_module')(__filename);
const bucket_semaphore = new KeysSemaphore(1);

const ajv = new Ajv();

class BucketSpaceFS extends BucketSpaceSimpleFS {
    constructor({ config_root }, stats) {
        super({ fs_root: '' });
        this.config_root = config_root;
        this.stats = stats;
        this.fs_context = get_process_fs_context(
            config.NSFS_NC_CONFIG_DIR_BACKEND,
            config.NSFS_WARN_THRESHOLD_MS,
            this.stats?.update_fs_stats
        );

        this.config_fs = new ConfigFS(config_root, config.NSFS_NC_CONFIG_DIR_BACKEND, this.fs_context);
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

    // TODO: account function should be handled in accountspace_fs 
    async read_account_by_access_key({ access_key }) {
        try {
            if (!access_key) throw new Error('no access key');
            const options = { show_secrets: true };
            const account = access_key === anonymous_access_key ?
                await this.config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME, options) :
                await this.config_fs.get_account_by_access_key(access_key, options);

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
            try {
                account.stat = await this.config_fs.stat_account_config_file(access_key);
            } catch (err) {
                dbg.warn(`BucketspaceFS.read_account_by_access_key could not stat_account_config_file` +
                    `of account id: ${account._id} account name: ${account.name.unwrap()}`);
            }
            return account;
        } catch (err) {
            dbg.error('BucketSpaceFS.read_account_by_access_key: failed with error', err);
            if (err.code === 'ENOENT') {
                throw new RpcError('NO_SUCH_ACCOUNT', `Account with access_key not found.`, err);
            }
            //account access failed
            new NoobaaEvent(NoobaaEvent.ACCOUNT_NOT_FOUND).create_event(access_key, { access_key: access_key }, err);
            throw new RpcError('NO_SUCH_ACCOUNT', err.message);
        }
    }

    async read_bucket_sdk_info({ name }) {
        try {
            dbg.log0('BucketSpaceFS.read_bucket_sdk_info: bucket name', name);

            const bucket = await this.config_fs.get_bucket_by_name(name);
            nsfs_schema_utils.validate_bucket_schema(bucket);

            const is_valid = await this.check_stat_bucket_storage_path(bucket.path);
            if (!is_valid) {
                dbg.warn('BucketSpaceFS: invalid storage path for bucket : ', name);
            }

            const nsr = {
                resource: {
                    fs_root_path: '',
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

            let account_config;
            try {
                account_config = await account_id_cache.get_with_cache({ _id: bucket.owner_account, config_fs: this.config_fs });
            } catch (err) {
                dbg.warn(`BucketspaceFS.read_bucket_sdk_info could not find bucket owner by id ${bucket.owner_account}`);
            }
            bucket.bucket_owner = new SensitiveString(account_config?.name);
            bucket.owner_account = {
                id: bucket.owner_account,
                email: bucket.bucket_owner
            };
            bucket.supported_storage_classes = this._supported_storage_class();
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
            try {
                bucket.stat = await this.config_fs.stat_bucket_config_file(bucket.name.unwrap());
            } catch (err) {
                dbg.warn(`BucketspaceFS.read_bucket_sdk_info could not stat_bucket_config_file ${bucket.name.unwrap()}`);
            }
            return bucket;
        } catch (err) {
            const rpc_error = translate_error_codes(err, entity_enum.BUCKET);
            if (err.rpc_code === 'INVALID_SCHEMA') err.rpc_code = 'INVALID_BUCKET_STATE';
            new NoobaaEvent(NoobaaEvent[rpc_error.rpc_code]).create_event(name, { bucket_name: name }, err);
            throw rpc_error;
        }
    }

    /**
     * check_stat_bucket_storage_path will return the true
     * if there is stat output on the bucket storage path
     * (in case the stat throws an error it would return false)
     * @param {string} bucket_storage_path
     * @returns {Promise<boolean>}
     */
    async check_stat_bucket_storage_path(bucket_storage_path) {
        try {
            await nb_native().fs.stat(this.fs_context, bucket_storage_path);
            return true;
        } catch (err) {
            return false;
        }
    }

    /**
     * check_same_stat_bucket will return true the config file was not changed
     * in case we had any issue (for example error during stat) the returned value will be undefined
     * @param {string} bucket_name
     * @param {nb.NativeFSStats} bucket_stat
     * @returns Promise<{boolean|undefined>}
     */
    async check_same_stat_bucket(bucket_name, bucket_stat) {
        try {
            const current_stat = await this.config_fs.stat_bucket_config_file(bucket_name);
            if (current_stat) {
                return current_stat.ino === bucket_stat.ino && current_stat.mtimeNsBigint === bucket_stat.mtimeNsBigint;
            }
        } catch (err) {
            dbg.warn('check_same_stat_bucket: current_stat got an error', err, 'ignoring...');
        }
    }

    /**
     * check_same_stat_account will return true the config file was not changed
     * in case we had any issue (for example error during stat) the returned value will be undefined
     * @param {Symbol|string} access_key
     * @param {nb.NativeFSStats} account_stat
     * @returns Promise<{boolean|undefined>}
     */
    // TODO: account function should be handled in accountspace_fs 
    async check_same_stat_account(access_key, account_stat) {
        try {
            const current_stat = await this.config_fs.stat_account_config_file(access_key);
            if (current_stat) {
                return current_stat.ino === account_stat.ino && current_stat.mtimeNsBigint === account_stat.mtimeNsBigint;
            }
        } catch (err) {
            dbg.warn('check_same_stat_account: current_stat got an error', err, 'ignoring...');
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
     * a.2. if bucket is not owned by the account (or their root account for IAM users) - we will return undefined
     * a.3. if underlying storage of the bucket is unaccessible by the account's uid/gid - we will return undefined
     * a.4. else - return the bucket config info.
     * b. Second iteration - filter empty entries - filter will remove undefined values produced by the map_with_concurrency().
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async list_buckets(params, object_sdk) {
        let bucket_names;
        try {
            bucket_names = await this.config_fs.list_buckets();
        } catch (err) {
            if (err.code === 'ENOENT') {
                dbg.error('BucketSpaceFS: root dir not found', err, this.config_fs.buckets_dir_path);
                throw new S3Error(S3Error.NoSuchBucket);
            }
            throw translate_error_codes(err, entity_enum.BUCKET);
        }

        const account = object_sdk.requesting_account;
        const buckets = await P.map_with_concurrency(10, bucket_names, async bucket_name => {
            let bucket;
            try {
                bucket = await object_sdk.read_bucket_sdk_config_info(bucket_name);
            } catch (err) {
                dbg.warn('list_buckets: read_bucket_sdk_config_info of bucket', bucket_name, 'got an error', err);
                // in case the config file was deleted during the bucket list - we will continue
                if (err.rpc_code !== 'NO_SUCH_BUCKET') throw err;
            }
            if (!bucket) return;

            if (!this.has_bucket_ownership_permission(bucket, account)) return;

            const fs_accessible = await this.validate_fs_bucket_access(bucket, object_sdk);
            if (!fs_accessible) return;
            return bucket;
        });
        return { buckets: buckets.filter(bucket => bucket) };
    }

    get_bucket_name(bucket_config_file_name) {
        let bucket_name = path.basename(bucket_config_file_name);
        bucket_name = bucket_name.slice(0, bucket_name.indexOf(JSON_SUFFIX));
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
            if (!sdk.requesting_account.nsfs_account_config || !sdk.requesting_account.nsfs_account_config.new_buckets_path) {
                throw new RpcError('MISSING_NSFS_ACCOUNT_CONFIGURATION');
            }
            const fs_context = this.prepare_fs_context(sdk);
            validate_bucket_creation(params);

            const { name } = params;
            const bucket_config_path = this.config_fs.get_bucket_path_by_name(name);
            const bucket_storage_path = path.join(sdk.requesting_account.nsfs_account_config.new_buckets_path, name);

            dbg.log0(`BucketSpaceFS.create_bucket
                requesting_account=${util.inspect(sdk.requesting_account)},
                bucket_config_path=${bucket_config_path},
                bucket_storage_path=${bucket_storage_path}`);

            // initiate bucket defaults
            const create_uls = true;
            const bucket = this.new_bucket_defaults(sdk.requesting_account, params, create_uls, bucket_storage_path);
            // create bucket configuration file
            try {
                await this.config_fs.create_bucket_config_file(bucket);
            } catch (err) {
                new NoobaaEvent(NoobaaEvent.BUCKET_CREATION_FAILED).create_event(name, { bucket_name: name }, err);
                throw translate_error_codes(err, entity_enum.BUCKET);
            }

            // create bucket's underlying storage directory
            await BucketSpaceFS._create_uls(this.fs_context, fs_context, name, bucket_storage_path, bucket_config_path);
            const reserved_tag_event_args = Object.keys(config.NSFS_GLACIER_RESERVED_BUCKET_TAGS).reduce((curr, tag) => {
                const tag_info = config.NSFS_GLACIER_RESERVED_BUCKET_TAGS[tag];
                if (tag_info.event) return Object.assign(curr, { [tag]: tag_info.default });
                return curr;
            }, {});

            new NoobaaEvent(NoobaaEvent.BUCKET_CREATED).create_event(name, {
                ...reserved_tag_event_args, bucket_name: name, account: sdk.requesting_account.name
            });
        });
    }


    new_bucket_defaults(account, { name, tag, lock_enabled, force_md5_etag }, create_uls, bucket_storage_path) {
        return {
            _id: mongo_utils.mongoObjectId(),
            name,
            tag: js_utils.default_value(tag, BucketSpaceFS._default_bucket_tags()),
            owner_account: account.owner ? account.owner : account._id, // The account is the owner of the buckets that were created by it or by its users.
            creator: account._id,
            versioning: config.NSFS_VERSIONING_ENABLED && lock_enabled ? 'ENABLED' : 'DISABLED',
            object_lock_configuration: config.WORM_ENABLED ? {
                object_lock_enabled: lock_enabled ? 'Enabled' : 'Disabled',
            } : undefined,
            creation_date: new Date().toISOString(),
            force_md5_etag: force_md5_etag,
            path: bucket_storage_path,
            should_create_underlying_storage: create_uls,
            fs_backend: account.nsfs_account_config.fs_backend,
            cors_configuration_rules: config.S3_CORS_DEFAULTS_ENABLED ? [{
                allowed_origins: config.S3_CORS_ALLOW_ORIGIN,
                allowed_methods: config.S3_CORS_ALLOW_METHODS,
                allowed_headers: config.S3_CORS_ALLOW_HEADERS,
                expose_headers: config.S3_CORS_EXPOSE_HEADERS,

            }] : undefined,
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
            const bucket_config_path = this.config_fs.get_bucket_path_by_name(name);
            try {
                const { ns, bucket } = await object_sdk.read_bucket_full_info(name);
                const namespace_bucket_config = bucket && bucket.namespace;
                dbg.log1('BucketSpaceFS.delete_bucket: namespace_bucket_config', namespace_bucket_config);
                if (!namespace_bucket_config) throw new RpcError('INTERNAL_ERROR', 'Invalid Bucket configuration');

                if (namespace_bucket_config.should_create_underlying_storage) {
                    // 1. delete underlying storage (ULS = Underline Storage)
                    dbg.log1('BucketSpaceFS.delete_bucket: deleting uls', namespace_bucket_config.write_resource.path);
                    const bucket_storage_path = namespace_bucket_config.write_resource.path; // includes write_resource.path + bucket name (s3 flow)
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
                        if (ns._is_versioning_disabled()) {
                            list = await ns.list_objects({ ...params, bucket: name, limit: 1 }, object_sdk);
                        } else {
                            list = await ns.list_object_versions({ ...params, bucket: name, limit: 1 }, object_sdk);
                        }
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
                await this.config_fs.delete_bucket_config_file(name);
                new NoobaaEvent(NoobaaEvent.BUCKET_DELETE).create_event(name, { bucket_name: name });
            } catch (err) {
                dbg.error('BucketSpaceFS: delete_bucket: bucket name', name, 'error', err);
                new NoobaaEvent(NoobaaEvent.BUCKET_DELETE_FAILED)
                    .create_event(name, { bucket_name: name, bucket_path: bucket_config_path }, err);
                throw translate_error_codes(err, entity_enum.BUCKET);
            }
        });
    }


    //////////////////////
    // BUCKET LIFECYCLE //
    //////////////////////

    async get_bucket_lifecycle_configuration_rules(params) {
        try {
            const { name } = params;
            dbg.log1('BucketSpaceFS.get_bucket_lifecycle_configuration_rules: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            return bucket.lifecycle_configuration_rules || [];
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    async set_bucket_lifecycle_configuration_rules(params) {
        try {
            const { name, rules } = params;
            dbg.log0('BucketSpaceFS.set_bucket_lifecycle_configuration_rules: Bucket name, rules', name, rules);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            bucket.lifecycle_configuration_rules = rules;
            nsfs_schema_utils.validate_bucket_schema(bucket);
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async delete_bucket_lifecycle(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_lifecycle: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            delete bucket.lifecycle_configuration_rules;
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
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
            const bucket = await this.config_fs.get_bucket_by_name(name);
            bucket.versioning = versioning;
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    ////////////////////
    // BUCKET TAGGING //
    ////////////////////

    /**
     * @param {*} params 
     * @param {nb.ObjectSDK} object_sdk 
     */
    async put_bucket_tagging(params, object_sdk) {
        try {
            const { name, tagging } = params;
            dbg.log0('BucketSpaceFS.put_bucket_tagging: Bucket name, tagging', name, tagging);
            const bucket_path = this.config_fs.get_bucket_path_by_name(name);

            const bucket_lock_file = `${bucket_path}.lock`;
            await native_fs_utils.lock_and_run(this.fs_context, bucket_lock_file, async () => {
                const bucket = await this.config_fs.get_bucket_by_name(name);
                const { ns } = await object_sdk.read_bucket_full_info(name);
                const is_bucket_empty = await BucketSpaceFS._is_bucket_empty(name, null, ns, object_sdk);

                const tagging_object = BucketSpaceFS._objectify_tagging_arr(bucket.tag);
                const merged_tags = BucketSpaceFS._merge_reserved_tags(
                    bucket.tag || BucketSpaceFS._default_bucket_tags(), tagging, is_bucket_empty
                );

                const [
                    reserved_tag_event_args,
                    reserved_tag_modified,
                ] = BucketSpaceFS._generate_reserved_tag_event_args(tagging_object, merged_tags);

                bucket.tag = merged_tags;
                await this.config_fs.update_bucket_config_file(bucket);
                if (reserved_tag_modified) {
                    new NoobaaEvent(NoobaaEvent.BUCKET_RESERVED_TAG_MODIFIED)
                        .create_event(undefined, { ...reserved_tag_event_args, bucket_name: name });
                }
            });
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    async delete_bucket_tagging(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_tagging: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);

            const preserved_tags = [];
            for (const tag of bucket.tag) {
                const tag_info = config.NSFS_GLACIER_RESERVED_BUCKET_TAGS[tag.key];
                if (tag_info?.immutable) {
                    preserved_tags.push(tag);
                }
            }

            bucket.tag = preserved_tags;
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    async get_bucket_tagging(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_tagging: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            return { tagging: bucket.tag || [] };
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    /**
     * _default_bucket_tags returns the default bucket tags (primarily reserved tags)
     * in the AWS tagging format
     *
     * @returns {Array<{key: string, value: string}>}
     */
    static _default_bucket_tags() {
        return Object.keys(
            config.NSFS_GLACIER_RESERVED_BUCKET_TAGS
        ).map(key => ({ key, value: config.NSFS_GLACIER_RESERVED_BUCKET_TAGS[key].default }));
    }

    /**
     * _merge_reserved_tags takes original tags, new_tags and a boolean indicating whether
     * the bucket is empty or not and returns an array of merged tags based on the rules
     * of reserved tags.
     *
     * @param {Array<{key: string, value: string}>} new_tags 
     * @param {Array<{key: string, value: string}>} original_tags 
     * @param {boolean} is_bucket_empty 
     * @returns {Array<{key: string, value: string}>}
     */
    static _merge_reserved_tags(original_tags, new_tags, is_bucket_empty) {
        const merged_tags = original_tags.reduce((curr, tag) => {
            if (!config.NSFS_GLACIER_RESERVED_BUCKET_TAGS[tag.key]) return curr;
            return Object.assign(curr, { [tag.key]: tag.value });
        }, {});

        for (const tag of new_tags) {
            const tag_info = config.NSFS_GLACIER_RESERVED_BUCKET_TAGS[tag.key];
            if (!tag_info) {
                merged_tags[tag.key] = tag.value;
                continue;
            }
            if (!tag_info.immutable || (tag_info.immutable === 'if-data' && is_bucket_empty)) {
                let validator = ajv.getSchema(tag_info.schema.$id);
                if (!validator) {
                    ajv.addSchema(tag_info.schema);
                    validator = ajv.getSchema(tag_info.schema.$id);
                }

                if (validator(tag.value)) {
                    merged_tags[tag.key] = tag.value;
                }
            }
        }

        return Object.keys(merged_tags).map(key => ({ key, value: merged_tags[key] }));
    }

    ////////////////////
    // BUCKET LOGGING //
    ////////////////////

    async put_bucket_logging(params) {
        try {
            const { name, logging } = params;
            dbg.log0('BucketSpaceFS.put_bucket_logging: Bucket name, logging', name, logging);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            bucket.logging = logging;

            let target_bucket;
            try {
                target_bucket = await this.config_fs.get_bucket_by_name(logging.log_bucket);
            } catch (err) {
                dbg.error('ERROR with reading TARGET BUCKET data', logging.log_bucket, err);
                if (err.code === 'ENOENT') throw new RpcError('INVALID_TARGET_BUCKET', 'The target bucket for logging does not exist');
                throw err;
            }
            if (target_bucket.owner_account !== bucket.owner_account) {
                dbg.error('TARGET BUCKET NOT OWNED BY USER', target_bucket, bucket);
                throw new RpcError('INVALID_TARGET_BUCKET', 'The owner for the bucket to be logged and the target bucket must be the same');
            }
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async delete_bucket_logging(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_logging: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            delete bucket.logging;
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async get_bucket_logging(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_logging: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
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
            const bucket = await this.config_fs.get_bucket_by_name(name);
            bucket.encryption = encryption;
            // in case it is algorithm: 'AES256', the property would be undefined
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async get_bucket_encryption(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_encryption: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            return { encryption: bucket.encryption };
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async delete_bucket_encryption(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_encryption: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            delete bucket.encryption;
            await this.config_fs.update_bucket_config_file(bucket);
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
            const bucket = await this.config_fs.get_bucket_by_name(name);
            bucket.website = website;
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async delete_bucket_website(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_website: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            delete bucket.website;
            await this.config_fs.update_bucket_config_file(bucket);
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
            const bucket = await this.config_fs.get_bucket_by_name(name);
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
            const bucket = await this.config_fs.get_bucket_by_name(name);

            if (
                bucket.public_access_block?.block_public_policy &&
                bucket_policy_utils.allows_public_access(policy)
            ) {
                throw new S3Error(S3Error.AccessDenied);
            }

            bucket.s3_policy = policy;
            // We need to validate bucket schema here as well for checking the policy schema
            nsfs_schema_utils.validate_bucket_schema(_.omitBy(bucket, _.isUndefined));
            await bucket_policy_utils.validate_s3_policy(bucket.s3_policy, bucket.name, async principal =>
                this.config_fs.is_account_exists_by_principal(principal, { silent_if_missing: true }));
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async delete_bucket_policy(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_policy: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            delete bucket.s3_policy;
            await this.config_fs.update_bucket_config_file(bucket);
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
            return { policy: bucket_policy_info.s3_policy };
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    /////////////////////////
    // BUCKET NOTIFICATION //
    /////////////////////////

    async put_bucket_notification(params) {
        try {
            const { bucket_name, notifications } = params;
            dbg.log0('BucketSpaceFS.put_bucket_notification: Bucket name', bucket_name, ", notifications ", notifications);
            const bucket = await this.config_fs.get_bucket_by_name(bucket_name);
            bucket.notifications = notifications;
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    async get_bucket_notification(params) {
        try {
            const { bucket_name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_notification: Bucket name', bucket_name);
            const bucket = await this.config_fs.get_bucket_by_name(bucket_name);
            return { notifications: bucket.notifications || [] };
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    ////////////////////
    // BUCKET CORS //
    ////////////////////

    async put_bucket_cors(params) {
        try {
            const { name, cors_rules } = params;
            dbg.log0('BucketSpaceFS.put_bucket_cors: Bucket name', name, ", cors configuration ", cors_rules);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            bucket.cors_configuration_rules = cors_rules;
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    async delete_bucket_cors(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.delete_bucket_cors: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            delete bucket.cors_configuration_rules;
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (err) {
            throw translate_error_codes(err, entity_enum.BUCKET);
        }
    }

    async get_bucket_cors(params) {
        try {
            const { name } = params;
            dbg.log0('BucketSpaceFS.get_bucket_cors: Bucket name', name);
            const bucket = await this.config_fs.get_bucket_by_name(name);
            return {
                cors: bucket.cors_configuration_rules || [],
            };
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    /////////////////////////
    // PUBLIC ACCESS BLOCK //
    /////////////////////////

    async get_public_access_block(params, object_sdk) {
        try {
            const { bucket_name } = params;
            dbg.log0('BucketSpaceFS.get_public_access_block: Bucket name', bucket_name);
            const bucket = await this.config_fs.get_bucket_by_name(bucket_name);
            return {
                public_access_block: bucket.public_access_block,
            };
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    async put_public_access_block(params, object_sdk) {
        try {
            const { bucket_name, public_access_block } = params;
            dbg.log0('BucketSpaceFS.put_public_access_block: Bucket name', bucket_name, ", public_access_block ", public_access_block);
            const bucket = await this.config_fs.get_bucket_by_name(bucket_name);
            bucket.public_access_block = public_access_block;
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    async delete_public_access_block(params, object_sdk) {
        try {
            const { bucket_name } = params;
            dbg.log0('BucketSpaceFS.delete_public_access_block: Bucket name', bucket_name);
            const bucket = await this.config_fs.get_bucket_by_name(bucket_name);
            delete bucket.public_access_block;
            await this.config_fs.update_bucket_config_file(bucket);
        } catch (error) {
            throw translate_error_codes(error, entity_enum.BUCKET);
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

    is_nsfs_containerized_user_anonymous(token) {
        return !token && !process.env.NC_NSFS_NO_DB_ENV;
    }

    is_nsfs_non_containerized_user_anonymous(token) {
        return !token && process.env.NC_NSFS_NO_DB_ENV;
    }

    /**
     * returns a list of storage class supported by this bucketspace
     * @returns {Array<string>}
     */
    _supported_storage_class() {
        const storage_classes = [];
        if (!config.DENY_UPLOAD_TO_STORAGE_CLASS_STANDARD) {
            storage_classes.push(s3_utils.STORAGE_CLASS_STANDARD);
        }
        if (config.NSFS_GLACIER_ENABLED) {
            storage_classes.push(s3_utils.STORAGE_CLASS_GLACIER);
        }

        return storage_classes;
    }

    /**
     * _is_bucket_empty returns true if the given bucket is empty
     *
     * @param {*} ns
     * @param {*} params
     * @param {string} name
     * @param {nb.ObjectSDK} object_sdk
     *
     * @returns {Promise<boolean>}
     */
    static async _is_bucket_empty(name, params, ns, object_sdk) {
        params = params || {};

        let list;
        try {
            if (ns._is_versioning_disabled()) {
                list = await ns.list_objects({ ...params, bucket: name, limit: 1 }, object_sdk);
            } else {
                list = await ns.list_object_versions({ ...params, bucket: name, limit: 1 }, object_sdk);
            }
        } catch (err) {
            dbg.warn('_is_bucket_empty: bucket name', name, 'got an error while trying to list_objects', err);
            // in case the ULS was deleted - we will continue
            if (err.rpc_code !== 'NO_SUCH_BUCKET') throw err;
        }

        return !(list && list.objects && list.objects.length > 0);
    }

    /**
     * _generate_reserved_tag_event_args returns the list of reserved
     * bucket tags which have been modified and also returns a variable
     * indicating if there has been any modifications at all.
     * @param {Record<string, string>} prev_tags_objectified
     * @param {Array<{key: string, value: string}>} new_tags
     */
    static _generate_reserved_tag_event_args(prev_tags_objectified, new_tags) {
        let reserved_tag_modified = false;
        const reserved_tag_event_args = new_tags?.reduce((curr, tag) => {
            const tag_info = config.NSFS_GLACIER_RESERVED_BUCKET_TAGS[tag.key];

            // If not a reserved tag - skip
            if (!tag_info) return curr;

            // If no event is requested - skip
            if (!tag_info.event) return curr;

            // If value didn't change - skip
            if (_.isEqual(prev_tags_objectified[tag.key], tag.value)) return curr;

            reserved_tag_modified = true;
            return Object.assign(curr, { [tag.key]: tag.value });
        }, {});

        return [reserved_tag_event_args, reserved_tag_modified];
    }

    /**
     * @param {Array<{key: string, value: string}>} tagging
     * @returns {Record<string, string>}
     */
    static _objectify_tagging_arr(tagging) {
        return (tagging || []).reduce((curr, tag) => Object.assign(curr, { [tag.key]: tag.value }), {});
    }

    /**
     * _create_uls creates underylying storage at the given storage_path
     * @param {*} fs_context - root fs_context
     * @param {*} acc_fs_context - fs_context associated with the performing account
     * @param {*} name - bucket name
     * @param {*} storage_path - bucket's storage path
     * @param {*} cfg_path - bucket's configuration path
     */
    static async _create_uls(fs_context, acc_fs_context, name, storage_path, cfg_path) {
        try {
            await nb_native().fs.mkdir(acc_fs_context, storage_path, get_umasked_mode(config.BASE_MODE_DIR));
        } catch (error) {
            dbg.error('BucketSpaceFS: _create_uls could not create underlying directory - nsfs, deleting bucket', error);
            new NoobaaEvent(NoobaaEvent.BUCKET_DIR_CREATION_FAILED)
                .create_event(name, { bucket: name, path: storage_path }, error);
            await nb_native().fs.unlink(fs_context, cfg_path);
            throw translate_error_codes(error, entity_enum.BUCKET);
        }
    }

    //////////////////
    // SHARED UTILS //
    //////////////////

    // TODO: move the below functions to a shared utils file so they can be re-used

    /**
     * is_bucket_owner checks if the account is the direct owner of the bucket
     * @param {nb.Bucket} bucket
     * @param {nb.Account} account
     * @returns {boolean}
     */
    is_bucket_owner(bucket, account) {
        if (!bucket?.owner_account?.id || !account?._id) return false;
        return bucket.owner_account.id === account._id;
    }

    /**
     * is_iam_and_same_root_account_owner checks if the account is an IAM user and the bucket is owned by their root account
     * @param {nb.Account} account
     * @param {nb.Bucket} bucket
     * @returns {boolean}
     */
    is_iam_and_same_root_account_owner(account, bucket) {
        if (!account?.owner || !bucket?.owner_account?.id) return false;
        return account.owner === bucket.owner_account.id;
    }

    /**
     * has_bucket_ownership_permission returns true if the account can list the bucket in ListBuckets operation
     *
     * aws-compliant behavior:
     * - Root accounts can list buckets they own
     * - IAM users can list their owner buckets
     *
     * @param {nb.Bucket} bucket
     * @param {nb.Account} account
     * @returns {boolean}
     */
    has_bucket_ownership_permission(bucket, account) {
        // check direct ownership
        if (this.is_bucket_owner(bucket, account)) return true;

        // special case: iam user can list the buckets of their owner
        if (this.is_iam_and_same_root_account_owner(account, bucket)) return true;

        return false;
    }

    async has_bucket_action_permission(bucket, account, action, bucket_path = "") {
        dbg.log1('has_bucket_action_permission:', bucket.name.unwrap(), account.name.unwrap(), account._id, bucket.bucket_owner.unwrap());

        // system_owner is deprecated since version 5.18, so we don't need to check it

        // check ownership: direct owner or IAM user inheritance
        const is_owner = this.is_bucket_owner(bucket, account);

        const bucket_policy = bucket.s3_policy;

        if (!bucket_policy) {
            // in case we do not have bucket policy
            // we allow IAM account to access a bucket that that is owned by their root account
            return is_owner || this.is_iam_and_same_root_account_owner(account, bucket);
        }
        if (!action) {
            throw new Error('has_bucket_action_permission: action is required');
        }

        let permission_by_name;
        const permission_by_id = await bucket_policy_utils.has_bucket_policy_permission(
            bucket_policy,
            account._id,
            action,
            `arn:aws:s3:::${bucket.name.unwrap()}${bucket_path}`,
            undefined,
            { disallow_public_access: bucket.public_access_block?.restrict_public_buckets }
        );
        if (permission_by_id === "DENY") return false;
        // we (currently) allow account identified to be both id and name,
        // so if by-id failed, try also name
        if (account.owner === undefined) {
            permission_by_name = await bucket_policy_utils.has_bucket_policy_permission(
                bucket_policy,
                account.name.unwrap(),
                action,
                `arn:aws:s3:::${bucket.name.unwrap()}${bucket_path}`,
                undefined,
                { disallow_public_access: bucket.public_access_block?.restrict_public_buckets }
            );
        }
        if (permission_by_name === 'DENY') return false;
        return is_owner || (permission_by_id === 'ALLOW' || permission_by_name === 'ALLOW');
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
        if (!account || !account.nsfs_account_config || (account.nsfs_account_config.uid === undefined) ||
            (account.nsfs_account_config.gid === undefined)) return false;
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
}

module.exports = BucketSpaceFS;
