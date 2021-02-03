/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const stream = require('stream');
const crypto = require('crypto');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const blob_utils = require('../endpoint/blob/blob_utils');
const azure_storage = require('../util/azure_storage_wrap');
const stream_utils = require('../util/stream_utils');
const stats_collector = require('./endpoint_stats_collector');
const s3_utils = require('../endpoint/s3/s3_utils');
const schema_utils = require('../util/schema_utils');

const MAP_BLOCK_LIST_TYPE = Object.freeze({
    uncommitted: 'UncommittedBlocks',
    latest: 'LatestBlocks',
    committed: 'CommittedBlocks'
});


/**
 * @implements {nb.Namespace}
 */
class NamespaceBlob {

    constructor({ namespace_resource_id, rpc_client, connection_string, container, account_name }) {
        this.namespace_resource_id = namespace_resource_id;
        this.connection_string = connection_string;
        this.container = container;
        this.blob = azure_storage.createBlobService(connection_string);
        this.rpc_client = rpc_client;
        this.account_name = account_name;
    }

    is_same_namespace(other) {
        return other instanceof NamespaceBlob && this.connection_string === other.connection_string;
    }

    get_bucket() {
        return this.container;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    async list_objects(param, object_sdk) {
        const params = { ...param };
        const regex = '^\\d{1,9}!\\d{1,9}!';
        if (!(_.isUndefined(params.key_marker)) && params.key_marker.match(regex) === null) {
            dbg.log0(`Got an invalid marker: ${params.key_marker}, changing the marker into null`);
            params.key_marker = null;
        }

        dbg.log0('NamespaceBlob.list_objects:',
            this.container,
            inspect(params)
        );

        const sasToken = await this._get_sas_token(this.container, undefined, azure_storage.BlobUtilities.SharedAccessPermissions.LIST);
        // Azure blob SDK does not allow list blobs and dirs in one request but it is possible when calling directly to the API.
        // https://github.com/Azure/azure-storage-node/blob/8afb26eda981581381e3358cbb3a5c0ddb51465d/lib/services/blob/blobservice.core.js#L5757
        // calling list blobs and list directories seperatley may cause 0-2 unsynced continuation tokens.
        // because of the descripted problem we call directly to the blob API.
        const { blobs, dirs, next_marker } = await blob_utils.list_objects(params, this.account_name, this.container, sasToken);

        dbg.log2('NamespaceBlob.list_objects:',
            this.container,
            inspect(params),
            'blobs', inspect(blobs),
            'dirs', inspect(dirs)
        );

        return {
            objects: _.map(blobs, obj => this._get_blob_object_info(obj, params.bucket)),
            common_prefixes: _.map(dirs, dir => dir.Name[0]),
            is_truncated: Boolean(next_marker),
            next_marker
        };
    }

    async list_uploads(params, object_sdk) {
        dbg.log0('NamespaceBlob.list_uploads:',
            this.container,
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
        dbg.log0('NamespaceBlob.list_object_versions:',
            this.container,
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

    async read_object_md(params, object_sdk) {
        try {
            dbg.log0('NamespaceBlob.read_object_md:',
                this.container,
                inspect(params)
            );
            const obj = await P.fromCallback(callback =>
                this.blob.getBlobProperties(
                    this.container,
                    params.key,
                    callback)
            );
            dbg.log0('NamespaceBlob.read_object_md:',
                this.container,
                inspect(params),
                'obj', inspect(obj)
            );
            return this._get_blob_object_info(obj, params.bucket);

        } catch (err) {
            this._translate_error_code(err);
            dbg.warn('NamespaceBlob.read_object_md:', inspect(err));
            object_sdk.rpc_client.pool.update_issues_report({
                namespace_resource_id: this.namespace_resource_id,
                error_code: err.code,
                time: Date.now(),
            });
            throw err;
        }
    }

    read_object_stream(params, object_sdk) {
        dbg.log0('NamespaceBlob.read_object_stream:',
            this.container,
            inspect(_.omit(params, 'object_md.ns'))
        );
        return new Promise((resolve, reject) => {
            let count = 1;
            const count_stream = stream_utils.get_tap_stream(data => {
                stats_collector.instance(this.rpc_client).update_namespace_read_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    size: data.length,
                    count
                });
                // clear count for next updates
                count = 0;
            });
            const read_stream = new stream.PassThrough();
            // we prefer not to resolve the promise until we know the stream really starts
            // so that NotFound errors or any error that is not related to streaming
            // will be returned as promise rejection instead of stream error.
            // once data is ready this is our trigger for resolving the promise and starting to stream
            read_stream.on('error', err => {
                dbg.warn('NamespaceBlob.read_object_stream:',
                    this.container,
                    inspect(_.omit(params, 'object_md.ns')),
                    'read_stream error', err
                );
                reject(err);
            });
            const on_readable = () => {
                read_stream.removeListener('readable', on_readable);
                dbg.log0('NamespaceBlob.read_object_stream:',
                    this.container,
                    inspect(_.omit(params, 'object_md.ns')),
                    'read_stream is readable'
                );
                resolve(read_stream.pipe(count_stream));
            };
            read_stream.on('readable', on_readable);
            const options = {
                skipSizeCheck: true,
            };
            if (params.end) {
                options.rangeStart = params.start;
                options.rangeEnd = params.end;
            }
            this.blob.getBlobToStream(
                this.container,
                params.key,
                read_stream,
                options,
                (err, res) => {
                    if (err) {
                        this._translate_error_code(err);
                        dbg.warn('NamespaceBlob.read_object_stream:',
                            this.container,
                            inspect(_.omit(params, 'object_md.ns')),
                            'callback err', inspect(err)
                        );
                        try {
                            read_stream.emit('error', err);
                        } catch (err2) {
                            // ignore, only needed if there is no error listeners
                        }
                        return reject(err);
                    }
                    dbg.log0('NamespaceBlob.read_object_stream:',
                        this.container,
                        inspect(_.omit(params, 'object_md.ns')),
                        'callback res', inspect(res)
                    );
                    return resolve(read_stream.pipe(count_stream));
                }
            );
        });
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    async upload_object(params, object_sdk) {
        dbg.log0('NamespaceBlob.upload_object:',
            this.container,
            inspect(_.omit(params, 'source_stream'))
        );
        let obj;
        if (params.copy_source) {
            if (params.copy_source.ranges) {
                throw new Error('NamespaceBlob.upload_object: copy source range not supported');
            }
            obj = await P.fromCallback(callback =>
                this.blob.startCopyBlob(
                    this.blob.getUrl(params.copy_source.bucket, params.copy_source.key),
                    this.container,
                    params.key,
                    callback
                )
            );
        } else {
            let count = 1;
            const count_stream = stream_utils.get_tap_stream(data => {
                stats_collector.instance(this.rpc_client).update_namespace_write_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    size: data.length,
                    count
                });
                // clear count for next updates
                count = 0;
            });

            this._check_valid_xattr(params);
            try {
                obj = await P.fromCallback(callback =>
                    this.blob.createBlockBlobFromStream(
                        this.container,
                        params.key,
                        params.source_stream.pipe(count_stream),
                        params.size, // streamLength really required ???
                        {
                            metadata: params.xattr,
                            contentSettings: {
                                contentType: params.content_type,
                            }
                        },
                        callback));
            } catch (err) {
                this._translate_error_code(err);
                dbg.warn('NamespaceBlob.upload_object:', inspect(err));
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: err.code,
                    time: Date.now(),
                });
                throw err;
            }
        }

