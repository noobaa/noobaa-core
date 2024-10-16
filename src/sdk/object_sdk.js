/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const path = require('path');
const stream = require('stream');
require('../util/dotenv').load();

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const LRUCache = require('../util/lru_cache');
const cloud_utils = require('../util/cloud_utils');
const http_utils = require('../util/http_utils');
const size_utils = require('../util/size_utils');
const native_fs_utils = require('../util/native_fs_utils');
const signature_utils = require('../util/signature_utils');
const NamespaceNB = require('./namespace_nb');
const NamespaceFS = require('./namespace_fs');
const NamespaceS3 = require('./namespace_s3');
const NamespaceGCP = require('./namespace_gcp');
const NamespaceBlob = require('./namespace_blob');
const NamespaceMerge = require('./namespace_merge');
const NamespaceCache = require('./namespace_cache');
const NamespaceMultipart = require('./namespace_multipart');
const NamespaceNetStorage = require('./namespace_net_storage');
const BucketSpaceNB = require('./bucketspace_nb');
const { RpcError } = require('../rpc');

const anonymous_access_key = Symbol('anonymous_access_key');
const bucket_namespace_cache = new LRUCache({
    name: 'ObjectSDK-Bucket-Namespace-Cache',
    // This is intentional. Cache entry expiration is handled by _validate_bucket_namespace().
    // The expiration time is controlled by config.OBJECT_SDK_BUCKET_CACHE_EXPIRY_MS.
    expiry_ms: 0,
    max_usage: 1000,
    /**
     * Set type for the generic template
     * @param {{
     *      name: string;
     *      sdk: ObjectSDK;
     * }} params
     */
    make_key: params => params.name,
    load: params => params.sdk._load_bucket_namespace(params),
    validate: (data, params) => params.sdk._validate_bucket_namespace(data, params),
});

const account_cache = new LRUCache({
    name: 'AccountCache',
    // TODO: Decide on a time that we want to invalidate
    expiry_ms: Number(process.env.ACCOUNTS_CACHE_EXPIRY) || 10 * 60 * 1000,
    /**
     * Set type for the generic template
     * @param {{
     *      access_key: string;
     *      bucketspace: nb.BucketSpace;
     * }} params
     */
    make_key: ({ access_key }) => access_key,
    load: async ({ bucketspace, access_key }) => bucketspace.read_account_by_access_key({ access_key }),
});

const dn_cache = new LRUCache({
    name: 'DistinguishedNameCache',
    // TODO: Decide on a time that we want to invalidate, 1M for now
    expiry_ms: Number(process.env.DN_CACHE_EXPIRY) || 1 * 60 * 1000,
    /**
     * Set type for the generic template
     * @param {{
    *      distinguished_name: string;
    * }} params
    */
    make_key: ({ distinguished_name }) => distinguished_name,
    load: async ({ distinguished_name }) => native_fs_utils.get_user_by_distinguished_name({ distinguished_name }),
 });

const MULTIPART_NAMESPACES = [
    'NET_STORAGE'
];
const required_obj_properties = ['obj_id', 'bucket', 'key', 'size', 'content_type', 'etag'];

class ObjectSDK {

    /**
     * @param {{
     *      rpc_client: nb.APIClient;
     *      internal_rpc_client: nb.APIClient;
     *      object_io: import('./object_io');
     *      bucketspace?: nb.BucketSpace;
     *      stats?: import('./endpoint_stats_collector').EndpointStatsCollector;
     * }} args
     */
    constructor({ rpc_client, internal_rpc_client, object_io, bucketspace, stats }) {
        this.auth_token = undefined;
        this.requesting_account = undefined;
        this.rpc_client = rpc_client;
        this.internal_rpc_client = internal_rpc_client;
        this.object_io = object_io;
        this.stats = stats;
        this.bucketspace = bucketspace || new BucketSpaceNB({ rpc_client, internal_rpc_client });
        this.abort_controller = new AbortController();
    }

