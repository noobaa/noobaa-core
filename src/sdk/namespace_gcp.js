/* Copyright (C) 2023 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');

const P = require('../util/promise');
const stream_utils = require('../util/stream_utils');
const dbg = require('../util/debug_module')(__filename);
const S3Error = require('../endpoint/s3/s3_errors').S3Error;
//TODO: why do we what to use the wrap and not directly @google-cloud/storage ? 
const GoogleCloudStorage = require('../util/google_storage_wrap');
const endpoint_stats_collector = require('./endpoint_stats_collector');

/**
 * @implements {nb.Namespace}
 */
class NamespaceGCP {


    constructor({ namespace_resource_id, rpc_client, project_id, target_bucket, client_email, private_key, access_mode }) {
        this.namespace_resource_id = namespace_resource_id;
        this.project_id = project_id;
        this.client_email = client_email;
        this.private_key = private_key;
        //gcs stands for google cloud storage
        this.gcs = new GoogleCloudStorage({
            projectId: this.project_id,
            credentials: {
                client_email: this.client_email,
                private_key: this.private_key,
            }
        });
        this.bucket = target_bucket;
        this.rpc_client = rpc_client;
        this.access_mode = access_mode;
        this.stats_collector = endpoint_stats_collector.instance(this.rpc_client);
    }

    get_write_resource() {
        return this;
    }

    is_server_side_copy(other, params) {
        //TODO: what is the case here, what determine server side copy? 
        return other instanceof NamespaceGCP &&
            this.private_key === other.private_key &&
            this.client_email === other.client_email;
    }

    get_bucket() {
        return this.bucket;
    }

