/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../util/promise');
const blob_translator = require('./blob_translator');
const s3_utils = require('../endpoint/s3/s3_utils');
const S3Error = require('../endpoint/s3/s3_errors').S3Error;

const EXCEPT_REASONS = [
    'NO_SUCH_OBJECT'
];

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

    is_server_side_copy(other, params) {
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
        // Noobaa bucket does not currrently support partNumber query parameter. Ignore it for now.
        // If set, part_number is positive integer from 1 to 10000
        if (params.part_number) _.unset(params, 'part_number');
        return object_sdk.rpc_client.object.read_object_md(params);
    }

    async read_object_stream(params, object_sdk) {
        const operation = 'ObjectRead';
        let obj = { key: params.key };
        params = _.defaults({
            client: object_sdk.rpc_client,
            bucket: this.target_bucket,
        }, params);
        // Noobaa bucket does not currrently support partNumber query parameter. Ignore it for now.
        // If set, part_number is positive integer from 1 to 10000
        if (params.part_number) _.unset(params, 'part_number');
        const active_triggers = this.get_triggers_for_bucket(params.bucket);
        const load_for_trigger = !params.noobaa_trigger_agent && object_sdk.should_run_triggers({
            active_triggers,
            operation
        });
        params = _.omit(params, 'noobaa_trigger_agent');
        if (params.object_md) {
            obj = _.defaults(obj, params.object_md);
        } else {
            obj = load_for_trigger && _.defaults(obj, await this.read_object_md(params, object_sdk));
        }
        const reply = object_sdk.object_io.read_object_stream(params);
        // Notice: We dispatch the trigger prior to the finish of the read
        if (load_for_trigger) {
            object_sdk.dispatch_triggers({ active_triggers, operation, obj, bucket: params.bucket });
        }
        return reply;
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        const operation = 'ObjectCreated';
        params = _.defaults({
            client: object_sdk.rpc_client,
            bucket: this.target_bucket,
        }, params);
        const active_triggers = this.get_triggers_for_bucket(params.bucket);
        const load_for_trigger = object_sdk.should_run_triggers({
            active_triggers,
            operation
        });
        const reply = await object_sdk.object_io.upload_object(params);
        if (load_for_trigger) {
            const obj = {
                bucket: params.bucket,
                key: params.key,
                size: params.size,
                content_type: params.content_type,
                etag: reply.etag
            };
            object_sdk.dispatch_triggers({ active_triggers, operation, obj, bucket: params.bucket });
        }
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
        const operation = 'ObjectCreated';
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        const active_triggers = this.get_triggers_for_bucket(params.bucket);
        const load_for_trigger = object_sdk.should_run_triggers({
            active_triggers,
            operation
        });
        const reply = await object_sdk.rpc_client.object.complete_object_upload(params);
        if (load_for_trigger) {
            const obj = {
                bucket: params.bucket,
                key: params.key,
                size: reply.size,
                content_type: reply.content_type,
                etag: reply.etag
            };
            object_sdk.dispatch_triggers({ active_triggers, operation, obj, bucket: params.bucket });
        }
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
        const operation = 'ObjectRemoved';
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        const active_triggers = this.get_triggers_for_bucket(params.bucket);
        const load_for_trigger = object_sdk.should_run_triggers({
            active_triggers,
            operation
        });
        let obj;
        try {
            obj = load_for_trigger && _.defaults({ key: params.key }, await this.read_object_md(params, object_sdk));
        } catch (error) {
            if (!_.includes(EXCEPT_REASONS, error.rpc_code || 'UNKNOWN_ERR')) throw error;
        }
        const reply = await object_sdk.rpc_client.object.delete_object(params);
        // TODO: What should I send to the trigger on non existing objects delete?
        if (load_for_trigger && obj) {
            object_sdk.dispatch_triggers({ active_triggers, operation, obj, bucket: params.bucket });
        }
        return reply;
    }

    async delete_multiple_objects(params, object_sdk) {
        const operation = 'ObjectRemoved';
        if (this.target_bucket) params = _.defaults({ bucket: this.target_bucket }, params);
        const active_triggers = this.get_triggers_for_bucket(params.bucket);
        const load_for_trigger = object_sdk.should_run_triggers({
            active_triggers,
            operation
        });
        // TODO: What should I do instead of failing on one failed head request?
        // I cannot exclude the files that failed from delete since it will be considered altering the request of the client
        // TODO: Notice that we do not handle the md_conditions for the heads
        const head_res = load_for_trigger && await P.map(params.objects, async obj => {
            const request = {
                bucket: params.bucket,
                key: obj.key,
                version_id: obj.version_id
            };
            let obj_md;
            try {
                obj_md = _.defaults({ key: obj.key }, await this.read_object_md(request, object_sdk));
            } catch (error) {
                if (!_.includes(EXCEPT_REASONS, error.rpc_code || 'UNKNOWN_ERR')) throw error;
            }
            return obj_md;
        });
        const deleted_res = await object_sdk.rpc_client.object.delete_multiple_objects(params);
        if (load_for_trigger) {
            this._dispatch_multiple_delete_triggers({
                head_res,
                deleted_res,
                object_sdk,
                operation,
                bucket: params.bucket,
                active_triggers
            });
        }
        return deleted_res;
    }

    // Both responses should be in the same order and the same length
    _dispatch_multiple_delete_triggers(params) {
        const { head_res, deleted_res, object_sdk, operation, bucket, active_triggers } = params;
        if (head_res.length !== deleted_res.length) throw new S3Error(S3Error.InternalError);
        for (let i = 0; i < deleted_res.length; ++i) {
            const deleted_obj = deleted_res[i];
            const head_obj = head_res[i];
            if (_.isUndefined(deleted_obj && deleted_obj.err_code) && head_obj) {
                object_sdk.dispatch_triggers({ active_triggers, operation, obj: head_obj, bucket });
            }
        }
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
        // TODO S3 ignoring put_object_acl for now
        // For now we just call read_object_md() to check if the object and bucket 
        // even exist or throw proper errors.
        await this.read_object_md({
            bucket: params.bucket,
            key: params.key,
            version_id: params.versionId
        }, object_sdk);
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
