/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const crypto = require('crypto');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const blob_utils = require('../endpoint/blob/blob_utils');
const azure_storage = require('../util/new_azure_storage_wrap');
const stream_utils = require('../util/stream_utils');
const stats_collector = require('./endpoint_stats_collector');
const s3_utils = require('../endpoint/s3/s3_utils');
const schema_utils = require('../util/schema_utils');
const valid_attr_regex = /^[A-Za-z_][A-Za-z0-9_]+$/;

/**
 * @implements {nb.Namespace}
 */
class NamespaceBlob {

    constructor({ namespace_resource_id, rpc_client, connection_string, container, account_name, account_key, access_mode }) {
        this.namespace_resource_id = namespace_resource_id;
        this.connection_string = connection_string;
        this.container = container;
        this.blob = azure_storage.BlobServiceClient.fromConnectionString(connection_string);
        // needed only for generateBlockIdPrefix() and get_block_id() functions
        // TODO: replace old lib functions with new impl of block_id getters
        this.old_blob = azure_storage.get_old_blob_service_conn_string(connection_string);
        this.rpc_client = rpc_client;
        this.account_name = account_name;
        this.account_key = account_key;
        this.container_client = azure_storage.get_container_client(this.blob, this.container);
        this.access_mode = access_mode;
    }

    _get_blob_client(blob_name) {
        return azure_storage.get_blob_client(this.container_client, blob_name);
    }

    _generate_blob_url(container, blob, sas_token) {
        const sas_string = sas_token ? '?' + sas_token : '';
        return `https://${this.account_name}.blob.core.windows.net/${container}/${blob}${sas_string}`;
    }

    is_server_side_copy(other, params) {
        return other instanceof NamespaceBlob && this.connection_string === other.connection_string;
    }

    get_bucket() {
        return this.container;
    }

