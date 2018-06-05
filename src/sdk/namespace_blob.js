/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const stream = require('stream');
const crypto = require('crypto');
const url = require('url');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const blob_utils = require('../endpoint/blob/blob_utils');
const azure_storage = require('../util/azure_storage_wrap');

class NamespaceBlob {

    constructor({ connection_string, container, proxy }) {
        this.connection_string = connection_string;
        this.container = container;
        this.blob = azure_storage.createBlobService(connection_string);
        this.blob.setProxy(this.proxy ? url.parse(this.proxy) : null);
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

    list_objects(params, object_sdk) {
        dbg.log0('NamespaceBlob.list_objects:',
            this.container,
            inspect(params)
        );

        return P.resolve()
            .then(() => {
                const options = {
                    delimiter: params.delimiter,
                    maxResults: params.limit === 0 ? 1 : params.limit
                };
                const request_token = params.key_marker && {
                    targetLocation: 0,
                    nextMarker: params.key_marker
                };
                // TODO the sdk forces us to send two separate requests for blobs and dirs
                // although the api returns both, so we might want to bypass the sdk
                return P.join(
                    P.fromCallback(callback =>
                        this.blob.listBlobsSegmentedWithPrefix(
                            this.container,
                            params.prefix || null,
                            request_token,
                            options,
                            callback)
                    ),
                    P.fromCallback(callback =>
                        this.blob.listBlobDirectoriesSegmentedWithPrefix(
                            this.container,
                            params.prefix || null,
                            request_token,
                            options,
                            callback)
                    )
                );
            })
            .then(([blobs, dirs]) => {
                dbg.log2('NamespaceBlob.list_objects:',
                    this.container,
                    inspect(params),
                    'blobs', inspect(blobs),
                    'dirs', inspect(dirs)
                );
                const cont_token = blobs.continuationToken || dirs.continuationToken || undefined;
                const is_truncated = Boolean(cont_token);
                //Merge both lists (prefixes and keys) and slice according to deired size
                //TODO continuationToken is not synced according to the sliced combined list, we should handle it in the future
                const combined_reply = _.sortBy(blobs.entries.concat(dirs.entries), entry => entry.name)
                    .slice(0, params.limit);
                const next_marker = cont_token && cont_token.nextMarker;
                return {
                    objects: _.map(_.filter(combined_reply, ent => !_.isUndefined(ent.etag)), obj => this._get_blob_md(obj, params.bucket)),
                    common_prefixes: _.map(_.filter(combined_reply, ent => _.isUndefined(ent.etag)), obj => obj.name),
                    is_truncated,
                    next_marker
                };
            });
    }

    list_uploads(params, object_sdk) {
        dbg.log0('NamespaceBlob.list_uploads:',
            this.container,
            inspect(params)
        );
        // TODO list uploads
        return P.resolve({
            objects: [],
            common_prefixes: [],
            is_truncated: false,
        });
    }

    list_object_versions(params, object_sdk) {
        dbg.log0('NamespaceBlob.list_object_versions:',
            this.container,
            inspect(params)
        );
        // TODO list object versions
        return P.resolve({
            objects: [],
            common_prefixes: [],
            is_truncated: false,
        });
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    read_object_md(params, object_sdk) {
        dbg.log0('NamespaceBlob.read_object_md:',
            this.container,
            inspect(params)
        );
        return P.fromCallback(callback =>
                this.blob.getBlobProperties(
                    this.container,
                    params.key,
                    callback)
            )
            .then(obj => {
                dbg.log0('NamespaceBlob.read_object_md:',
                    this.container,
                    inspect(params),
                    'obj', inspect(obj)
                );
                return this._get_blob_md(obj, params.bucket);
            })
            .catch(err => {
                this._translate_error_code(err);
                dbg.warn('NamespaceBlob.read_object_md:', inspect(err));
                throw err;
            });
    }

    read_object_stream(params, object_sdk) {
        dbg.log0('NamespaceBlob.read_object_stream:',
            this.container,
            inspect(_.omit(params, 'object_md.ns'))
        );
        return new P((resolve, reject) => {
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
                resolve(read_stream);
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
                    return resolve(read_stream);
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
            obj = await P.fromCallback(callback =>
                this.blob.startCopyBlob(this.blob.getUrl(params.copy_source.bucket, params.copy_source.key),
                    this.container, params.key, callback));
        } else {
            obj = await P.fromCallback(callback =>
                this.blob.createBlockBlobFromStream(
                    this.container,
                    params.key,
                    params.source_stream,
                    params.size, // streamLength really required ???
                    {
                        // TODO setting metadata fails with error on illegal characters when sending just letters and hyphens
                        // metadata: params.xattr,
                        contentSettings: {
                            contentType: params.content_type,
                        }
                    },
                    callback));
        }

        dbg.log0('NamespaceBlob.upload_object:',
            this.container,
            inspect(_.omit(params, 'source_stream')),
            'obj', inspect(obj)
        );
        return this._get_blob_md(obj, params.bucket);
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    create_object_upload(params, object_sdk) {
        // azure blob does not have start upload operation
        // instead starting multipart upload is implicit
        // TODO how to handle xattr that s3 sends in the create command
        const obj_id = crypto.randomBytes(24).toString('base64');
        dbg.log0('NamespaceBlob.create_object_upload:',
            this.container,
            inspect(params),
            'obj_id', obj_id
        );
        return P.resolve({
            obj_id,
        });
    }

    upload_multipart(params, object_sdk) {
        // generating block ids in the form: '95342c3f-000005'
        // this is needed mostly since azure requires all the block_ids to have the same fixed length
        const block_id = this.blob.getBlockId(this.blob.generateBlockIdPrefix(), params.num);
        dbg.log0('NamespaceBlob.upload_multipart:',
            this.container,
            inspect(_.omit(params, 'source_stream')),
            'block_id', block_id
        );
        if (params.copy_source) {
            throw new Error('NamespaceBlob.upload_multipart: copy part not yet supported');
        }
        return P.fromCallback(callback =>
                this.blob.createBlockFromStream(
                    block_id,
                    this.container,
                    params.key,
                    params.source_stream,
                    params.size, // streamLength really required ???
                    callback)
            )
            .then(res => {
                dbg.log0('NamespaceBlob.upload_multipart:',
                    this.container,
                    inspect(_.omit(params, 'source_stream')),
                    'block_id', block_id,
                    'res', inspect(res)
                );
                const md5_b64 = res.headers['content-md5'];
                const md5_hex = Buffer.from(md5_b64, 'base64').toString('hex');
                return {
                    etag: md5_hex,
                };
            });
    }

    list_multiparts(params, object_sdk) {
        dbg.log0('NamespaceBlob.list_multiparts:',
            this.container,
            inspect(params)
        );
        return P.fromCallback(callback =>
                this.blob.listBlocks(
                    this.container,
                    params.key,
                    azure_storage.BlobUtilities.BlockListFilter.UNCOMMITTED,
                    callback)
            )
            .then(res => {
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
                        etag: b.Name,
                        last_modified: new Date(),
                    }))
                };
            });
    }

