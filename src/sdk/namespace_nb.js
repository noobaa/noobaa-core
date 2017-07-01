/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
// const P = require('../util/promise');

class NamespaceNB {

    constructor(rpc_client, object_io, target_bucket) {
        this.rpc_client = rpc_client;
        this.object_io = object_io;
        this.target_bucket = target_bucket;
    }

    set_auth_token(auth_token) {
        this.rpc_client.options.auth_token = auth_token;
    }

    get_auth_token() {
        return this.rpc_client.options.auth_token;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    list_objects(params) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return this.rpc_client.object.list_objects_s3(params);
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    read_object_md(params) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return this.rpc_client.object.read_object_md(params);
    }

    read_object_stream(params) {
        params = _.defaults({
            client: this.rpc_client,
            bucket: this.target_bucket,
        }, params);
        return this.object_io.read_object_stream(params);
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    upload_object(params) {
        params = _.defaults({
            client: this.rpc_client,
            bucket: this.target_bucket,
        }, params);
        return this.object_io.upload_object(params);
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    create_object_upload(params) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return this.rpc_client.object.create_object_upload(params);
    }

    upload_multipart(params) {
        params = _.defaults({
            client: this.rpc_client,
            bucket: this.target_bucket,
        }, params);
        return this.object_io.upload_multipart(params);
    }

    list_multiparts(params) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return this.rpc_client.object.list_multiparts(params);
    }

    complete_object_upload(params) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return this.rpc_client.object.complete_object_upload(params);
    }

    abort_object_upload(params) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return this.rpc_client.object.abort_object_upload(params);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    delete_object(params) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return this.rpc_client.object.delete_object(params);
    }

    delete_multiple_objects(params) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return this.rpc_client.object.delete_multiple_objects(params);
    }

}

module.exports = NamespaceNB;
