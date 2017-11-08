/* Copyright (C) 2016 NooBaa */
'use strict';

class AccountSpaceNB {

    constructor(options) {
        this.rpc_client = options.rpc_client;
    }

    set_auth_token(auth_token) {
        this.rpc_client.options.auth_token = auth_token;
    }

    ////////////
    // BUCKET //
    ////////////

    list_buckets() {
        return this.rpc_client.bucket.list_buckets();
    }

    read_bucket(params) {
        return this.rpc_client.bucket.read_bucket(params);
    }

    create_bucket(params) {
        return this.rpc_client.bucket.create_bucket(params);
    }

    delete_bucket(params) {
        return this.rpc_client.bucket.delete_bucket(params);
    }

    //////////////////////
    // BUCKET LIFECYCLE //
    //////////////////////

    get_bucket_lifecycle_configuration_rules(params) {
        return this.rpc_client.bucket.get_bucket_lifecycle_configuration_rules(params);
    }

    set_bucket_lifecycle_configuration_rules(params) {
        return this.rpc_client.bucket.set_bucket_lifecycle_configuration_rules(params);
    }

    delete_bucket_lifecycle(params) {
        return this.rpc_client.bucket.delete_bucket_lifecycle(params);
    }

    ////////////////////////
    // BUCKET REPLICATION //
    ////////////////////////

    set_bucket_replication(params) {
        return this.rpc_client.bucket.set_cloud_sync(params);
    }

    delete_bucket_replication(params) {
        return this.rpc_client.bucket.delete_cloud_sync(params);
    }
}

module.exports = AccountSpaceNB;