    is_readonly_namespace() {
        if (this.access_mode && this.access_mode === 'READ_ONLY') {
            return true;
        }
        return false;
    }


    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params, object_sdk) {
        dbg.log0('NamespaceGCP.list_objects:', this.bucket, inspect(params));
        throw new S3Error(S3Error.NotImplemented);
    }

    async list_uploads(params, object_sdk) {
        dbg.log0('NamespaceGCP.list_uploads:',
            this.bucket,
            inspect(params)
        );
        throw new S3Error(S3Error.NotImplemented);
    }

    async list_object_versions(params, object_sdk) {
        dbg.log0('NamespaceGCP.list_object_versions:',
            this.bucket,
            inspect(params)
        );
        throw new S3Error(S3Error.NotImplemented);
    }


    /////////////////
    // OBJECT READ //
    /////////////////

    async read_object_md(params, object_sdk) {
        dbg.log0('NamespaceGCP.read_object_md:', this.bucket, inspect(params));
        throw new S3Error(S3Error.NotImplemented);
    }

    async read_object_stream(params, object_sdk) {
        dbg.log0('NamespaceGCP.read_object_stream:', this.bucket, inspect(_.omit(params, 'object_md.ns')));
        throw new S3Error(S3Error.NotImplemented);
    }


    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        dbg.log0('NamespaceGCP.upload_object:', this.bucket, inspect(params));

        let metadata;
        if (params.copy_source) {
            dbg.error('NamespaceGCP.upload_object: Copy is not implemented yet', this.bucket, inspect(params.copy_source));
            throw new S3Error(S3Error.NotImplemented);
        } else {
            try {
                let count = 1;
                const count_stream = stream_utils.get_tap_stream(data => {
                    this.stats_collector.update_namespace_write_stats({
                        namespace_resource_id: this.namespace_resource_id,
                        bucket_name: params.bucket,
                        size: data.length,
                        count
                    });
                    // clear count for next updates
                    count = 0;
                });
                const file = this.gcs.bucket(this.bucket).file(params.key);
                // https://googleapis.dev/nodejs/storage/latest/File.html#createWriteStream
                // for the options of createWriteStream: 
                // https://googleapis.dev/nodejs/storage/latest/global.html#CreateWriteStreamOptions
                const options = {
                    metadata: {
                        contentType: params.content_type,
                        md5Hash: params.md5_b64,
                    }
                };
                const writeStream = file.createWriteStream(options);
                params.source_stream.pipe(count_stream).pipe(writeStream);

                await new Promise((resolve, reject) => {
                    //throw the error on error and reject the promise
                    writeStream.on('error', err => {
                        reject(err);
                        throw err;
                    });
                    // upon finish get the metadata
                    writeStream.on('finish', async () => {
                        try {
                            [metadata] = await file.getMetadata();
                            dbg.log1(`NamespaceGCP.upload_object: ${params.key} uploaded to ${this.bucket}.`);
                            resolve();
                        } catch (err) {
                            reject(err);
                            throw err;
                        }
                    });
                });

            } catch (err) {
                this._translate_error_code(err);
                dbg.warn('NamespaceGCP.upload_object:', inspect(err));
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: err.code || (err.errors[0] && err.errors[0].reason) || 'InternalError',
                    time: Date.now(),
                });
                throw err;
            }
        }
        return this._get_gcp_object_info(metadata);
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    async create_object_upload(params, object_sdk) {
        dbg.log0('NamespaceGCP.create_object_upload:', this.bucket, inspect(params));
        throw new S3Error(S3Error.NotImplemented);
    }

    async upload_multipart(params, object_sdk) {
        dbg.log0('NamespaceGCP.upload_multipart:', this.bucket, inspect(params));
        throw new S3Error(S3Error.NotImplemented);
    }

    async list_multiparts(params, object_sdk) {
        dbg.log0('NamespaceGCP.list_multiparts:', this.bucket, inspect(params));
        throw new S3Error(S3Error.NotImplemented);
    }

    async complete_object_upload(params, object_sdk) {
        dbg.log0('NamespaceGCP.complete_object_upload:', this.bucket, inspect(params));
        throw new S3Error(S3Error.NotImplemented);
    }

    async abort_object_upload(params, object_sdk) {
        dbg.log0('NamespaceGCP.abort_object_upload:', this.bucket, inspect(params));
        throw new S3Error(S3Error.NotImplemented);
    }

    //////////
    // ACLs //
    //////////

    async get_object_acl(params, object_sdk) {
        dbg.log0('NamespaceGCP.get_object_acl:', this.bucket, inspect(params));
        throw new S3Error(S3Error.NotImplemented);
    }

    async put_object_acl(params, object_sdk) {
        dbg.log0('NamespaceGCP.put_object_acl:', this.bucket, inspect(params));
        throw new S3Error(S3Error.NotImplemented);
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {
        // https://googleapis.dev/nodejs/storage/latest/File.html#delete
        dbg.log0('NamespaceGCP.delete_object:', this.bucket, inspect(params));
        try {
            const res = await this.gcs.bucket(this.bucket).file(params.key).delete();
            dbg.log1('NamespaceGCP.delete_object:', this.bucket, inspect(params), 'res', inspect(res));
            return {};
        } catch (err) {
            this._translate_error_code(err);
            throw err;
        }
    }

    async delete_multiple_objects(params, object_sdk) {
        // https://googleapis.dev/nodejs/storage/latest/File.html#delete
        dbg.log0('NamespaceGCP.delete_multiple_objects:', this.bucket, inspect(params));

        const res = await P.map_with_concurrency(10, params.objects, obj =>
            this.gcs.bucket(this.bucket).file(obj.key).delete()
            .then(() => ({}))
            .catch(err => ({ err_code: err.code, err_message: err.errors[0].reason || 'InternalError' })));

        dbg.log1('NamespaceGCP.delete_multiple_objects:', this.bucket, inspect(params), 'res', inspect(res));

        return res;

    }


    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    async get_object_tagging(params, object_sdk) {
        throw new Error('TODO');
    }
    async delete_object_tagging(params, object_sdk) {
        throw new Error('TODO');
    }
    async put_object_tagging(params, object_sdk) {
        throw new Error('TODO');
    }

    ///////////////////
    //  OBJECT LOCK  //
    ///////////////////

    async get_object_legal_hold() {
        throw new Error('TODO');
    }
    async put_object_legal_hold() {
        throw new Error('TODO');
    }
    async get_object_retention() {
        throw new Error('TODO');
    }
    async put_object_retention() {
        throw new Error('TODO');
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

    ///////////////
    // INTERNALS //
    ///////////////

    //TODO: add here the internal functions


    /**
     * @returns {nb.ObjectInfo}
     */
    _get_gcp_object_info(metadata) {
        dbg.log1(`_get_gcp_object_info: metadata: ${inspect(metadata)}`);
        return {
            obj_id: metadata.id,
            bucket: metadata.bucket,
            key: metadata.name,
            size: metadata.size,
            etag: metadata.etag,
            create_time: metadata.timeCreated,
            last_modified_time: metadata.updated,
            content_type: metadata.contentType,
            md5_b64: metadata.md5Hash,
        };
    }

    _translate_error_code(err) {
        // https://cloud.google.com/storage/docs/json_api/v1/status-codes
        if (err.code === 404) err.rpc_code = 'NO_SUCH_OBJECT';
        if (err.code === 403) err.rpc_code = 'FORBIDDEN';
    }
}

function inspect(x) {
    return util.inspect(_.omit(x, 'source_stream'), true, 5, true);
}

module.exports = NamespaceGCP;
