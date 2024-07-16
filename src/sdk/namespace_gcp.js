/* Copyright (C) 2023 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');

const P = require('../util/promise');
const stream_utils = require('../util/stream_utils');
const dbg = require('../util/debug_module')(__filename);
const S3Error = require('../endpoint/s3/s3_errors').S3Error;
// we use this wrapper to set a custom user agent
const GoogleCloudStorage = require('../util/google_storage_wrap');

/**
 * @implements {nb.Namespace}
 */
class NamespaceGCP {

    /**
     * @param {{
    *      namespace_resource_id: string,
    *      project_id: string,
    *      target_bucket: string,
    *      client_email: string,
    *      private_key: string,
    *      access_mode: string,
    *      stats: import('./endpoint_stats_collector').EndpointStatsCollector,
    * }} params
    */
    constructor({
        namespace_resource_id,
        project_id,
        target_bucket,
        client_email,
        private_key,
        access_mode,
        stats,
    }) {
        this.namespace_resource_id = namespace_resource_id;
        this.project_id = project_id;
        this.client_email = client_email;
        this.private_key = private_key;
        this.gcs = new GoogleCloudStorage({
            projectId: this.project_id,
            credentials: {
                client_email: this.client_email,
                private_key: this.private_key,
            }
        });
        this.bucket = target_bucket;
        this.access_mode = access_mode;
        this.stats = stats;
    }

    get_write_resource() {
        return this;
    }

    is_server_side_copy(other, other_md, params) {
        //TODO: what is the case here, what determine server side copy? 
        return other instanceof NamespaceGCP &&
            this.private_key === other.private_key &&
            this.client_email === other.client_email;
    }

    get_bucket() {
        return this.bucket;
    }

    is_readonly_namespace() {
        return this.access_mode === 'READ_ONLY';
    }


    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(params, object_sdk) {
        dbg.log0('NamespaceGCP.list_objects:', this.bucket, inspect(params));

        const bucket = this.gcs.bucket(this.bucket);

        const delimiter = params.delimiter || '/';
        const prefix = params.prefix || '';
        const maxResults = params.limit || 1000;
        const pageToken = params.key_marker || null;

        // https://googleapis.dev/nodejs/storage/6.9.4/global.html#GetFilesOptions
        const options = {
            autoPaginate: false,
            delimiter,
            prefix,
            maxResults,
            pageToken,
        };

        // https://googleapis.dev/nodejs/storage/latest/Bucket.html#getFiles
        const [files, next_token, additional_info] = await bucket.getFiles(options);

        // When there is no next page, and we got all the object the next_token will be null.
        const is_truncated = next_token !== null;
        const next_marker = is_truncated ? next_token.pageToken : null;

        dbg.log4('NamespaceGCP.list_objects:', this.bucket,
            'files:', inspect(files),
            'next_token:', inspect(next_token),
            'additional_info:', inspect(additional_info));

        return {
            objects: _.map(files, obj => this._get_gcp_object_info(obj.metadata)),
            common_prefixes: additional_info.prefixes || [],
            is_truncated,
            next_marker,
        };
    }

    /**
     * _get_object_owner in the future we will return object owner
     * currently not implemented because ACLs are not implemented as well
     */
    _get_object_owner() {
        return undefined;
    }

    async list_uploads(params, object_sdk) {
        dbg.log0('NamespaceGCP.list_uploads:',
            this.bucket,
            inspect(params)
        );
        // TODO list uploads
        return {
            objects: [],
            common_prefixes: [],
            is_truncated: false,
        };
    }

    async list_object_versions(params, object_sdk) {
        dbg.log0('NamespaceGCP.list_object_versions:',
            this.bucket,
            inspect(params)
        );
        // TODO list object versions
        return {
            objects: [],
            common_prefixes: [],
            is_truncated: false,
        };
    }


    /////////////////
    // OBJECT READ //
    /////////////////

    /**
     * @returns {Promise<nb.ObjectInfo>}
     */
    async read_object_md(params, object_sdk) {
        dbg.log0('NamespaceGCP.read_object_md:', this.bucket, inspect(params));
        const file = this.gcs.bucket(this.bucket).file(params.key);
        let metadata;
        try {
            [metadata] = await file.getMetadata();
        } catch (err) {
            this._translate_error_code(err);
            dbg.warn('NamespaceGCP.read_object_md:', inspect(err));
            throw err;
        }

        return this._get_gcp_object_info(metadata);
    }

