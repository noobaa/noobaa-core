/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
require('../util/dotenv').load();

// const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const LRUCache = require('../util/lru_cache');
const cloud_utils = require('../util/cloud_utils');
const http_utils = require('../util/http_utils');
const size_utils = require('../util/size_utils');
const signature_utils = require('../util/signature_utils');
const NamespaceNB = require('./namespace_nb');
const NamespaceS3 = require('./namespace_s3');
const NamespaceBlob = require('./namespace_blob');
const NamespaceMerge = require('./namespace_merge');
const NamespaceCache = require('./namespace_cache');
const NamespaceMultipart = require('./namespace_multipart');
const NamespaceNetStorage = require('./namespace_net_storage');
const AccountSpaceNetStorage = require('./accountspace_net_storage');
const AccountSpaceNB = require('./accountspace_nb');
const stats_collector = require('./endpoint_stats_collector');
const { RpcError } = require('../rpc');

const bucket_namespace_cache = new LRUCache({
    name: 'ObjectSDK-Bucket-Namespace-Cache',
    expiry_ms: 0,
    max_usage: 1000,
    make_key: params => params.name,
    load: params => params.sdk._load_bucket_namespace(params),
    validate: (data, params) => params.sdk._validate_bucket_namespace(data, params),
});

const account_cache = new LRUCache({
    name: 'AccountCache',
    // TODO: Decide on a time that we want to invalidate
    expiry_ms: 10 * 60 * 1000,
    make_key: ({ access_key }) => access_key,
    load: async ({ rpc_client, access_key }) => rpc_client.account.read_account_by_access_key({ access_key }),
});

const NAMESPACE_CACHE_EXPIRY = 60000;

const MULTIPART_NAMESPACES = [
    'NET_STORAGE'
];
const required_obj_properties = ['obj_id', 'bucket', 'key', 'size', 'content_type', 'etag'];

class ObjectSDK {

    constructor(rpc_client, internal_rpc_client, object_io) {
        this.rpc_client = rpc_client;
        this.internal_rpc_client = internal_rpc_client;
        this.object_io = object_io;
        this.namespace_nb = new NamespaceNB();
        this.accountspace_nb = new AccountSpaceNB({
            rpc_client
        });
    }

    _get_account_namespace() {
        if (process.env.AKAMAI_ACCOUNT_NS === 'true') {
            return new AccountSpaceNetStorage({
                // This is the endpoint
                hostname: process.env.AKAMAI_HOSTNAME,
                // This is the access key
                keyName: process.env.AKAMAI_KEYNAME,
                // This is the secret key
                key: process.env.AKAMAI_KEY,
                // Should be the target bucket regarding the S3 storage
                cpCode: process.env.AKAMAI_CPCODE,
                // Not sure if relevant since we always talk using HTTP
                ssl: false
            });
        }

        return this.accountspace_nb;
    }

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

    async read_bucket_sdk_policy_info(name) {
        const { bucket } = await bucket_namespace_cache.get_with_cache({ sdk: this, name });
        const policy_info = {
            s3_policy: bucket.s3_policy,
            system_owner: bucket.system_owner,
            bucket_owner: bucket.bucket_owner,
        };
        return policy_info;
    }

    async _load_bucket_namespace(params) {
        // params.bucket might be added by _validate_bucket_namespace
        const bucket = params.bucket || await this.internal_rpc_client.bucket.read_bucket_sdk_info({ name: params.name });
        return this._setup_bucket_namespace(bucket);
    }

    async authorize_request_account({ bucket, op_name }) {
        const ns = bucket && await this.read_bucket_sdk_namespace_info(bucket);
        const token = this.get_auth_token();
        if (!token) {
            // TODO: Anonymous access to namespace buckets not supported
            if (ns) throw new RpcError('NOT_IMPLEMENTED', `Anonymous access to namespace buckets not supported`);
            // TODO: Handle accountspace operations / RPC auth (i.e system, account, anonymous) and anonymous access
            else return;
        }
        let account;
        try {
            account = await account_cache.get_with_cache({
                rpc_client: this.internal_rpc_client,
                access_key: token.access_key
            });
        } catch (error) {
            dbg.error('authorize_request_account error:', error);
            throw new RpcError('INVALID_ACCESS_KEY_ID', `Account with access_key not found`);
        }
        const signature = signature_utils.get_signature_from_auth_token(token, account.access_keys[0].secret_key.unwrap());
        if (token.signature !== signature) throw new RpcError('SIGNATURE_DOES_NOT_MATCH', `Signature that was calculated did not match`);
        if (bucket) {
            const bucket_allowed = _.get(account, 'allowed_buckets.full_permission', false) ||
                _.find(
                    _.get(account, 'allowed_buckets.permission_list') || [],
                    name => name.unwrap() === bucket
                );
            if (!bucket_allowed) throw new RpcError('UNAUTHORIZED', `No permission to access bucket`);
        }
    }

