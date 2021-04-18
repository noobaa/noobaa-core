/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../util/promise');
const nb_native = require('../util/nb_native');
const dbg = require('../util/debug_module')(__filename);

/**
 * @implements {nb.BucketSpace}
 */
class BucketSpaceNB {

    constructor(options) {
        this.rpc_client = options.rpc_client;
    }

    ////////////
    // BUCKET //
    ////////////

    async list_buckets(object_sdk) {
        const { buckets } = (await this.rpc_client.bucket.list_buckets());
        const has_access_buckets = (await P.all(_.map(
            buckets,
            async bucket => {
                const namespace_bucket_config = await object_sdk.read_bucket_sdk_namespace_info(bucket.name.unwrap());
                if (await this._has_access_to_nsfs_dir(namespace_bucket_config, object_sdk.requesting_account)) {
                    return bucket;
                }
            }
        ))).filter(bucket => bucket);
        return { buckets: has_access_buckets };
    }

    async read_bucket(params) {
        return this.rpc_client.bucket.read_bucket(params);
    }

    async create_bucket(params) {
        return this.rpc_client.bucket.create_bucket(params);
    }

    async delete_bucket(params) {
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

    async set_bucket_versioning(params) {
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
    // DEFAULT OBJECT LOCK //
    /////////////////////////

    async get_object_lock_configuration(params) {
        return this.rpc_client.bucket.get_object_lock_configuration(params);
    }

    async put_object_lock_configuration(params) {
        return this.rpc_client.bucket.put_object_lock_configuration(params);
    }

    //  nsfs


    async _has_access_to_nsfs_dir(namespace_bucket_config, account) {
        if (!namespace_bucket_config || !namespace_bucket_config.write_resource) return true;
        console.log('_has_access_to_nsfs_dir0', namespace_bucket_config.write_resource);
        if (namespace_bucket_config.write_resource.resource && !namespace_bucket_config.write_resource.resource.fs_root_path) return true;
        dbg.log0('_has_access_to_nsfs_dir1', account.nsfs_account_config);

        if (!account.nsfs_account_config || _.isUndefined(account.nsfs_account_config.uid) ||
            _.isUndefined(account.nsfs_account_config.gid)) return false;
        try {
            dbg.log0('_has_access_to_nsfs_dir', namespace_bucket_config.write_resource, account.nsfs_account_config.uid, account.nsfs_account_config.gid);

            await nb_native().fs.stat({
                    uid: account.nsfs_account_config.uid,
                    gid: account.nsfs_account_config.gid,
                    backend: namespace_bucket_config.write_resource.resource.fs_backend
                }, namespace_bucket_config.write_resource.resource.fs_root_path);

            return true;
        } catch (err) {
            if (err.code === 'EPERM' && err.message === 'Operation not permitted') return false;
            throw err;
        }
    }
}

module.exports = BucketSpaceNB;
