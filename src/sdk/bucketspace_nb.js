/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../util/promise');
const nb_native = require('../util/nb_native');
const dbg = require('../util/debug_module')(__filename);
const path = require('path');
const config = require('../../config.js');
const NamespaceFS = require('./namespace_fs');

/**
 * @implements {nb.BucketSpace}
 */
class BucketSpaceNB {

    constructor(options) {
        this.rpc_client = options.rpc_client;
        this.internal_rpc_client = options.internal_rpc_client;
    }

    async read_account_by_access_key({ access_key }) {
        return this.internal_rpc_client.account.read_account_by_access_key({ access_key });
    }

    async read_bucket_sdk_info({ name }) {
        return this.internal_rpc_client.bucket.read_bucket_sdk_info({ name });
    }


    ////////////
    // BUCKET //
    ////////////

    async list_buckets(object_sdk) {
        const { buckets } = (await this.rpc_client.bucket.list_buckets());
        const has_access_buckets = (await P.all(_.map(
            buckets,
            async bucket => {
                const ns = await object_sdk.read_bucket_sdk_namespace_info(bucket.name.unwrap());
                const has_access_to_bucket = object_sdk.is_nsfs_bucket(ns) ?
                    await this._has_access_to_nsfs_dir(ns, object_sdk) :
                    object_sdk.has_non_nsfs_bucket_access(object_sdk.requesting_account, ns);
                return has_access_to_bucket && bucket;
            }))).filter(bucket => bucket);
        return { buckets: has_access_buckets };
    }

    async read_bucket(params) {
        return this.rpc_client.bucket.read_bucket(params);
    }

    async create_bucket(params, object_sdk) {
        const resp = await this.rpc_client.bucket.create_bucket(params);
        try {
            if (resp.namespace && resp.namespace.should_create_underlying_storage) {
                const ns = await object_sdk._get_bucket_namespace(params.name.unwrap());
                const namespace_bucket_config = await object_sdk.read_bucket_sdk_namespace_info(params.name.unwrap());
                await ns.create_uls({
                    name: params.name,
                    full_path: path.join(namespace_bucket_config.write_resource.resource.fs_root_path,
                        namespace_bucket_config.write_resource.path) // includes write_resource.path + bucket name (s3 flow)
                }, object_sdk);
            }
        } catch (err) {
            dbg.log0('could not create underlying directory - nsfs, deleting bucket', err);
            await this.rpc_client.bucket.delete_bucket({ name: params.name.unwrap() });
            throw err;
        }
        return resp;
    }

    async delete_bucket(params, object_sdk) {
        const namespace_bucket_config = await object_sdk.read_bucket_sdk_namespace_info(params.name);

        if (namespace_bucket_config && namespace_bucket_config.should_create_underlying_storage) {
            const ns = await object_sdk._get_bucket_namespace(params.name);
            await ns.delete_uls({
                name: params.name,
                full_path: path.join(namespace_bucket_config.write_resource.resource.fs_root_path,
                    namespace_bucket_config.write_resource.path) // includes write_resource.path + bucket name (s3 flow)
            }, object_sdk);
        }
        return this.rpc_client.bucket.delete_bucket(params);
    }

    //////////////////////
    // BUCKET LIFECYCLE //
    //////////////////////

    async get_bucket_lifecycle_configuration_rules(params) {
        return this.rpc_client.bucket.get_bucket_lifecycle_configuration_rules(params);
    }

    async set_bucket_lifecycle_configuration_rules(params) {
        return this.rpc_client.bucket.set_bucket_lifecycle_configuration_rules(params);
    }

    async delete_bucket_lifecycle(params) {
        return this.rpc_client.bucket.delete_bucket_lifecycle(params);
    }

    ///////////////////////
    // BUCKET VERSIONING //
    ///////////////////////

    async set_bucket_versioning(params, object_sdk) {
        const ns = await object_sdk._get_bucket_namespace(params.name);
        if (ns instanceof NamespaceFS) {
            await ns.set_bucket_versioning(params.versioning, object_sdk);
        }
        return this.rpc_client.bucket.update_bucket({
            name: params.name,
            versioning: params.versioning
        });
    }