    complete_object_upload(params, object_sdk) {
        dbg.log0('NamespaceBlob.complete_object_upload:',
            this.container,
            inspect(params)
        );
        const num_parts = params.multiparts.length;
        const part_by_num = _.keyBy(params.multiparts, 'num');
        const md5_hash = crypto.createHash('md5');
        const block_list = _.times(num_parts, num => {
            const part = part_by_num[num + 1];
            md5_hash.update(part.etag);
            return part.etag;
        });
        return P.fromCallback(callback =>
                this.blob.commitBlocks(
                    this.container,
                    params.key,
                    block_list,
                    callback)
            )
            .then(obj => {
                dbg.log0('NamespaceBlob.complete_object_upload:',
                    this.container,
                    inspect(params),
                    'obj', inspect(obj)
                );
                const res = this._get_blob_md(obj, params.bucket);
                res.etag = md5_hash.digest('hex') + '-' + num_parts;
                return res;
            });
    }

    abort_object_upload(params, object_sdk) {
        // azure blob does not have abort upload operation
        // instead it will garbage collect blocks after 7 days
        // so we simply ignore the abort operation
        dbg.log0('NamespaceBlob.abort_object_upload:',
            this.container,
            inspect(params),
            'done'
        );
        return P.resolve();
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    delete_object(params, object_sdk) {
        dbg.log0('NamespaceBlob.delete_object:',
            this.container,
            inspect(params)
        );
        return P.fromCallback(callback =>
                this.blob.deleteBlob(
                    this.container,
                    params.key,
                    callback)
            )
            .then(res => {
                dbg.log0('NamespaceBlob.delete_object:',
                    this.container,
                    inspect(params),
                    'res', inspect(res)
                );
            });
    }

    delete_multiple_objects(params, object_sdk) {
        dbg.log0('NamespaceBlob.delete_multiple_objects:',
            this.container,
            params
        );
        return P.map(
                params.keys,
                key => P.fromCallback(callback =>
                    this.blob.deleteBlob(
                        this.container,
                        key,
                        callback)
                ), {
                    concurrency: 10
                }
            )
            .then(res => {
                dbg.log0('NamespaceBlob.delete_multiple_objects:',
                    this.container,
                    inspect(params),
                    'res', inspect(res)
                );
            });
    }


    _get_blob_md(obj, bucket) {
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
    }

}

function inspect(x) {
    return util.inspect(x, true, 5, true);
}

module.exports = NamespaceBlob;