    /**
     * setup_abort_controller adds event handlers to the http request and response,
     * in order to handle aborting requests gracefully. The `abort_controller` member will
     * be used to signal async flows that abort was detected.
     * @see {@link https://nodejs.org/docs/latest/api/globals.html#class-abortcontroller}
     * @param {import('http').IncomingMessage} req
     * @param {import('http').ServerResponse} res
     */
    setup_abort_controller(req, res) {
        res.once('error', err => {
            dbg.log0('response error:', err, req.url);
            this.abort_controller.abort(err);
        });

        req.once('error', err => {
            dbg.log0('request error:', err, req.url);
            this.abort_controller.abort(err);
        });

        // TODO: aborted event is being deprecated since nodejs 16
        // https://nodejs.org/dist/latest-v16.x/docs/api/http.html#event-aborted recommends on listening to close event
        // req.once('close', () => {
        //     dbg.log0('request aborted1', req.url);

        //     if (req.destroyed) {
        //         dbg.log0('request aborted', req.url);
        //         this.abort_controller.abort(new Error('request aborted ' + req.url));
        //     }
        // });

        req.once('aborted', () => {
            dbg.log0('request aborted', req.url);
            this.abort_controller.abort(new Error('request aborted ' + req.url));
        });
    }

    throw_if_aborted() {
        if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
    }

    add_abort_handler(handler) {
        const s = this.abort_controller.signal;
        if (s.aborted) {
            setImmediate(handler);
        } else {
            s.addEventListener('abort', handler, { once: true });
        }
    }

    /**
     * @returns {nb.BucketSpace}
     */
    _get_bucketspace() {
        return this.bucketspace;
    }

    /**
     * @param {string} name
     * @returns {Promise<nb.Namespace>}
     */
    async _get_bucket_namespace(name) {
        const { ns } = await bucket_namespace_cache.get_with_cache({ sdk: this, name });
        return ns;
    }

    async read_bucket_sdk_website_info(name) {
        const { bucket } = await bucket_namespace_cache.get_with_cache({ sdk: this, name });
        return bucket.website;
    }

    async read_bucket_sdk_namespace_info(name) {
        const { bucket } = await bucket_namespace_cache.get_with_cache({ sdk: this, name });
        return bucket.namespace;
    }

    async read_bucket_sdk_config_info(name) {
        const { bucket } = await bucket_namespace_cache.get_with_cache({ sdk: this, name });
        return bucket;
    }

    async read_bucket_sdk_caching_info(name) {
        try {
            const { bucket } = await bucket_namespace_cache.get_with_cache({ sdk: this, name });
            return bucket.namespace ? bucket.namespace.caching : undefined;
        } catch (error) {
            dbg.error('read_bucket_sdk_caching_info error', error);
        }
    }

    async read_bucket_sdk_policy_info(name) {
        const { bucket } = await bucket_namespace_cache.get_with_cache({ sdk: this, name });
        const policy_info = {
            s3_policy: bucket.s3_policy,
            system_owner: bucket.system_owner, // note that bucketspace_fs currently doesn't return system_owner
            bucket_owner: bucket.bucket_owner,
            owner_account: bucket.owner_account, // in NC NSFS this is the account id that owns the bucket
        };
        return policy_info;
    }

    async read_bucket_usage_info(name) {
        const { bucket } = await bucket_namespace_cache.get_with_cache({ sdk: this, name });
        return bucket.bucket_info.data;
    }

    async read_bucket_full_info(name) {
        return bucket_namespace_cache.get_with_cache({ sdk: this, name });
    }

    async load_requesting_account(req) {
        try {
            const token = this.get_auth_token();
            if (this._get_bucketspace().is_nsfs_containerized_user_anonymous(token)) return;
            this.requesting_account = await account_cache.get_with_cache({
                bucketspace: this._get_bucketspace(),
                access_key: token ? token.access_key : anonymous_access_key,
            });
            if (this.requesting_account?.nsfs_account_config?.distinguished_name) {
                const distinguished_name = this.requesting_account.nsfs_account_config.distinguished_name.unwrap();
                const user = await dn_cache.get_with_cache({
                    bucketspace: this._get_bucketspace(),
                    distinguished_name,
                });
                this.requesting_account.nsfs_account_config.uid = user.uid;
                this.requesting_account.nsfs_account_config.gid = user.gid;
            }
        } catch (error) {
            dbg.error('load_requesting_account error:', error);
            if (error.rpc_code === 'NO_SUCH_ACCOUNT') throw new RpcError('INVALID_ACCESS_KEY_ID', `Account with access_key not found`);
            if (error.rpc_code === 'NO_SUCH_USER') throw new RpcError('UNAUTHORIZED', `Distinguished name associated with access_key not found`);
            throw error;
        }
    }