    async _validate_bucket_namespace(data, params) {
        const time = Date.now();
        if (time <= data.valid_until) return true;
        const bucket = await this.internal_rpc_client.bucket.read_bucket_sdk_info({ name: params.name });
        if (_.isEqual(bucket, data.bucket)) {
            // namespace unchanged - extend validity for another period
            data.valid_until = time + NAMESPACE_CACHE_EXPIRY;
            return true;
        } else {
            // namespace changed - _load_bucket_namespace will be called by the cache
            // hang the new bucket on the cache params to reuse it
            params.bucket = bucket;
            return false;
        }
    }

    _setup_bucket_namespace(bucket) {
        const time = Date.now();
        dbg.log0('_load_bucket_namespace', util.inspect(bucket, true, null, true));
        try {
            if (bucket.namespace && bucket.namespace.read_resources && bucket.namespace.write_resource) {

                dbg.log0('_setup_bucket_namespace', bucket.namespace);
                if (bucket.namespace.caching) {
                    return {
                        ns: new NamespaceCache({
                            namespace_hub: this._setup_single_namespace(_.extend({}, bucket.namespace.write_resource)),
                            namespace_nb: this.namespace_nb,
                            active_triggers: bucket.active_triggers,
                            caching: bucket.namespace.caching,
                        }),
                        bucket,
                        valid_until: time + NAMESPACE_CACHE_EXPIRY,
                    };
                }

                // MERGE NAMESPACE
                return {
                    ns: this._setup_merge_namespace(bucket),
                    bucket,
                    valid_until: time + NAMESPACE_CACHE_EXPIRY,
                };
            }
        } catch (err) {
            dbg.error('Failed to setup bucket namespace (fallback to no namespace)', err);
        }
        this.namespace_nb.set_triggers_for_bucket(bucket.name.unwrap(), bucket.active_triggers);
        return {
            ns: this.namespace_nb,
            bucket,
            valid_until: time + NAMESPACE_CACHE_EXPIRY,
        };
    }

    _setup_merge_namespace(bucket) {
        let rr = _.cloneDeep(bucket.namespace.read_resources);
        let wr = this._setup_single_namespace(_.extend({}, bucket.namespace.write_resource));
        if (MULTIPART_NAMESPACES.includes(bucket.namespace.write_resource.endpoint_type)) {
            const wr_index = rr.findIndex(r => _.isEqual(r, bucket.namespace.write_resource));
            wr = new NamespaceMultipart(
                this._setup_single_namespace(_.extend({}, bucket.namespace.write_resource)),
                this.namespace_nb);
            rr.splice(wr_index, 1, {
                endpoint_type: 'MULTIPART',
                ns: wr
            });
        }

        return new NamespaceMerge({
            namespaces: {
                write_resource: wr,
                read_resources: _.map(rr, ns_info => (
                    ns_info.endpoint_type === 'MULTIPART' ? ns_info.ns :
                    this._setup_single_namespace(_.extend({}, ns_info))
                ))
            },
            active_triggers: bucket.active_triggers
        });
    }

    _setup_single_namespace(ns_info) {
        if (ns_info.endpoint_type === 'NOOBAA') {
            if (ns_info.target_bucket) {
                return new NamespaceNB(ns_info.target_bucket);
            } else {
                return this.namespace_nb;
            }
        }
        if (ns_info.endpoint_type === 'AWS' ||
            ns_info.endpoint_type === 'S3_COMPATIBLE' ||
            ns_info.endpoint_type === 'FLASHBLADE' ||
            ns_info.endpoint_type === 'IBM_COS') {
            const httpOptions = (ns_info.endpoint_type === 'AWS') ? undefined : {
                agent: http_utils.get_unsecured_http_agent(ns_info.endpoint)
            };
            return new NamespaceS3({
                namespace_resource_id: ns_info.id,
                rpc_client: this.rpc_client,
                s3_params: {
                    params: { Bucket: ns_info.target_bucket },
                    endpoint: ns_info.endpoint,
                    accessKeyId: ns_info.access_key.unwrap(),
                    secretAccessKey: ns_info.secret_key.unwrap(),
                    // region: 'us-east-1', // TODO needed?
                    signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(ns_info.endpoint, ns_info.auth_method),
                    s3ForcePathStyle: true,
                    // computeChecksums: false, // disabled by default for performance
                    httpOptions
                }
            });
        }
        if (ns_info.endpoint_type === 'AZURE') {
            return new NamespaceBlob({
                namespace_resource_id: ns_info.id,
                rpc_client: this.rpc_client,
                container: ns_info.target_bucket,
                connection_string: cloud_utils.get_azure_connection_string(ns_info)
            });
        }
        // TODO: Should convert to cp_code and target_bucket as folder inside
        // Did not do that yet because we do not understand how deep listing works
        if (ns_info.endpoint_type === 'NET_STORAGE') {
            return new NamespaceNetStorage({
                // This is the endpoint
                hostname: ns_info.endpoint,
                // This is the access key
                keyName: ns_info.access_key,
                // This is the secret key
                key: ns_info.secret_key,
                // Should be the target bucket regarding the S3 storage
                cpCode: ns_info.target_bucket,
                // Just used that in order to not handle certificate mess
                // TODO: Should I use SSL with HTTPS instead of HTTP?
                ssl: false
            });
        }
        throw new Error('Unrecognized namespace endpoint type ' + ns_info.endpoint_type);
    }

