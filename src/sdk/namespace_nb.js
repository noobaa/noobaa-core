/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
// const P = require('../util/promise');

class NamespaceNB {

    constructor(target_bucket) {
        this.target_bucket = target_bucket;
    }

    is_same_namespace(other) {
        // in noobaa namespace case just check that other is also local (noobaa)
        return other instanceof NamespaceNB;
    }

    get_write_resource() {
        return this;
    }

    get_bucket(bucket) {
        return bucket;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    list_objects(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.list_objects_s3(params);
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    read_object_md(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.read_object_md(params);
    }

    read_object_stream(params, object_sdk) {
        params = _.defaults({
            client: object_sdk.rpc_client,
            bucket: this.target_bucket,
        }, params);
        return object_sdk.object_io.read_object_stream(params);
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    upload_object(params, object_sdk) {
        params = _.defaults({
            client: object_sdk.rpc_client,
            bucket: this.target_bucket,
        }, params);
        return object_sdk.object_io.upload_object(params);
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    create_object_upload(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.create_object_upload(params);
    }

    upload_multipart(params, object_sdk) {
        params = _.defaults({
            client: object_sdk.rpc_client,
            bucket: this.target_bucket,
        }, params);
        return object_sdk.object_io.upload_multipart(params);
    }

    list_multiparts(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.list_multiparts(params);
    }

    complete_object_upload(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.complete_object_upload(params);
    }

    abort_object_upload(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.abort_object_upload(params);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    delete_object(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.delete_object(params);
    }

    delete_multiple_objects(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.delete_multiple_objects(params);
    }

}

module.exports = NamespaceNB;