    async authorize_request_account(req) {
        const { bucket } = req.params;
        const token = this.get_auth_token();
        // If the request is signed (authenticated)
        if (token) {
            signature_utils.authorize_request_account_by_token(token, this.requesting_account);
        }
        // check for a specific bucket
        if (bucket && req.op_name !== 'put_bucket') {
            // ANONYMOUS: cannot work without bucket.
            // Return if the acount is anonymous
            if (this._get_bucketspace().is_nsfs_non_containerized_user_anonymous(token)) return;
            const ns = await this.read_bucket_sdk_namespace_info(bucket);
            if (!token) {
                // TODO: Anonymous access to namespace buckets not supported for containerized Noobaa
                if (ns) {
                    throw new RpcError('UNAUTHORIZED', `Anonymous access to namespace buckets not supported`);
                } else {
                    // TODO: Handle bucketspace operations / RPC auth (i.e system, account, anonymous) and anonymous access
                    return;
                }
            }
            if (!this.has_non_nsfs_bucket_access(this.requesting_account, ns)) {
                throw new RpcError('UNAUTHORIZED', `No permission to access bucket`);
            }
        }
    }

    is_nsfs_bucket(ns) {
        const fs_root_path = ns?.write_resource?.resource?.fs_root_path;
        return Boolean(fs_root_path || fs_root_path === '');
    }

    // validates requests for non nsfs buckets from accounts which are nsfs_only
    has_non_nsfs_bucket_access(account, ns) {
        dbg.log1('validate_non_nsfs_bucket: ', account, ns?.write_resource?.resource);
        if (!account) return false;
        if (this.is_nsfs_bucket(ns) ||
            !account.nsfs_account_config || !account.nsfs_account_config.nsfs_only) return true;
        // nsfs only = true, allow nsfs buckets only
        return false;
    }

    async _load_bucket_namespace(params) {
        // params.bucket might be added by _validate_bucket_namespace
        const bucket = params.bucket || await this._get_bucketspace().read_bucket_sdk_info({ name: params.name });
        return this._setup_bucket_namespace(bucket);
    }

    async _validate_bucket_namespace(data, params) {
        const time = Date.now();
        if (time <= data.valid_until) return true;
        const bucket = await this._get_bucketspace().read_bucket_sdk_info({ name: params.name });
        if (_.isEqual(bucket, data.bucket)) {
            // namespace unchanged - extend validity for another period
            data.valid_until = time + config.OBJECT_SDK_BUCKET_CACHE_EXPIRY_MS;
            return true;
        } else {
            // namespace changed - _load_bucket_namespace will be called by the cache
            // hang the new bucket on the cache params to reuse it
            params.bucket = bucket;
            return false;
        }
    }

    /**
     * @returns {{
     *      ns: nb.Namespace;
     *      bucket: object;
     *      valid_until: number;
     * }}
     */
    _setup_bucket_namespace(bucket) {
        const time = Date.now();
        dbg.log1('_load_bucket_namespace', bucket);
        try {
            if (bucket.namespace) {

                if (bucket.namespace.caching) {
                    const namespace_nb = new NamespaceNB();
                    const namespace_hub = this._setup_single_namespace(bucket.namespace.read_resources[0]);
                    const namespace_cache = new NamespaceCache({
                        namespace_hub,
                        namespace_nb,
                        active_triggers: bucket.active_triggers,
                        caching: bucket.namespace.caching,
                        stats: this.stats,
                    });
                    return {
                        ns: namespace_cache,
                        bucket,
                        valid_until: time + config.OBJECT_SDK_BUCKET_CACHE_EXPIRY_MS,
                    };
                }
                if (this._is_single_namespace(bucket.namespace)) {
                    return {
                        ns: this._setup_single_namespace(
                            bucket.namespace.read_resources[0],
                            bucket._id,
                            {
                                versioning: bucket.bucket_info && bucket.bucket_info.versioning,
                                force_md5_etag: bucket.force_md5_etag
                            },
                        ),
                        bucket,
                        valid_until: time + config.OBJECT_SDK_BUCKET_CACHE_EXPIRY_MS,
                    };
                }
                // MERGE NAMESPACE
                return {
                    ns: this._setup_merge_namespace(bucket),
                    bucket,
                    valid_until: time + config.OBJECT_SDK_BUCKET_CACHE_EXPIRY_MS,
                };
            }

        } catch (err) {
            dbg.error('Failed to setup bucket namespace (fallback to no namespace)', err);
        }

        // non-namespace buckets
        const namespace_nb = new NamespaceNB();
        namespace_nb.set_triggers_for_bucket(bucket.name.unwrap(), bucket.active_triggers);
        return {
            ns: namespace_nb,
            bucket,
            valid_until: time + config.OBJECT_SDK_BUCKET_CACHE_EXPIRY_MS,
        };
    }