    ////////////////////
    // BUCKET TAGGING //
    ////////////////////

    async put_bucket_tagging(params) {
        return this.rpc_client.bucket.put_bucket_tagging({
            name: params.name,
            tagging: params.tagging
        });
    }

    async delete_bucket_tagging(params) {
        return this.rpc_client.bucket.delete_bucket_tagging({
            name: params.name
        });
    }

    async get_bucket_tagging(params) {
        return this.rpc_client.bucket.get_bucket_tagging({
            name: params.name
        });
    }
    ////////////////////
    // BUCKET LOGGING //
    ////////////////////

    async put_bucket_logging(params) {
        return this.rpc_client.bucket.put_bucket_logging({
            name: params.name,
            logging: params.logging
        });
    }

    async delete_bucket_logging(params) {
        return this.rpc_client.bucket.delete_bucket_logging({
            name: params.name
        });
    }

    async get_bucket_logging(params) {
        return this.rpc_client.bucket.get_bucket_logging({
            name: params.name
        });
    }

    ///////////////////////
    // BUCKET ENCRYPTION //
    ///////////////////////

    async put_bucket_encryption(params) {
        return this.rpc_client.bucket.put_bucket_encryption({
            name: params.name,
            encryption: params.encryption
        });
    }

    async get_bucket_encryption(params) {
        return this.rpc_client.bucket.get_bucket_encryption({
            name: params.name
        });
    }

    async delete_bucket_encryption(params) {
        return this.rpc_client.bucket.delete_bucket_encryption({
            name: params.name
        });
    }

    ////////////////////
    // BUCKET WEBSITE //
    ////////////////////

    async put_bucket_website(params) {
        return this.rpc_client.bucket.put_bucket_website({
            name: params.name,
            website: params.website
        });
    }

    async delete_bucket_website(params) {
        return this.rpc_client.bucket.delete_bucket_website({
            name: params.name
        });
    }

    async get_bucket_website(params) {
        return this.rpc_client.bucket.get_bucket_website({
            name: params.name
        });
    }

    ////////////////////
    // BUCKET POLICY  //
    ////////////////////

    async put_bucket_policy(params) {
        return this.rpc_client.bucket.put_bucket_policy({
            name: params.name,
            policy: params.policy
        });
    }

    async delete_bucket_policy(params) {
        return this.rpc_client.bucket.delete_bucket_policy({
            name: params.name
        });
    }

    async get_bucket_policy(params) {
        return this.rpc_client.bucket.get_bucket_policy({
            name: params.name
        });
    }

    /////////////////////////
    // BUCKET NOTIFICATION //
    /////////////////////////

    async put_bucket_notification(params) {
        return this.rpc_client.bucket.put_bucket_notification({
            name: params.bucket_name,
            notifications: params.notifications
        });
    }

    async get_bucket_notification(params) {
        return this.rpc_client.bucket.get_bucket_notification({
            name: params.bucket_name
        });
    }

    /////////////////////////
    // DEFAULT OBJECT LOCK //
    /////////////////////////

    async get_object_lock_configuration(params, object_sdk) {
        return this.rpc_client.bucket.get_object_lock_configuration(params);
    }

    async put_object_lock_configuration(params, object_sdk) {
        return this.rpc_client.bucket.put_object_lock_configuration(params);
    }

    //  nsfs


    async _has_access_to_nsfs_dir(ns, object_sdk) {
        const account = object_sdk.requesting_account;
        console.log('_has_access_to_nsfs_dir: nsr: ', ns, 'account.nsfs_account_config: ', account.nsfs_account_config);
        // nsfs bucket
        if (!account.nsfs_account_config || _.isUndefined(account.nsfs_account_config.uid) ||
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

    is_nsfs_containerized_user_anonymous(token) {
        return !token && !process.env.NC_NSFS_NO_DB_ENV;
    }

    is_nsfs_non_containerized_user_anonymous(token) {
        return !token && process.env.NC_NSFS_NO_DB_ENV === 'true';
    }
}

module.exports = BucketSpaceNB;