    set_auth_token(auth_token) {
        this.rpc_client.options.auth_token = auth_token;
        this.accountspace_nb.set_auth_token(auth_token);
    }

    get_auth_token() {
        return this.rpc_client.options.auth_token;
    }

    ////////////
    // BUCKET //
    ////////////

    async list_buckets() {
        const ns = this._get_account_namespace();
        return ns.list_buckets();
    }

    async read_bucket(params) {
        const ns = this._get_account_namespace();
        return ns.read_bucket(params);
    }

    async create_bucket(params) {
        const ns = this._get_account_namespace();
        return ns.create_bucket(params);
    }

    async delete_bucket(params) {
        const ns = this._get_account_namespace();
        return ns.delete_bucket(params);
    }

    //////////////////////
    // BUCKET LIFECYCLE //
    //////////////////////

    get_bucket_lifecycle_configuration_rules(params) {
        const ns = this._get_account_namespace();
        return ns.get_bucket_lifecycle_configuration_rules(params);
    }

    set_bucket_lifecycle_configuration_rules(params) {
        const ns = this._get_account_namespace();
        return ns.set_bucket_lifecycle_configuration_rules(params);
    }

    delete_bucket_lifecycle(params) {
        const ns = this._get_account_namespace();
        return ns.delete_bucket_lifecycle(params);
    }

    ///////////////////////
    // BUCKET VERSIONING //
    ///////////////////////

    async set_bucket_versioning(params) {
        const ns = this._get_account_namespace();
        return ns.set_bucket_versioning(params);
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.list_objects(params, this);
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
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.read_object_md(params, this);
    }

    async read_object_stream(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        const reply = await ns.read_object_stream(params, this);
        // update bucket counters
        stats_collector.instance(this.internal_rpc_client).update_bucket_read_counters({
            bucket_name: params.bucket,
            key: params.key,
            content_type: params.content_type
        });
        return reply;
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
        if (params.tagging_copy) await this._populate_source_object_tagging({ source_params, source_ns, source_md });
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
        if (params.xattr) params.xattr = _.omitBy(params.xattr, (val, name) => name.startsWith('noobaa-namespace'));
        if (params.tagging_copy) params.tagging = source_md.tagging;

        // check if source and target are the same and can handle server side copy
        // take the actual namespace of the bucket either from md (in case of S3\Blob) or source_ns itself
        const actual_source_ns = source_md.ns || source_ns;
        const actual_target_ns = target_ns.get_write_resource();

        if (actual_target_ns.is_same_namespace(actual_source_ns)) {
            // fix copy_source in params to point to the correct cloud bucket
            params.copy_source.bucket = actual_source_ns.get_bucket(bucket);
            params.copy_source.obj_id = source_md.obj_id;
            params.copy_source.version_id = source_md.version_id;
        } else {
            // source cannot be copied directly (different plaforms, accounts, etc.)
            // set the source_stream to read from the copy source
            if (ranges) {
                if (ranges.length !== 1) throw new Error('fix_copy_source_params: multiple ranges not supported');
                source_params.start = ranges[0].start;
                source_params.end = ranges[0].end;
            }
            params.source_stream = await source_ns.read_object_stream(source_params, this);
            if (params.size > (100 * size_utils.MEGABYTE)) {
                dbg.warn(`upload_object with copy_sources - copying by reading source first (not server side)
                so it can take some time and cause client timeouts`);
            }
            // reset the copy_source param
            params.copy_source = null;
        }
    }

    // TODO: Does not work when source namespace is s3 (s3 sdk head-object doesn't return TagCount). Issue #5341.
    async _populate_source_object_tagging({ source_ns, source_md, source_params }) {
        // This is a quick way of knowing if we should load any tags
        if (!source_md.tag_count) return;
        // In NooBaa namespace we already populate the tags
        if (source_md.tagging) return;
        // In case of other namespace we need to read the tags
        source_md.tagging = await source_ns.get_object_tagging(source_params, this);
    }

