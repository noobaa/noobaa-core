/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
require('../util/dotenv').load();

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const LRUCache = require('../util/lru_cache');
const cloud_utils = require('../util/cloud_utils');
const http_utils = require('../util/http_utils');
const size_utils = require('../util/size_utils');
const NamespaceNB = require('./namespace_nb');
const NamespaceS3 = require('./namespace_s3');
const NamespaceBlob = require('./namespace_blob');
const NamespaceMerge = require('./namespace_merge');
const NamespaceMultipart = require('./namespace_multipart');
const NamespaceNetStorage = require('./namespace_net_storage');
const AccountSpaceNetStorage = require('./accountspace_net_storage');
const AccountSpaceNB = require('./accountspace_nb');

const bucket_namespace_cache = new LRUCache({
    name: 'ObjectSDK-Bucket-Namespace-Cache',
    expiry_ms: 0,
    max_usage: 1000,
    make_key: params => params.name,
    load: params => params.sdk._load_bucket_namespace(params),
    validate: (data, params) => params.sdk._validate_bucket_namespace(data, params),
});

const NAMESPACE_CACHE_EXPIRY = 60000;

const MULTIPART_NAMESPACES = [
    'NET_STORAGE'
];

class ObjectSDK {

    constructor(rpc_client, object_io) {
        this.rpc_client = rpc_client;
        this.object_io = object_io;
        this.namespace_nb = new NamespaceNB();
        this.accountspace_nb = new AccountSpaceNB({
            rpc_client
        });
    }

    _get_account_namespace() {
        return P.resolve()
            .then(() => {
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
            });
    }

    _get_bucket_namespace(name) {
        return bucket_namespace_cache.get_with_cache({
                sdk: this,
                name,
            })
            .then(data => data.ns);
    }

    _load_bucket_namespace(params) {
        // params.bucket might be added by _validate_bucket_namespace
        return P.resolve(params.bucket || this.rpc_client.bucket.get_bucket_namespaces({ name: params.name }))
            .then(bucket => this._setup_bucket_namespace(bucket));
    }

    _validate_bucket_namespace(data, params) {
        const time = Date.now();
        if (time <= data.valid_until) return true;
        return this.rpc_client.bucket.get_bucket_namespaces({ name: params.name })
            .then(bucket => {
                if (_.isEqual(bucket.namespace, data.bucket.namespace)) {
                    // namespace unchanged - extend validity for another period
                    data.valid_until = time + NAMESPACE_CACHE_EXPIRY;
                    return true;
                } else {
                    // namespace changed - _load_bucket_namespace will be called by the cache
                    // hang the new bucket on the cache params to reuse it
                    params.bucket = bucket;
                    return false;
                }
            });
    }

    _setup_bucket_namespace(bucket) {
        const time = Date.now();
        dbg.log0('_load_bucket_namespace', util.inspect(bucket, true, null, true));
        try {
            if (bucket.namespace && bucket.namespace.read_resources && bucket.namespace.write_resource) {
                return {
                    ns: this._setup_merge_namespace(bucket),
                    bucket,
                    valid_until: time + NAMESPACE_CACHE_EXPIRY,
                };
            }
        } catch (err) {
            dbg.error('Failed to setup bucket namespace (fallback to no namespace)', err);
        }
        return {
            ns: this.namespace_nb,
            bucket,
            valid_until: time + NAMESPACE_CACHE_EXPIRY,
        };
    }

    _setup_merge_namespace(bucket) {
        let rr = _.cloneDeep(bucket.namespace.read_resources);
        let wr = this._setup_single_namespace(_.extend({ proxy: bucket.proxy }, bucket.namespace.write_resource));
        if (MULTIPART_NAMESPACES.includes(bucket.namespace.write_resource.endpoint_type)) {
            const wr_index = rr.findIndex(r => _.isEqual(r, bucket.namespace.write_resource));
            wr = new NamespaceMultipart(
                this._setup_single_namespace(_.extend({ proxy: bucket.proxy }, bucket.namespace.write_resource)),
                this.namespace_nb);
            rr.splice(wr_index, 1, {
                endpoint_type: 'MULTIPART',
                ns: wr
            });
        }

        return new NamespaceMerge({
            write_resource: wr,
            read_resources: _.map(rr, ns_info => (
                ns_info.endpoint_type === 'MULTIPART' ? ns_info.ns :
                this._setup_single_namespace(_.extend({ proxy: bucket.proxy }, ns_info))
            ))
        });
    }

