/* Copyright (C) 2016 NooBaa */
'use strict';

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

    async list_buckets() {
        return this.rpc_client.bucket.list_buckets();
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
}

module.exports = BucketSpaceNB;