    /**
     * @returns {nb.Namespace}
     */
    _setup_merge_namespace(bucket) {
        const rr = _.cloneDeep(bucket.namespace.read_resources);

        /** @type {nb.Namespace} */
        let wr = bucket.namespace.write_resource && this._setup_single_namespace(bucket.namespace.write_resource);

        if (MULTIPART_NAMESPACES.includes(bucket.namespace.write_resource?.resource.endpoint_type)) {
            const wr_index = rr.findIndex(r => _.isEqual(r, bucket.namespace.write_resource.resource));
            // @ts-ignore
            wr = new NamespaceMultipart(
                this._setup_single_namespace(bucket.namespace.write_resource),
                new NamespaceNB());
            rr.splice(wr_index, 1, {
                endpoint_type: 'MULTIPART',
                ns: wr
            });
        }

        return new NamespaceMerge({
            namespaces: {
                write_resource: wr,
                read_resources: _.map(rr, it => (
                    it.resource.endpoint_type === 'MULTIPART' ?
                        it.ns :
                        this._setup_single_namespace(it)
                ))
            },
            active_triggers: bucket.active_triggers
        });
    }

    /**
     * @returns {nb.Namespace}
     */
    _setup_single_namespace({ resource: r, path: p }, bucket_id, options) {

        if (r.endpoint_type === 'NOOBAA') {
            if (r.target_bucket) {
                return new NamespaceNB(r.target_bucket);
            } else {
                return new NamespaceNB();
            }
        }
        if (r.endpoint_type === 'AWSSTS' ||
            r.endpoint_type === 'AWS' ||
            r.endpoint_type === 'S3_COMPATIBLE' ||
            r.endpoint_type === 'FLASHBLADE' ||
            r.endpoint_type === 'IBM_COS') {

            const agent = r.endpoint_type === 'AWS' ?
                http_utils.get_default_agent(r.endpoint) :
                http_utils.get_unsecured_agent(r.endpoint);

            return new NamespaceS3({
                namespace_resource_id: r.id,
                s3_params: {
                    params: { Bucket: r.target_bucket },
                    endpoint: r.endpoint,
                    aws_sts_arn: r.aws_sts_arn,
                    accessKeyId: r.access_key.unwrap(),
                    secretAccessKey: r.secret_key.unwrap(),
                    // region: 'us-east-1', // TODO needed?
                    signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(r.endpoint, r.auth_method),
                    s3ForcePathStyle: true,
                    // computeChecksums: false, // disabled by default for performance
                    httpOptions: { agent },
                    access_mode: r.access_mode
                },
                stats: this.stats,
            });
        }
        if (r.endpoint_type === 'AZURE') {
            return new NamespaceBlob({
                namespace_resource_id: r.id,
                container: r.target_bucket,
                connection_string: cloud_utils.get_azure_new_connection_string(r),
                // Azure storage account name is stored as the access key.
                account_name: r.access_key.unwrap(),
                account_key: r.secret_key.unwrap(),
                access_mode: r.access_mode,
                stats: this.stats,
            });
        }
        if (r.endpoint_type === 'GOOGLE') {
            const { project_id, private_key, client_email } = JSON.parse(r.secret_key.unwrap());
            return new NamespaceGCP({
                namespace_resource_id: r.id,
                target_bucket: r.target_bucket,
                project_id,
                client_email,
                private_key,
                access_mode: r.access_mode,
                stats: this.stats,
            });
        }
        if (r.fs_root_path || r.fs_root_path === '') {
            return new NamespaceFS({
                fs_backend: r.fs_backend,
                bucket_path: path.join(r.fs_root_path, p || ''),
                bucket_id: String(bucket_id),
                namespace_resource_id: r.id,
                access_mode: r.access_mode,
                versioning: options && options.versioning,
                stats: this.stats,
                force_md5_etag: options && options.force_md5_etag,
            });
        }
        // TODO: Should convert to cp_code and target_bucket as folder inside
        // Did not do that yet because we do not understand how deep listing works
        if (r.endpoint_type === 'NET_STORAGE') {
            // @ts-ignore
            return new NamespaceNetStorage({
                // This is the endpoint
                hostname: r.endpoint,
                // This is the access key
                keyName: r.access_key,
                // This is the secret key
                key: r.secret_key,
                // Should be the target bucket regarding the S3 storage
                cpCode: r.target_bucket,
                // Just used that in order to not handle certificate mess
                // TODO: Should I use SSL with HTTPS instead of HTTP?
                ssl: false
            });
        }
        throw new Error('Unrecognized namespace endpoint type ' + r.endpoint_type);
    }