    async upload_object(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        if (params.copy_source) await this.fix_copy_source_params(params, ns);
        const reply = await ns.upload_object(params, this);
        // update bucket counters
        stats_collector.instance(this.internal_rpc_client).update_bucket_write_counters({
            bucket_name: params.bucket,
            key: params.key,
            content_type: params.content_type
        });
        return reply;
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    async create_object_upload(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        const reply = await ns.create_object_upload(params, this);
        // update bucket counters
        stats_collector.instance(this.internal_rpc_client).update_bucket_write_counters({
            bucket_name: params.bucket,
            key: params.key,
            content_type: params.content_type
        });
        return reply;
    }

    async upload_multipart(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        if (params.copy_source) await this.fix_copy_source_params(params, ns);
        return ns.upload_multipart(params, this);
    }

    async list_multiparts(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.list_multiparts(params, this);
    }

    async complete_object_upload(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.complete_object_upload(params, this);
    }

    async abort_object_upload(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.abort_object_upload(params, this);
    }


    ////////////////////////
    // BLOCK BLOB UPLOADS //
    ////////////////////////

    async upload_blob_block(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.upload_blob_block(params, this);
    }

    async commit_blob_block_list(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.commit_blob_block_list(params, this);
    }

    async get_blob_block_lists(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.get_blob_block_lists(params, this);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.delete_object(params, this);
    }

    async delete_multiple_objects(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.delete_multiple_objects(params, this);
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    async put_object_tagging(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.put_object_tagging(params, this);
    }

    async delete_object_tagging(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.delete_object_tagging(params, this);
    }

    async get_object_tagging(params) {
        const ns = await this._get_bucket_namespace(params.bucket);
        return ns.get_object_tagging(params, this);
    }

    ////////////////////
    // BUCKET TAGGING //
    ////////////////////

    async put_bucket_tagging(params) {
        const ns = this._get_account_namespace();
        return ns.put_bucket_tagging(params);
    }

    async delete_bucket_tagging(params) {
        const ns = this._get_account_namespace();
        return ns.delete_bucket_tagging(params);
    }

    async get_bucket_tagging(params) {
        const ns = this._get_account_namespace();
        return ns.get_bucket_tagging(params);
    }

    ///////////////////////
    // BUCKET ENCRYPTION //
    ///////////////////////

    async put_bucket_encryption(params) {
        const ns = this._get_account_namespace();
        return ns.put_bucket_encryption(params);
    }

    async delete_bucket_encryption(params) {
        const ns = this._get_account_namespace();
        return ns.delete_bucket_encryption(params);
    }

    async get_bucket_encryption(params) {
        const ns = this._get_account_namespace();
        return ns.get_bucket_encryption(params);
    }

    ////////////////////
    // BUCKET WEBSITE //
    ////////////////////

    async put_bucket_website(params) {
        const ns = this._get_account_namespace();
        return ns.put_bucket_website(params);
    }

    async delete_bucket_website(params) {
        const ns = this._get_account_namespace();
        return ns.delete_bucket_website(params);
    }

    async get_bucket_website(params) {
        const ns = this._get_account_namespace();
        return ns.get_bucket_website(params);
    }

    ////////////////////
    // BUCKET POLICY  //
    ////////////////////

    async put_bucket_policy(params) {
        const ns = this._get_account_namespace();
        const result = await ns.put_bucket_policy(params);
        bucket_namespace_cache.invalidate_key(params.name);
        return result;
    }

    async delete_bucket_policy(params) {
        const ns = this._get_account_namespace();
        bucket_namespace_cache.invalidate_key(params.name);
        return ns.delete_bucket_policy(params);
    }

    async get_bucket_policy(params) {
        const ns = this._get_account_namespace();
        bucket_namespace_cache.invalidate_key(params.name);
        return ns.get_bucket_policy(params);
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
    ////////////////////
    //  OBJECT LOCK   //
    ////////////////////

    async get_object_lock_configuration(params) {
        const ns = this._get_account_namespace();
        return ns.get_object_lock_configuration(params, this);
    }

    async put_object_lock_configuration(params) {
        const ns = this._get_account_namespace();
        return ns.put_object_lock_configuration(params, this);
    }
    async get_object_legal_hold(params) {
        const ns = this.namespace_nb;
        return ns.get_object_legal_hold(params, this);
    }

    async put_object_legal_hold(params) {
        const ns = this.namespace_nb;
        return ns.put_object_legal_hold(params, this);
    }
    async get_object_retention(params) {
        const ns = this.namespace_nb;
        return ns.get_object_retention(params, this);
    }

    async put_object_retention(params) {
        const ns = this.namespace_nb;
        return ns.put_object_retention(params, this);
    }
}

module.exports = ObjectSDK;
