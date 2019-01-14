/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

// const P = require('../util/promise');
const blob_translator = require('./blob_translator');
const S3Error = require('../endpoint/s3/s3_errors');


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
        return object_sdk.rpc_client.object.list_objects(params);
    }

    list_uploads(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.list_uploads(params);
    }

    list_object_versions(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.list_object_versions(params);
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

    ////////////////////////
    // BLOCK BLOB UPLOADS //
    ////////////////////////

    upload_blob_block(params, object_sdk) {
        return blob_translator.upload_blob_block(params, object_sdk);
    }

    commit_blob_block_list(params, object_sdk) {
        return blob_translator.commit_blob_block_list(params, object_sdk);
    }

    get_blob_block_lists(params, object_sdk) {
        return blob_translator.get_blob_block_lists(params, object_sdk);
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
        const upload_id = params.obj_id;
        const object_id_regex = RegExp(/^[0-9a-fA-F]{24}$/);
        if (!params.upload_id || !object_id_regex.test(upload_id)) throw new S3Error(S3Error.NoSuchUpload);
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