    set_auth_token(auth_token) {
        this.auth_token = auth_token;
        if (this.rpc_client) this.rpc_client.options.auth_token = auth_token;
    }

    get_auth_token() {
        return this.auth_token;
    }

    _check_is_readonly_namespace(ns) {
        if (ns.is_readonly_namespace()) {
            throw new RpcError('UNAUTHORIZED', `Read Only namespace bucket`);
        }
    }

    _is_single_namespace(ns_info) {
        if (!ns_info.write_resource && ns_info.read_resources.length() === 1) {
            return true;
        }
        if (ns_info.write_resource && _.isEqual(ns_info.read_resources, [ns_info.write_resource])) {
            return true;
        }
        return false;
    }

    /**
     * Calls the op and report time and error to stats collector.
     * on_success can be added to update read/write stats (but on_success shouln't throw)
     *
     * @template T
     * @param {{
     *      op_name: string;
     *      op_func: () => Promise<T>;
     *      on_success?: () => void;
     * }} params
     * @returns {Promise<T>}
     */
    async _call_op_and_update_stats({ op_name, op_func, on_success = undefined }) {
        const start_time = Date.now();
        let error = 0;
        try {
            // cannot just return the promise from inside this try scope
            // because rejections will not be caught unless we await.
            // we could use `return await ...` too but wanted to make it more explicit.
            const reply = await op_func();
            if (on_success) on_success();
            return reply;
        } catch (e) {
            error = 1;
            throw e;
        } finally {
            this.stats?.update_ops_counters({
                time: Date.now() - start_time,
                op_name,
                error,
            });
        }
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params) {
        return this._call_op_and_update_stats({
            op_name: 'list_objects',
            op_func: async () => {
                const ns = await this._get_bucket_namespace(params.bucket);
                return ns.list_objects(params, this);
            },
        });
    }

    async list_uploads(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.list_uploads(params, this);
    }