    _setup_single_namespace(ns_info) {
        console.log(`ns_info.proxy = ${ns_info.proxy}`);
        if (ns_info.endpoint_type === 'NOOBAA') {
            if (ns_info.target_bucket) {
                return new NamespaceNB(ns_info.target_bucket);
            } else {
                return this.namespace_nb;
            }
        }
        if (ns_info.endpoint_type === 'AWS' ||
            ns_info.endpoint_type === 'S3_COMPATIBLE') {
            const httpOptions = (ns_info.endpoint_type === 'AWS' && !ns_info.proxy) ? undefined : {
                agent: http_utils.get_unsecured_http_agent(ns_info.endpoint, ns_info.proxy)
            };
            return new NamespaceS3({
                params: { Bucket: ns_info.target_bucket },
                endpoint: ns_info.endpoint,
                accessKeyId: ns_info.access_key,
                secretAccessKey: ns_info.secret_key,
                // region: 'us-east-1', // TODO needed?
                signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(ns_info.endpoint, ns_info.auth_method),
                s3ForcePathStyle: true,
                // computeChecksums: false, // disabled by default for performance
                httpOptions
            });
        }
        if (ns_info.endpoint_type === 'AZURE') {
            return new NamespaceBlob({
                container: ns_info.target_bucket,
                connection_string: cloud_utils.get_azure_connection_string(ns_info),
                proxy: ns_info.proxy
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

    list_buckets() {
        return this._get_account_namespace()
            .then(ns => ns.list_buckets());
    }

    read_bucket(params) {
        return this._get_account_namespace()
            .then(ns => ns.read_bucket(params));
    }

    create_bucket(params) {
        return this._get_account_namespace()
            .then(ns => ns.create_bucket(params));
    }

    delete_bucket(params) {
        return this._get_account_namespace()
            .then(ns => ns.delete_bucket(params));
    }

    //////////////////////
    // BUCKET LIFECYCLE //
    //////////////////////

    get_bucket_lifecycle_configuration_rules(params) {
        return this._get_account_namespace()
            .then(ns => ns.get_bucket_lifecycle_configuration_rules(params));
    }

    set_bucket_lifecycle_configuration_rules(params) {
        return this._get_account_namespace()
            .then(ns => ns.set_bucket_lifecycle_configuration_rules(params));
    }

    delete_bucket_lifecycle(params) {
        return this._get_account_namespace()
            .then(ns => ns.delete_bucket_lifecycle(params));
    }

    ////////////////////////
    // BUCKET REPLICATION //
    ////////////////////////

    set_bucket_replication(params) {
        return this._get_account_namespace()
            .then(ns => ns.set_cloud_sync(params));
    }

    delete_bucket_replication(params) {
        return this._get_account_namespace()
            .then(ns => ns.delete_cloud_sync(params));
    }

    ///////////////////////
    // BUCKET VERSIONING //
    ///////////////////////

    set_bucket_versioning(params) {
        return this._get_account_namespace()
            .then(ns => ns.set_bucket_versioning(params));
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    list_objects(params) {
        return this._get_bucket_namespace(params.bucket)
            .then(ns => ns.list_objects(params, this));
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    read_object_md(params) {
        return this._get_bucket_namespace(params.bucket)
            .then(ns => ns.read_object_md(params, this));
    }

    read_object_stream(params) {
        return this._get_bucket_namespace(params.bucket)
            .then(ns => ns.read_object_stream(params, this))
            .then(reply => {
                // update counters in background
                this.rpc_client.object.update_bucket_read_counters({ bucket: params.bucket });
                return reply;
            });
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params) {
        const target_ns = await this._get_bucket_namespace(params.bucket);
        let reply;
        if (params.copy_source) {
            const source_params = _.pick(params.copy_source, 'bucket', 'key');
            if (params.copy_source.range) {
                source_params.start = params.copy_source.range.start;
                source_params.end = params.copy_source.range.end;
            }
            // get the namespace for source bucket
            const source_ns = await this._get_bucket_namespace(params.copy_source.bucket);
            const source_md = await source_ns.read_object_md(source_params, this);
            // take the actual namespace of the bucket either from md (in case of S3\Blob) or source_ns itself
            const actual_source_ns = source_md.ns || source_ns;
            const actual_target_ns = target_ns.get_write_resource();
            // check if source and target are the same and can handle server side copy
            if (actual_target_ns.is_same_namespace(actual_source_ns)) {
                // fix copy_source in params 
                params.copy_source.bucket = actual_source_ns.get_bucket(params.copy_source.bucket);
            } else {
                params.copy_source = null;
                params.source_stream = await source_ns.read_object_stream(source_params, this);
                params.size = source_md.size;
                if (params.xattr_copy) {
                    params.xattr = source_md.xattr;
                }
                params.xattr = _.omitBy(params.xattr, (val, key) => key.startsWith('noobaa-namespace'));
                if (params.size > (100 * size_utils.MEGABYTE)) {
                    dbg.warn(`upload_object with copy_sources - copying by reading source first (not server side)
                     so it can take some time and cause client timeouts`);
                }
            }
        }

        reply = await target_ns.upload_object(params, this);
        // update counters in background
        this.rpc_client.object.update_bucket_write_counters({ bucket: params.bucket });
        return reply;
    }


    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    create_object_upload(params) {
        return this._get_bucket_namespace(params.bucket)
            .then(ns => ns.create_object_upload(params, this));
    }

    upload_multipart(params) {
        return this._get_bucket_namespace(params.bucket)
            .then(ns => ns.upload_multipart(params, this));
    }

    list_multiparts(params) {
        return this._get_bucket_namespace(params.bucket)
            .then(ns => ns.list_multiparts(params, this));
    }

    complete_object_upload(params) {
        return this._get_bucket_namespace(params.bucket)
            .then(ns => ns.complete_object_upload(params, this))
            .then(reply => {
                // update counters in background
                this.rpc_client.object.update_bucket_write_counters({ bucket: params.bucket });
                return reply;
            });
    }

    abort_object_upload(params) {
        return this._get_bucket_namespace(params.bucket)
            .then(ns => ns.abort_object_upload(params, this));
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    delete_object(params) {
        return this._get_bucket_namespace(params.bucket)
            .then(ns => ns.delete_object(params, this));
    }

    delete_multiple_objects(params) {
        return this._get_bucket_namespace(params.bucket)
            .then(ns => ns.delete_multiple_objects(params, this));
    }

}

module.exports = ObjectSDK;