    async read_object_stream(params, object_sdk) {
        dbg.log0('NamespaceGCP.read_object_stream:', this.bucket, inspect(_.omit(params, 'object_md.ns')));
        return new Promise((resolve, reject) => {
            const file = this.gcs.bucket(this.bucket).file(params.key);
            // https://googleapis.dev/nodejs/storage/latest/File.html#createReadStream
            // for the options of createReadStream: 
            // https://googleapis.dev/nodejs/storage/latest/global.html#CreateReadStreamOptions
            const options = {
                start: params.start,
                end: params.end,
            };
            const read_stream = file.createReadStream(options);

            // upon error reject the promise
            read_stream.on('error', reject);
            // upon response resolve the promise using the count_stream piped from read_stream
            read_stream.on('response', () => {
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
                stream_utils.pipeline([read_stream, count_stream], true);
                resolve(count_stream);
            });
        });
    }


    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        dbg.log0('NamespaceGCP.upload_object:', this.bucket, inspect(params));

        let metadata;
        if (params.copy_source) {
            if (params.copy_source.ranges) {
                throw new Error('NamespaceGCP.upload_object: copy source range not supported');
            }
            const src_bucket = this.gcs.bucket(params.copy_source.bucket);
            const src_file = src_bucket.file(params.copy_source.key);
            // Currently not copying between 2 gcp buckets, 
            // for copying between 2 we need to have the gcp bucket as a namespace and reachable, 
            // and to verify that it is another instance of NamespaceGCP
            // const dest_bucket = this.gcs.bucket(params.copy_source.bucket);
            // const dest_file = dest_bucket.file(params.key);
            const dest_file = params.key;

            // https://googleapis.dev/nodejs/storage/latest/File.html#copy
            // for the options of copy:
            // https://googleapis.dev/nodejs/storage/latest/global.html#CopyOptions
            const options = {
                contentType: params.content_type,
                metadata: {
                    md5Hash: params.md5_b64,
                },
            };
            const res = await src_file.copy(dest_file, options);
            metadata = res[1].resource;
        } else {
            try {
                let count = 1;
                const count_stream = stream_utils.get_tap_stream(data => {
                    this.stats?.update_namespace_write_stats({
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
                stream_utils.pipeline([params.source_stream, count_stream, writeStream], true);

                await new Promise((resolve, reject) => {
                    // upon error reject the promise
                    writeStream.on('error', reject);
                    // upon finish resolve the promise
                    writeStream.on('finish', resolve);
                    // upon response get the metadata
                    writeStream.on('response', resp => {
                        dbg.log1(`NamespaceGCP.upload_object: response event ${inspect(resp)}.`);
                        metadata = resp.data;
                    });
                });
                dbg.log1(`NamespaceGCP.upload_object: ${params.key} uploaded to ${this.bucket}.`);
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
    /*
    NooBaa does not support ACLs - not for buckets, nor objects.
    However, some S3 clients fail to function entirely without a valid response to execution of ACL operations.
    Thus, we opted to implement a faux-support for the operation - enough to allow the clients to work, but still without supporting ACLs.
    The reason that read_object_md() is used, is to allow potential errors to rise up if necessary -
    for example, if the user tries to interact with an object that does not exist, the operation would fail as expected with NoSuchObject.
    */
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

    //////////////////////////
    // AZURE BLOB MULTIPART //
    //////////////////////////

    async upload_blob_block(params, object_sdk) {
        throw new Error('TODO');
    }
    async commit_blob_block_list(params, object_sdk) {
        throw new Error('TODO');
    }
    async get_blob_block_lists(params, object_sdk) {
        throw new Error('TODO');
    }

    ////////////////////
    // OBJECT RESTORE //
    ////////////////////

    async restore_object(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
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
        const xattr = _.extend(metadata.metadata, {
            'noobaa-namespace-gcp-bucket': metadata.bucket,
        });
        const object_owner = this._get_object_owner();
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
            xattr,
            is_latest: true,
            delete_marker: false,
            version_id: metadata.id,
            tag_count: 0,
            tagging: undefined,
            num_parts: undefined,
            sha256_b64: undefined,
            lock_settings: undefined,
            encryption: undefined,
            stats: undefined,
            object_owner
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