    async list_object_versions(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.list_object_versions(params, this);
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    async read_object_md(params) {
        return this._call_op_and_update_stats({
            op_name: 'head_object',
            op_func: async () => {
                const ns = await this._get_bucket_namespace(params.bucket);
                return ns.read_object_md(params, this);
            },
        });
    }

    async read_object_stream(params, res) {
        return this._call_op_and_update_stats({
            op_name: 'read_object',
            op_func: async () => {
                const ns = await this._get_bucket_namespace(params.bucket);
                return ns.read_object_stream(params, this, res);
            },
            on_success: () => {
                this.stats?.update_bucket_read_counters({
                    bucket_name: params.bucket,
                    key: params.key,
                    content_type: params.content_type
                });
            },
        });
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////


    // if upload is using a copy source fix the params according to source and target real location
    async fix_copy_source_params(params, target_ns) {
        const { bucket, key, version_id, encryption } = params.copy_source;
        const source_params = { bucket, key, version_id, md_conditions: params.source_md_conditions, encryption };

        // get the namespace for source bucket
        const source_ns = await this._get_bucket_namespace(bucket);
        const source_md = await source_ns.read_object_md(source_params, this);
        const ranges = http_utils.normalize_http_ranges(
            params.copy_source.ranges, source_md.size, true);
        // For ranged copy we don't have the specific range hashes
        // For non-ranged copy we can verify the content hash on the target object/multipart
        if (ranges) {
            params.size = undefined;
            params.md5_b64 = undefined;
            params.sha256_b64 = undefined;
        } else {
            params.size = source_md.size;
            params.md5_b64 = source_md.md5_b64;
            params.sha256_b64 = source_md.sha256_b64;
        }
        if (!params.content_type && source_md.content_type) params.content_type = source_md.content_type;
        if (params.xattr_copy) {
            params.xattr = source_md.xattr;
            params.content_type = source_md.content_type;
        }
        try {
            //omitBy iterates all xattr calling startsWith on them. this can include symbols such as XATTR_SORT_SYMBOL.
            //in that case startsWith will not apply
            if (params.xattr) params.xattr = _.omitBy(params.xattr, (val, name) => name.startsWith?.('noobaa-namespace'));
        } catch (e) {
            dbg.log3("Got an error while trying to omitBy param.xattr:", params.xattr, "error:", e);
        }
        if (params.tagging_copy) params.tagging = source_md.tagging;

        // check if source and target are the same and can handle server side copy
        // take the actual namespace of the bucket either from md (in case of S3\Blob) or source_ns itself
        const actual_source_ns = source_md.ns || source_ns;
        const actual_target_ns = target_ns.get_write_resource();

        if (actual_target_ns.is_server_side_copy(actual_source_ns, source_md, params)) {
            // fix copy_source in params to point to the correct cloud bucket
            params.copy_source.bucket = actual_source_ns.get_bucket(bucket);
            params.copy_source.obj_id = source_md.obj_id;
            params.copy_source.version_id = source_md.version_id;
        } else {
            // source cannot be copied directly (different plaforms, accounts, etc.)
            // set the source_stream to read from the copy source
            // Source params need these for read operations
            source_params.object_md = source_md;
            source_params.obj_id = source_md.obj_id;
            source_params.version_id = source_md.version_id;
            source_params.bucket = actual_source_ns.get_bucket(bucket);
            // param size is needed when doing an upload. Can be overrided during ranged writes
            params.size = source_md.size;

            if (ranges) {
                if (ranges.length !== 1) throw new Error('fix_copy_source_params: multiple ranges not supported');
                source_params.start = ranges[0].start;
                source_params.end = ranges[0].end;
                // Update the param size with the ranges to be written
                params.size = source_params.end - source_params.start;
            }

            // if the source namespace is NSFS then we need to pass the read_object_stream the read_stream
            if (source_ns instanceof NamespaceFS) {
                if (target_ns instanceof NamespaceFS) {
                    params.source_ns = actual_source_ns;
                    params.source_params = source_params;
                } else {
                    //this._populate_nsfs_copy_fallback({ source_params, source_ns, params });
                    throw new Error('TODO fix _populate_nsfs_copy_fallback');
                }
            } else {
                params.source_stream = await source_ns.read_object_stream(source_params, this);
            }
            if (params.size > (100 * size_utils.MEGABYTE)) {
                dbg.warn(`upload_object with copy_sources - copying by reading source first (not server side)
                so it can take some time and cause client timeouts`);
            }
            if (params.tagging_copy) {
                await this._populate_source_object_tagging({ source_params, source_ns, source_md });
                params.tagging = source_md.tagging;
            }
            // reset the copy_source param
            params.copy_source = null;
        }
    }

    // nsfs copy_object & server side copy consisted of link and a fallback to
    // read stream and then upload stream
    // nsfs copy object when can't server side copy - fallback directly
    _populate_nsfs_copy_fallback({ source_ns, params, source_params }) {
        const read_stream = new stream.PassThrough();
        source_ns.read_object_stream(source_params, this, read_stream)
            .catch(err => read_stream.emit('error', err));
        params.source_stream = read_stream;
    }

    async _populate_source_object_tagging({ source_ns, source_md, source_params }) {
        // This is a quick way of knowing if we should load any tags
        if (!source_md.tag_count && !source_params.tag_count) return;
        // In NooBaa namespace we already populate the tags
        if (source_md.tagging) return;
        // In case of other namespace we need to read the tags
        const object_tagging = await source_ns.get_object_tagging(source_params, this);
        source_md.tagging = object_tagging.tagging;
    }

    async upload_object(params) {
        return this._call_op_and_update_stats({
            op_name: 'upload_object',
            op_func: async () => {
                const ns = await this._get_bucket_namespace(params.bucket);
                this._check_is_readonly_namespace(ns);
                if (params.copy_source) await this.fix_copy_source_params(params, ns);
                return ns.upload_object(params, this);
            },
            on_success: () => {
                this.stats?.update_bucket_write_counters({
                    bucket_name: params.bucket,
                    key: params.key,
                    content_type: params.content_type
                });
            },
        });
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    async create_object_upload(params) {
        return this._call_op_and_update_stats({
            op_name: 'initiate_multipart',
            op_func: async () => {
                const ns = await this._get_bucket_namespace(params.bucket);
                this._check_is_readonly_namespace(ns);
                return ns.create_object_upload(params, this);
            },
            on_success: () => {
                this.stats?.update_bucket_write_counters({
                    bucket_name: params.bucket,
                    key: params.key,
                    content_type: params.content_type
                });
            },
        });
    }

    async upload_multipart(params) {
        return this._call_op_and_update_stats({
            op_name: 'upload_part',
            op_func: async () => {
                const ns = await this._get_bucket_namespace(params.bucket);
                this._check_is_readonly_namespace(ns);
                if (params.copy_source) await this.fix_copy_source_params(params, ns);
                return ns.upload_multipart(params, this);
            },
        });
    }

    async list_multiparts(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.list_multiparts(params, this);
    }

    async complete_object_upload(params) {
        return this._call_op_and_update_stats({
            op_name: 'complete_object_upload',
            op_func: async () => {
                const ns = await this._get_bucket_namespace(params.bucket);
                this._check_is_readonly_namespace(ns);
                return ns.complete_object_upload(params, this);
            },
        });
    }

    async abort_object_upload(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        this._check_is_readonly_namespace(ns);
        return ns.abort_object_upload(params, this);
    }


    ////////////////////////
    // BLOCK BLOB UPLOADS //
    ////////////////////////

    async upload_blob_block(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        this._check_is_readonly_namespace(ns);
        return ns.upload_blob_block(params, this);
    }

    async commit_blob_block_list(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        this._check_is_readonly_namespace(ns);
        return ns.commit_blob_block_list(params, this);
    }

    async get_blob_block_lists(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        this._check_is_readonly_namespace(ns);
        return ns.get_blob_block_lists(params, this);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params) {
        return this._call_op_and_update_stats({
            op_name: 'delete_object',
            op_func: async () => {
                const ns = await this._get_bucket_namespace(params.bucket);
                this._check_is_readonly_namespace(ns);
                return ns.delete_object(params, this);
            },
        });
    }

    async delete_multiple_objects(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        this._check_is_readonly_namespace(ns);
        return ns.delete_multiple_objects(params, this);
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    async put_object_tagging(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        this._check_is_readonly_namespace(ns);
        return ns.put_object_tagging(params, this);
    }

    async delete_object_tagging(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        this._check_is_readonly_namespace(ns);
        return ns.delete_object_tagging(params, this);
    }

    async get_object_tagging(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.get_object_tagging(params, this);
    }

    ////////////////////
    // OBJECT RESTORE //
    ////////////////////

    async restore_object(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.restore_object(params, this);
    }

    ////////////
    // BUCKET //
    ////////////

    async list_buckets() {
        return this._call_op_and_update_stats({
            op_name: 'list_buckets',
            op_func: async () => {
                const bs = this._get_bucketspace();
                return bs.list_buckets(this);
            },
        });
    }

    async read_bucket(params) {
        const bs = this._get_bucketspace();
        return bs.read_bucket(params);
    }

    async create_bucket(params) {
        return this._call_op_and_update_stats({
            op_name: 'create_bucket',
            op_func: async () => {
                const bs = this._get_bucketspace();
                return bs.create_bucket(params, this);
            },
        });
    }

    async delete_bucket(params) {
        return this._call_op_and_update_stats({
            op_name: 'delete_bucket',
            op_func: async () => {
                const bs = this._get_bucketspace();
                return bs.delete_bucket(params, this);
            },
        });
    }

    //////////////////////
    // BUCKET LIFECYCLE //
    //////////////////////

    get_bucket_lifecycle_configuration_rules(params) {
        const bs = this._get_bucketspace();
        return bs.get_bucket_lifecycle_configuration_rules(params);
    }

    set_bucket_lifecycle_configuration_rules(params) {
        const bs = this._get_bucketspace();
        return bs.set_bucket_lifecycle_configuration_rules(params);
    }

    delete_bucket_lifecycle(params) {
        const bs = this._get_bucketspace();
        return bs.delete_bucket_lifecycle(params);
    }

    ///////////////////////
    // BUCKET VERSIONING //
    ///////////////////////

    async set_bucket_versioning(params) {
        const bs = this._get_bucketspace();
        return bs.set_bucket_versioning(params, this);
    }

    ////////////////////
    // BUCKET TAGGING //
    ////////////////////

    async put_bucket_tagging(params) {
        const bs = this._get_bucketspace();
        return bs.put_bucket_tagging(params);
    }

    async delete_bucket_tagging(params) {
        const bs = this._get_bucketspace();
        return bs.delete_bucket_tagging(params);
    }

    async get_bucket_tagging(params) {
        const bs = this._get_bucketspace();
        return bs.get_bucket_tagging(params);
    }

    ////////////////////
    // BUCKET LOGGING //
    ////////////////////

    async put_bucket_logging(params) {
        const bs = this._get_bucketspace();
        return bs.put_bucket_logging(params);
    }

    async delete_bucket_logging(params) {
        const bs = this._get_bucketspace();
        return bs.delete_bucket_logging(params);
    }

    async get_bucket_logging(params) {
        const bs = this._get_bucketspace();
        return bs.get_bucket_logging(params);
    }

    ///////////////////////
    // BUCKET ENCRYPTION //
    ///////////////////////

    async put_bucket_encryption(params) {
        const bs = this._get_bucketspace();
        return bs.put_bucket_encryption(params);
    }

    async delete_bucket_encryption(params) {
        const bs = this._get_bucketspace();
        return bs.delete_bucket_encryption(params);
    }

    async get_bucket_encryption(params) {
        const bs = this._get_bucketspace();
        return bs.get_bucket_encryption(params);
    }

    ////////////////////
    // BUCKET WEBSITE //
    ////////////////////

    async put_bucket_website(params) {
        const bs = this._get_bucketspace();
        return bs.put_bucket_website(params);
    }

    async delete_bucket_website(params) {
        const bs = this._get_bucketspace();
        return bs.delete_bucket_website(params);
    }

    async get_bucket_website(params) {
        const bs = this._get_bucketspace();
        return bs.get_bucket_website(params);
    }

    ////////////////////
    // BUCKET POLICY  //
    ////////////////////

    async put_bucket_policy(params) {
        const bs = this._get_bucketspace();
        const result = await bs.put_bucket_policy(params);
        bucket_namespace_cache.invalidate_key(params.name);
        return result;
    }

    async delete_bucket_policy(params) {
        const bs = this._get_bucketspace();
        bucket_namespace_cache.invalidate_key(params.name);
        return bs.delete_bucket_policy(params);
    }

    async get_bucket_policy(params) {
        const bs = this._get_bucketspace();
        bucket_namespace_cache.invalidate_key(params.name);
        return bs.get_bucket_policy(params, this);
    }

    should_run_triggers({ active_triggers, operation, obj }) {
        return _.some(active_triggers, trigger => {
            const { event_name, object_suffix, object_prefix } = trigger;
            if (event_name !== operation) return false;
            // When we do not provide the object we just check if we shall load the objects
            // This is a case in order to avoid read_object_mds flow to happen always
            if (obj && object_prefix && !obj.key.startsWith(object_prefix)) return false;
            if (obj && object_suffix && !obj.key.endsWith(object_suffix)) return false;
            return true;
        });
    }

    async dispatch_triggers({ active_triggers, obj, operation, bucket }) {
        const dispatch = this.should_run_triggers({ active_triggers, obj, operation });
        if (dispatch) {
            const dispatch_obj = _.pick(obj, required_obj_properties);
            // Dummy obj_id (not all flows return with obj_id and we need it for the API schema)
            dispatch_obj.obj_id = '10101010aaaabbbbccccdddd';
            await this.internal_rpc_client.object.dispatch_triggers({
                bucket,
                event_name: operation,
                obj: dispatch_obj
            });
        }
    }

    /////////////////////////
    // BUCKET NOTIFICATION //
    /////////////////////////

    async put_bucket_notification(params) {
        const bs = this._get_bucketspace();
        const res = bs.put_bucket_notification(params);
        bucket_namespace_cache.invalidate_key(params.bucket_name);
        return res;
    }

    async get_bucket_notification(params) {
        const { bucket } = await bucket_namespace_cache.get_with_cache({ sdk: this, name: params.bucket_name });
        return bucket.notifications;
    }

    ////////////////////
    //  OBJECT LOCK   //
    ////////////////////

    async get_object_lock_configuration(params) {
        const bs = this._get_bucketspace();
        return bs.get_object_lock_configuration(params, this);
    }

    async put_object_lock_configuration(params) {
        const bs = this._get_bucketspace();
        return bs.put_object_lock_configuration(params, this);
    }
    async get_object_legal_hold(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.get_object_legal_hold(params, this);
    }

    async put_object_legal_hold(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.put_object_legal_hold(params, this);
    }
    async get_object_retention(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.get_object_retention(params, this);
    }

    async put_object_retention(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.put_object_retention(params, this);
    }

    ////////////////////
    //  OBJECT ACLS   //
    ////////////////////

    async get_object_acl(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.get_object_acl(params, this);
    }

    async put_object_acl(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        this._check_is_readonly_namespace(ns);
        return ns.put_object_acl(params, this);
    }
}

// EXPORT
module.exports = {
    ObjectSDK,
    anonymous_access_key: anonymous_access_key,
    account_cache: account_cache,
    dn_cache: dn_cache,
};

module.exports = ObjectSDK;
module.exports.anonymous_access_key = anonymous_access_key;
module.exports.account_cache = account_cache;
module.exports.dn_cache = dn_cache;