        dbg.log0('NamespaceBlob.upload_object:',
            this.container,
            inspect(_.omit(params, 'source_stream')),
            'obj', inspect(obj)
        );
        return this._get_blob_object_info(obj, params.bucket);
    }


    ////////////////////////
    // BLOCK BLOB UPLOADS //
    ////////////////////////

    async upload_blob_block(params, object_sdk) {
        dbg.log0('NamespaceBlob.upload_blob_block:',
            this.container,
            inspect(_.omit(params, 'source_stream'))
        );
        if (params.copy_source) {
            throw new Error('NamespaceBlob.upload_blob_block: copy source not yet supported');
        }

        let count = 1;
        const count_stream = stream_utils.get_tap_stream(data => {
            stats_collector.instance(this.rpc_client).update_namespace_write_stats({
                namespace_resource_id: this.namespace_resource_id,
                size: data.length,
                count
            });
            // clear count for next updates
            count = 0;
        });
        await P.fromCallback(callback =>
            this.blob.createBlockFromStream(
                params.block_id,
                this.container,
                params.key,
                params.source_stream.pipe(count_stream),
                params.size, // streamLength really required ???
                callback)
        );
    }

    async commit_blob_block_list(params) {
        // node sdk does not support the full rest api capability to mix committed\uncommitted blocks
        // if we send both committed and uncommitted lists we can't control the order.
        // for now if there is a mix sent by the client, convert all to latest which is the more common case.
        const is_mix = _.uniqBy(params.block_list, 'type').length > 1;
        const list_to_use = is_mix ? 'LatestBlocks' : MAP_BLOCK_LIST_TYPE[params.block_list[0].type];
        const block_list = {};
        block_list[list_to_use] = params.block_list.map(block => block.block_id);
        return P.fromCallback(callback => this.blob.commitBlocks(params.bucket, params.key, block_list, callback));
    }

    async get_blob_block_lists(params) {
        let list_type;
        if (params.requested_lists.committed && params.requested_lists.uncommitted) {
            list_type = 'ALL';
        } else if (params.requested_lists.uncommitted) {
            list_type = 'uncommitted';
        } else {
            list_type = 'committed';
        }
        const list_blocks_res = await P.fromCallback(callback => this.blob.listBlocks(params.bucket, params.key, list_type, callback));
        const response = {};
        if (list_blocks_res.CommittedBlocks) {
            response.committed = list_blocks_res.CommittedBlocks.map(block => ({ block_id: block.Name, size: block.Size }));
        }
        if (list_blocks_res.UncommittedBlocks) {
            response.uncommitted = list_blocks_res.CommittedBlocks.map(block => ({ block_id: block.Name, size: block.Size }));
        }
        return response;
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    async create_object_upload(params, object_sdk) {
        // azure blob does not have start upload operation
        // instead starting multipart upload is implicit
        let upload;
        if (params.xattr && Object.keys(params.xattr).length > 0) {
            try {
                this._check_valid_xattr(params);
                upload = await object_sdk.rpc_client.object.create_object_upload(params);
                dbg.log0('NamespaceBlob: creating multipart upload object md', inspect(params), upload.obj_id);
            } catch (err) {
                this._translate_error_code(err);
                dbg.error('NamespaceBlob: error in creating multipart upload object md', err);
                throw err;
            }
        }
        // obj_id contains the upload obj_id that is stored in db OR  obj_id contains a random string of bytes
        // using the first option when need to store xattr and set it after complete multipart upload phase  
        const obj_id = upload ? Buffer.from(upload.obj_id).toString('base64') : crypto.randomBytes(24).toString('base64');

        dbg.log0('NamespaceBlob.create_object_upload:',
            this.container,
            inspect(params),
            'obj_id', obj_id
        );
        return { obj_id };
    }

    _check_valid_xattr(params) {
        // This md validation check is a part of namespace blob because but Azure Blob 
        // accepts C# identifiers only but S3 accepts other xattr too.
        const is_invalid_attr = ([key, val]) => !(/^[A-Za-z_][A-Za-z0-9_]+$/).test(key);
        const invalid_attr = Object.entries(params.xattr).find(is_invalid_attr);
        if (invalid_attr) {
            const err = new Error('InvalidMetadata: metadata keys are invalid.');
            err.rpc_code = 'INVALID_REQUEST';
            throw err;
        }
    }

    async upload_multipart(params, object_sdk) {
        // generating block ids in the form: '95342c3f-000005'
        // this is needed mostly since azure requires all the block_ids to have the same fixed length
        const block_id = this.blob.getBlockId(params.obj_id, params.num);
        let res;
        dbg.log0('NamespaceBlob.upload_multipart:',
            this.container,
            inspect(_.omit(params, 'source_stream')),
            'block_id', block_id
        );
        if (params.copy_source) {

            const start = params.copy_source.ranges ? params.copy_source.ranges[0].start : 0;
            const end = params.copy_source.ranges ? params.copy_source.ranges[0].end : params.size;

            const maxCopySource = 100 * 1024 * 1024;
            if (end - start > maxCopySource) {
                throw new Error('The specified copy source is larger than the maximum allowable size for a copy source (100mb).');
            }

            const sasToken = await this._get_sas_token(this.container, params.copy_source.key,
                azure_storage.BlobUtilities.SharedAccessPermissions.READ);
            const url = this.blob.getUrl(params.copy_source.bucket, params.copy_source.key, sasToken);

            res = await P.fromCallback(callback =>
                this.blob.createBlockFromURL(
                    block_id,
                    this.container,
                    params.key,
                    url,
                    start,
                    end - 1,
                    callback)
            );
        } else {
            let count = 1;
            const count_stream = stream_utils.get_tap_stream(data => {
                stats_collector.instance(this.rpc_client).update_namespace_write_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    size: data.length,
                    count
                });
                // clear count for next updates
                count = 0;
            });
            try {
                res = await P.fromCallback(callback =>
                    this.blob.createBlockFromStream(
                        block_id,
                        this.container,
                        params.key,
                        params.source_stream.pipe(count_stream),
                        params.size, // streamLength really required ???
                        callback)
                );
            } catch (err) {
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: err.code,
                    time: Date.now(),
                });
                throw err;
            }
        }
        dbg.log0('NamespaceBlob.upload_multipart:',
            this.container,
            inspect(_.omit(params, 'source_stream')),
            'block_id', block_id,
            'res', inspect(res)
        );
        const block_id_hex = Buffer.from(block_id).toString('hex');
        return {
            etag: block_id_hex,
        };
    }

    async _get_sas_token(container, block_key, permission) {

        const start_date = new Date();
        const expiry_date = new Date(start_date);
        expiry_date.setMinutes(start_date.getMinutes() + 10);
        start_date.setMinutes(start_date.getMinutes() - 10);
        const shared_access_policy = {
            AccessPolicy: {
                Permissions: permission,
                Start: start_date,
                Expiry: expiry_date
            },
        };
        return this.blob.generateSharedAccessSignature(container, block_key, shared_access_policy);
    }

    async list_multiparts(params, object_sdk) {
        dbg.log0('NamespaceBlob.list_multiparts:',
            this.container,
            inspect(params)
        );

        const res = await P.fromCallback(callback =>
            this.blob.listBlocks(
                this.container,
                params.key,
                azure_storage.BlobUtilities.BlockListFilter.UNCOMMITTED,
                callback)
        );

        dbg.log0('NamespaceBlob.list_multiparts:',
            this.container,
            inspect(params),
            'res', inspect(res)
        );
        return {
            is_truncated: false,
            multiparts: _.map(res.UncommittedBlocks, b => ({
                num: parseInt(b.Name.split('-')[1], 10),
                size: b.Size,
                etag: Buffer.from(b.Name).toString('hex'),
                last_modified: new Date(),
            }))
        };
    }

    async complete_object_upload(params, object_sdk) {
        dbg.log0('NamespaceBlob.complete_object_upload:',
            this.container,
            inspect(params)
        );
        const num_parts = params.multiparts.length;
        const part_by_num = _.keyBy(params.multiparts, 'num');
        const md5_hash = crypto.createHash('md5');
        const block_list = _.times(num_parts, num => {
            const part = part_by_num[num + 1];
            const block_id = Buffer.from(part.etag, 'hex').toString('ascii');
            md5_hash.update(block_id);
            return block_id;
        });
        const block_obj = { UncommittedBlocks: block_list };
        const obj = await P.fromCallback(callback =>
            this.blob.commitBlocks(
                this.container,
                params.key,
                block_obj,
                callback)
        );

        dbg.log0('NamespaceBlob.complete_object_upload:',
            this.container,
            inspect(params),
            'obj', inspect(obj)
        );

        const obj_id = Buffer.from(params.obj_id, 'base64').toString();
        if (schema_utils.is_object_id(obj_id)) {
            let obj_md = await object_sdk.rpc_client.object.read_object_md({
                obj_id,
                bucket: params.bucket,
                key: params.key
            });
            dbg.log0('NamespaceBlob.complete_object_upload:',
                this.container,
                inspect(params),
                'obj_md', inspect(obj_md)
            );
            if (obj_md && obj_md.xattr) {
                await P.fromCallback(callback => this.blob.setBlobMetadata(this.container,
                    params.key, obj_md.xattr, callback));

                await object_sdk.rpc_client.object.abort_object_upload({
                    key: params.key,
                    bucket: params.bucket,
                    obj_id
                });
            }
        }

        const res = this._get_blob_object_info(obj, params.bucket);
        res.etag = md5_hash.digest('hex') + '-' + num_parts;
        return res;
    }

    async abort_object_upload(params, object_sdk) {
        // azure blob does not have abort upload operation
        // instead it will garbage collect blocks after 7 days
        // so we simply ignore the abort operation
        dbg.log0('NamespaceBlob.abort_object_upload:',
            this.container,
            inspect(params),
            'noop'
        );
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    async delete_object(params, object_sdk) {
        dbg.log0('NamespaceBlob.delete_object:', this.container, inspect(params));

        const res = await P.fromCallback(
            callback => this.blob.deleteBlob(this.container, params.key, callback)
        );

        dbg.log0('NamespaceBlob.delete_object:',
            this.container,
            inspect(params),
            'res', inspect(res)
        );

        return {};
    }

    async delete_multiple_objects(params, object_sdk) {
        dbg.log0('NamespaceBlob.delete_multiple_objects:', this.container, inspect(params));

        const res = await P.map_with_concurrency(10, params.objects, obj => P.fromCallback(
                callback => this.blob.deleteBlob(this.container, obj.key, callback)
            )
            .then(() => ({}))
            .catch(err => ({ err_code: 'InternalError', err_message: err.message || 'InternalError' })));

        dbg.log0('NamespaceBlob.delete_multiple_objects:',
            this.container,
            inspect(params),
            'res', inspect(res)
        );

        return res;
    }

    // TODO: Implement tagging on objects
    _get_blob_object_info(obj, bucket) {
        const blob_etag = blob_utils.parse_etag(obj.etag);
        const md5_b64 = (obj.contentSettings && obj.contentSettings.contentMD5) || '';
        const md5_hex = Buffer.from(md5_b64, 'base64').toString('hex');
        const etag = md5_hex || blob_etag;
        const size = parseInt(obj.contentLength, 10);
        const xattr = _.extend(obj.metadata, {
            'noobaa-namespace-blob-container': this.container,
        });
        return {
            obj_id: blob_etag,
            bucket,
            key: obj.name,
            size,
            etag,
            create_time: new Date(obj.lastModified),
            content_type: obj.contentSettings && obj.contentSettings.contentType,
            xattr
        };
    }

    _translate_error_code(err) {
        if (err.code === 'NotFound') err.rpc_code = 'NO_SUCH_OBJECT';
        if (err.code === 'InvalidMetadata') err.rpc_code = 'INVALID_REQUEST';
    }

    //////////
    // ACLs //
    //////////

    async get_object_acl(params, object_sdk) {
        await this.read_object_md(params, object_sdk);
        return s3_utils.DEFAULT_OBJECT_ACL;
    }

    async put_object_acl(params, object_sdk) {
        await this.read_object_md(params, object_sdk);
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


}

function inspect(x) {
    return util.inspect(x, true, 5, true);
}

module.exports = NamespaceBlob;
