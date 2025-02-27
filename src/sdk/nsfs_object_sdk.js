/* Copyright (C) 2020 NooBaa */
'use strict';
/* eslint-disable complexity */

const RpcError = require('../rpc/rpc_error');
const ObjectSDK = require('../sdk/object_sdk');
const NamespaceFS = require('../sdk/namespace_fs');
const BucketSpaceSimpleFS = require('../sdk/bucketspace_simple_fs');
const BucketSpaceFS = require('../sdk/bucketspace_fs');
const SensitiveString = require('../util/sensitive_string');
const endpoint_stats_collector = require('../sdk/endpoint_stats_collector');

class NsfsObjectSDK extends ObjectSDK {
    constructor(fs_root, fs_config, account, versioning, config_root, nsfs_system) {
        let bucketspace;
        if (config_root) {
            bucketspace = new BucketSpaceFS({ config_root }, endpoint_stats_collector.instance());
        } else {
            bucketspace = new BucketSpaceSimpleFS({ fs_root });
        }
        super({
            rpc_client: null,
            internal_rpc_client: null,
            object_io: null,
            bucketspace,
            stats: endpoint_stats_collector.instance(),
        });
        this.nsfs_config_root = config_root;
        this.nsfs_fs_root = fs_root;
        this.nsfs_fs_config = fs_config;
        this.nsfs_account = account;
        this.nsfs_versioning = versioning;
        this.nsfs_namespaces = {};
        this.nsfs_system = nsfs_system;
        if (!config_root) {
            this._get_bucket_namespace = bucket_name => this._simple_get_single_bucket_namespace(bucket_name);
            this.load_requesting_account = auth_req => this._simple_load_requesting_account(auth_req);
            this.read_bucket_sdk_policy_info = bucket_name => this._simple_read_bucket_sdk_policy_info(bucket_name);
            this.read_bucket_sdk_config_info = () => undefined;
            this.read_bucket_usage_info = () => undefined;
            this.read_bucket_sdk_website_info = () => undefined;
            this.read_bucket_sdk_namespace_info = () => undefined;
            this.read_bucket_sdk_caching_info = () => undefined;
        }
    }

    async _simple_get_single_bucket_namespace(bucket_name) {
        const existing_ns = this.nsfs_namespaces[bucket_name];
        if (existing_ns) return existing_ns;
        const ns_fs = new NamespaceFS({
            fs_backend: this.nsfs_fs_config.backend,
            bucket_path: this.nsfs_fs_root + '/' + bucket_name,
            bucket_id: 'nsfs',
            namespace_resource_id: undefined,
            access_mode: undefined,
            versioning: this.nsfs_versioning,
            stats: endpoint_stats_collector.instance(),
            force_md5_etag: false,
        });
        this.nsfs_namespaces[bucket_name] = ns_fs;
        return ns_fs;
    }

    async _simple_load_requesting_account(auth_req) {
        const access_key = this.nsfs_account.access_keys?.[0]?.access_key;
        if (access_key) {
            const token = this.get_auth_token();
            if (!token) {
                throw new RpcError('UNAUTHORIZED', `Anonymous access to bucket not allowed`);
            }
            if (token.access_key !== access_key.unwrap()) {
                throw new RpcError('INVALID_ACCESS_KEY_ID', `Account with access_key not found`);
            }
        }
        this.requesting_account = this.nsfs_account;
    }

    async _simple_read_bucket_sdk_policy_info(bucket_name) {
        return {
            s3_policy: {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: ['*'],
                    Resource: ['*'],
                    Principal: [new SensitiveString('*')],
                }]
            },
            bucket_owner: new SensitiveString('nsfs'),
            owner_account: new SensitiveString('nsfs-id'), // temp
        };
    }
}

// EXPORTS
module.exports = NsfsObjectSDK;