    get_write_resource() {
        return this;
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

    async list_objects(param, object_sdk) {
        const params = { ...param };
        const regex = '^\\d{1,9}!\\d{1,9}!';
        if (!(_.isUndefined(params.key_marker)) && params.key_marker.match(regex) === null) {
            dbg.log0(`Got an invalid marker: ${params.key_marker}, changing the marker into null`);
            params.key_marker = undefined;
        }
        dbg.log0('NamespaceBlob.list_objects:',
            this.container,
            inspect(params)
        );
        const max_keys = params.limit || 1000;
        let iterator;
        if (params.delimiter) {
            iterator = await this.container_client.listBlobsByHierarchy(
                params.delimiter, { prefix: params.prefix }).byPage({ continuationToken: params.key_marker, maxPageSize: max_keys });
        } else {
            iterator = await this.container_client.listBlobsFlat({ prefix: params.prefix })
                .byPage({ continuationToken: params.key_marker, maxPageSize: max_keys });
        }
        const response = (await iterator.next()).value;
        dbg.log0('list_objects: ', response.continuationToken, response.segment.blobItems, response.segment.blobPrefixes);

        return {
            objects: _.map(response.segment.blobItems, obj => this._get_blob_object_info(obj, params.bucket)),
            common_prefixes: _.map(response.segment.blobPrefixes, prefix => prefix.name),
            is_truncated: Boolean(response.continuationToken),
            next_marker: response.continuationToken
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
            const blob_client = this._get_blob_client(params.key);
            const obj = await blob_client.getProperties();
            dbg.log0('NamespaceBlob.read_object_md:',
                this.container,
                inspect(params),
                'obj', inspect(obj)
            );
            return this._get_blob_object_info({ ...obj, key: params.key }, params.bucket);

        } catch (err) {
            this._translate_error_code(err);
            dbg.warn('NamespaceBlob.read_object_md:', inspect(err));
            object_sdk.rpc_client.pool.update_issues_report({
                namespace_resource_id: this.namespace_resource_id,
                error_code: err.code || (err.details && err.details.errorCode) || 'InternalError',
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
            // we prefer not to resolve the promise until we know the stream really starts
            // so that NotFound errors or any error that is not related to streaming
            // will be returned as promise rejection instead of stream error.
            // once data is ready this is our trigger for resolving the promise and starting to stream
            count_stream.on('error', err => {
                dbg.warn('NamespaceBlob.read_object_stream:',
                    this.container,
                    inspect(_.omit(params, 'object_md.ns')),
                    'read_stream error', err
                );
                reject(err);
            });
            const on_readable = () => {
                count_stream.removeListener('readable', on_readable);
                dbg.log0('NamespaceBlob.read_object_stream:',
                    this.container,
                    inspect(_.omit(params, 'object_md.ns')),
                    'read_stream is readable'
                );
                resolve(count_stream);
            };
            count_stream.on('readable', on_readable);
            const blob_client = this._get_blob_client(params.key);

            blob_client.download(
                params.start,
                params.end - params.start,
            ).then(res => {
                dbg.log0('NamespaceBlob.read_object_stream:',
                    this.container,
                    inspect(_.omit(params, 'object_md.ns')),
                    'callback res', inspect(res)
                );
                if (!res.readableStreamBody) throw new Error('NamespaceBlob.read_object_stream: download response is invalid');
                return resolve(res.readableStreamBody.pipe(count_stream));
            }).catch(err => {
                    this._translate_error_code(err);
                    dbg.warn('NamespaceBlob.read_object_stream:',
                        this.container,
                        inspect(_.omit(params, 'object_md.ns')),
                        'callback err', inspect(err)
                    );
                    try {
                        count_stream.emit('error', err);
                    } catch (err2) {
                        // ignore, only needed if there is no error listeners
                    }
                    return reject(err);
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
        const blob_client = this._get_blob_client(params.key);
        if (params.copy_source) {
            if (params.copy_source.ranges) {
                throw new Error('NamespaceBlob.upload_object: copy source range not supported');
            }
            const sasToken = await this._get_sas_token(params.copy_source.bucket, params.copy_source.key, 'r'); // read permission
            const url = this._generate_blob_url(params.copy_source.bucket, params.copy_source.key, sasToken);
            obj = await blob_client.syncUploadFromURL(url);
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
                const { new_stream, md5_buf } = azure_storage.calc_body_md5(params.source_stream);
                const headers = {
                    blobContentType: params.content_type,
                };
                Object.defineProperty(headers, "blobContentMD5", {
                    get: () => md5_buf()
                });

                obj = await blob_client.uploadStream(
                    new_stream.pipe(count_stream),
                    params.size,
                    undefined, {
                        metadata: params.xattr,
                        blobHTTPHeaders: headers
                    }
                );
                obj.contentMD5 = md5_buf();

            } catch (err) {
                this._translate_error_code(err);
                dbg.warn('NamespaceBlob.upload_object:', inspect(err));
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: err.code || (err.details && err.details.errorCode) || 'InternalError',
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
        const blob_client = this._get_blob_client(params.key);
        await blob_client.stageBlock(
            params.block_id,
            () => params.source_stream.pipe(count_stream),
            params.size // streamLength really required ???
        );
    }

    async commit_blob_block_list(params) {
        // node sdk does not support the full rest api capability to mix committed\uncommitted blocks
        // if we send both committed and uncommitted lists we can't control the order.
        // for now if there is a mix sent by the client, convert all to latest which is the more common case.
        //const is_mix = _.uniqBy(params.block_list, 'type').length > 1;
        //const list_to_use = is_mix ? 'LatestBlocks' : MAP_BLOCK_LIST_TYPE[params.block_list[0].type];
        // const block_list = {};
        //block_list[list_to_use] = params.block_list.map(block => block.block_id);
        const blob_client = this._get_blob_client(params.key);
        return blob_client.commitBlockList(params.block_list);
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
        const blob_client = this._get_blob_client(params.key);
        // TODO: this is not the correct function - but this whole function not in use
        // delete or do the correct changes
        const list_blocks_res = await blob_client.getBlockList(list_type);
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
        const is_invalid_attr = ([key, val]) => !valid_attr_regex.test(key);
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
        const block_id = azure_storage.get_block_id(this.old_blob, params.obj_id, params.num);
        const block_id_base64 = Buffer.from(block_id).toString('base64');
        let res;
        dbg.log0('NamespaceBlob.upload_multipart:',
            this.container,
            inspect(_.omit(params, 'source_stream')),
            'block_id', block_id,
            'block_id_base64', block_id_base64
        );
        const blob_client = this._get_blob_client(params.key);
        if (params.copy_source) {

            const start = params.copy_source.ranges ? params.copy_source.ranges[0].start : 0;
            const end = params.copy_source.ranges ? params.copy_source.ranges[0].end : params.size;

            const maxCopySource = 100 * 1024 * 1024;
            if (end - start > maxCopySource) {
                throw new Error('The specified copy source is larger than the maximum allowable size for a copy source (100mb).');
            }
            const sasToken = await this._get_sas_token(params.copy_source.bucket, params.copy_source.key, 'r'); // read permission
            const url = this._generate_blob_url(params.copy_source.bucket, params.copy_source.key, sasToken);

            res = await blob_client.stageBlockFromURL(
                block_id_base64,
                url,
                start,
                end - start); // TODO: check that end is ok when ranges provided
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
                res = await blob_client.stageBlock(
                    block_id_base64,
                    () => params.source_stream.pipe(count_stream),
                    params.size // streamLength really required ???
                );
            } catch (err) {
                object_sdk.rpc_client.pool.update_issues_report({
                    namespace_resource_id: this.namespace_resource_id,
                    error_code: err.code || (err.details && err.details.errorCode) || 'InternalError',
                    time: Date.now(),
                });
                throw err;
            }
        }
        dbg.log0('NamespaceBlob.upload_multipart:',
            this.container,
            inspect(_.omit(params, 'source_stream')),
            'block_id', block_id,
            'block_id_base64', block_id_base64,
            'res', inspect(res)
        );
        const hex_etag = Buffer.from(block_id_base64, 'base64').toString('hex');
        dbg.log0('ETAg: ', hex_etag);
        return {
            etag: hex_etag,
        };
    }

    async _get_sas_token(container, block_key, permission) {

        const start_date = new Date();
        const expiry_date = new Date(start_date);
        expiry_date.setMinutes(start_date.getMinutes() + 10);
        start_date.setMinutes(start_date.getMinutes() - 10);
        const ssk = new azure_storage.StorageSharedKeyCredential(this.account_name, this.account_key);

        return azure_storage.generateBlobSASQueryParameters({
            containerName: container,
            blobName: block_key,
            permissions: azure_storage.ContainerSASPermissions.parse(permission),
            expiresOn: expiry_date,
            startsOn: start_date
        }, ssk).toString();
    }

    async list_multiparts(params, object_sdk) {
        dbg.log0('NamespaceBlob.list_multiparts:',
            this.container,
            inspect(params)
        );
        const blob_client = this._get_blob_client(params.key);
        const res = await blob_client.getBlockList('uncommitted');

        dbg.log0('NamespaceBlob.list_multiparts:',
            this.container,
            inspect(params),
            'res', inspect(res)
        );
        return {
            is_truncated: false,
            multiparts: _.map(res.uncommittedBlocks, block => {
                const buf = Buffer.from(block.name, 'base64');
                return ({
                    num: parseInt(buf.toString().split('-')[1], 10),
                    size: block.size,
                    etag: buf.toString('hex'),
                    last_modified: new Date(),
                });
            })
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
            const block_id = Buffer.from(part.etag, 'hex').toString('base64');
            md5_hash.update(block_id);
            return block_id;
        });
        const md5_hex = md5_hash.digest('hex');

        const options = {
            blobHTTPHeaders: {
                blobContentMD5: Buffer.from(md5_hex, 'hex') // TODO: check that before & after the change the MD5 was uploaded 
            }
        };
        const blob_client = this._get_blob_client(params.key);
        const obj = await blob_client.commitBlockList(block_list, options);

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
                await blob_client.setMetadata(obj_md.xattr);

                await object_sdk.rpc_client.object.abort_object_upload({
                    key: params.key,
                    bucket: params.bucket,
                    obj_id
                });
            }
        }

        const res = this._get_blob_object_info(obj, params.bucket);
        res.etag = md5_hex + '-' + num_parts;
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

        const res = await this.container_client.deleteBlob(params.key);

        dbg.log0('NamespaceBlob.delete_object:',
            this.container,
            inspect(params),
            'res', inspect(res)
        );

        return {};
    }

    async delete_multiple_objects(params, object_sdk) {
        dbg.log0('NamespaceBlob.delete_multiple_objects:', this.container, inspect(params));

        const res = await P.map_with_concurrency(10, params.objects, obj =>
            this.container_client.deleteBlob(obj.key)
            .then(() => ({}))
            .catch(err => ({ err_code: 'InternalError', err_message: err.message || 'InternalError' })));

        dbg.log0('NamespaceBlob.delete_multiple_objects:',
            this.container,
            inspect(params),
            'res', inspect(res)
        );

        return res;
    }

    // TODO: check contentSettings replcae etc
    // TODO: Implement tagging on objects
    /**
     * @returns {nb.ObjectInfo}
     */
    _get_blob_object_info(obj, bucket) {
        // list objects returns properties
        // head object returns flat
        const flat_obj = obj.properties || obj;
        const blob_etag = blob_utils.parse_etag(flat_obj.etag);
        const md5_b64 = flat_obj.contentMD5 || '';
        const md5_hex = Buffer.from(md5_b64, 'base64').toString('hex');
        const etag = md5_hex || blob_etag;
        const size = parseInt(flat_obj.contentLength, 10);
        const xattr = _.extend(obj.metadata, {
            'noobaa-namespace-blob-container': this.container,
        });
        return {
            obj_id: blob_etag,
            bucket,
            key: obj.name,
            size,
            etag,
            create_time: flat_obj.lastModified,
            content_type: flat_obj.contentType,
            xattr
        };
    }

    _translate_error_code(err) {
        if (err.code || (err.details && err.details.errorCode) === 'BlobNotFound') err.rpc_code = 'NO_SUCH_OBJECT';
        if (err.code || (err.details && err.details.errorCode) === 'InvalidMetadata') err.rpc_code = 'INVALID_REQUEST';
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

    ///////////////////
    //    TAGGING    //
    ///////////////////

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
    //      ULS      //
    ///////////////////

    async create_uls() {
        throw new Error('TODO');
    }
    async delete_uls() {
        throw new Error('TODO');
    }

}

function inspect(x) {
    return util.inspect(x, true, 5, true);
}

module.exports = NamespaceBlob;
