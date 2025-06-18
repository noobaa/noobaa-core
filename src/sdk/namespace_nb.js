/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const blob_translator = require('./blob_translator');
const s3_utils = require('../endpoint/s3/s3_utils');
const S3Error = require('../endpoint/s3/s3_errors').S3Error;

const object_id_regex = /^[0-9a-fA-F]{24}$/;

/**
 * NamespaceNB maps objects using the noobaa bucket_api and object_api
 * and calls object_io to perform dedup, compression, encryption,
 * and placement of blocks in sotorage resources (backing stores / pools).
 * 
 * @implements {nb.Namespace}
 */
class NamespaceNB {

    constructor(target_bucket) {
        // Notice: This is not relevant since we do not use NOOBAA namespace
        this.target_bucket = target_bucket;
        this.active_triggers_map_by_bucket = new Map();
    }

    set_triggers_for_bucket(bucket, triggers) {
        this.active_triggers_map_by_bucket.set(bucket, triggers);
    }

    get_triggers_for_bucket(bucket) {
        return this.active_triggers_map_by_bucket.get(bucket);
    }

    is_server_side_copy(other, other_md, params) {
        // in noobaa namespace case just check that other is also local (noobaa)
        return other instanceof NamespaceNB;
    }

    get_write_resource() {
        return this;
    }

    get_bucket(bucket) {
        return bucket;
    }

    is_readonly_namespace() {
        return false;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        const object_info = await object_sdk.rpc_client.object.list_objects(params);
        return object_info;
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
        // Noobaa bucket does not currrently support partNumber query parameter. Ignore it for now.
        // If set, part_number is positive integer from 1 to 10000
        if (params.part_number) _.unset(params, 'part_number');
        return object_sdk.rpc_client.object.read_object_md(params);
    }

    async read_object_stream(params, object_sdk) {
        params = _.defaults({
            client: object_sdk.rpc_client,
            bucket: this.target_bucket,
        }, params);
        // Noobaa bucket does not currrently support partNumber query parameter. Ignore it for now.
        // If set, part_number is positive integer from 1 to 10000
        if (params.part_number) _.unset(params, 'part_number');
        params = _.omit(params, 'noobaa_trigger_agent');
        const reply = object_sdk.object_io.read_object_stream(params);
        return reply;
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        params = _.defaults({
            client: object_sdk.rpc_client,
            bucket: this.target_bucket,
        }, params);
        const reply = await object_sdk.object_io.upload_object(params);
        return reply;
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

    async complete_object_upload(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        const reply = await object_sdk.rpc_client.object.complete_object_upload(params);
        return reply;
    }

    abort_object_upload(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        const upload_id = params.obj_id;
        if (!upload_id || !object_id_regex.test(upload_id)) throw new S3Error(S3Error.NoSuchUpload);
        return object_sdk.rpc_client.object.abort_object_upload(params);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        const reply = await object_sdk.rpc_client.object.delete_object(params);
        return reply;
    }

    async delete_multiple_objects(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        // TODO: What should I do instead of failing on one failed head request?
        // I cannot exclude the files that failed from delete since it will be considered altering the request of the client
        // TODO: Notice that we do not handle the md_conditions for the heads
        const deleted_res = await object_sdk.rpc_client.object.delete_multiple_objects(params);
        return deleted_res;
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    put_object_tagging(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.put_object_tagging(params);
    }

    delete_object_tagging(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.delete_object_tagging(params);
    }

    get_object_tagging(params, object_sdk) {
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        return object_sdk.rpc_client.object.get_object_tagging(params);
    }

    ///////////////////
    //  OBJECT LOCK  //
    ///////////////////

    get_object_legal_hold(params, object_sdk) {
        return object_sdk.rpc_client.object.get_object_legal_hold(params);
    }

    put_object_legal_hold(params, object_sdk) {
        return object_sdk.rpc_client.object.put_object_legal_hold(params);
    }

    get_object_retention(params, object_sdk) {
        return object_sdk.rpc_client.object.get_object_retention(params);
    }

    put_object_retention(params, object_sdk) {
        return object_sdk.rpc_client.object.put_object_retention(params);
    }

    ////////////
    //  ACLs  //
    ////////////

    async get_object_acl(params, object_sdk) {
        await this.read_object_md({
            bucket: params.bucket,
            key: params.key,
            version_id: params.versionId
        }, object_sdk);

        return s3_utils.DEFAULT_OBJECT_ACL;
    }

    async put_object_acl(params, object_sdk) {
    /*
    TODO.
    NooBaa does not currently support ACLs - not for buckets, nor objects.
    However, some S3 clients fail to function entirely without a valid response to execution of ACL operations.
    Thus, we opted to implement a faux-support for the operation - enough to allow the clients to work, but still without supporting ACLs.
    The reason that read_object_md() is used, is to allow potential errors to rise up if necessary -
    for example, if the user tries to interact with an object that does not exist, the operation would fail as expected with NoSuchObject.
    */
        await this.read_object_md({
            bucket: params.bucket,
            key: params.key,
            version_id: params.versionId
        }, object_sdk);
    }

    ////////////////////
    // OBJECT RESTORE //
    ////////////////////

    async restore_object(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
    }

    ///////////////////
    //      ULS      //
    ///////////////////

    async create_uls() {
        throw new Error('TODO');
    }
    async delete_uls() {
        throw new Error('TODO');
    }
}

module.exports = NamespaceNB;
