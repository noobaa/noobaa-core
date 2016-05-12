'use strict';

const _ = require('lodash');
const xml2js = require('xml2js');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const ObjectIO = require('../api/object_io');
const s3_errors = require('./s3_errors');

dbg.set_level(5);

const STORAGE_CLASS_STANDARD = 'Standard';
const DEFAULT_S3_USER = Object.freeze({
    ID: '123',
    DisplayName: 'NooBaa'
});

class S3Controller {

    constructor(rpc) {
        this.rpc = rpc;
        this.object_io = new ObjectIO();
        let signal_client = this.rpc.new_client();
        let n2n_agent = this.rpc.register_n2n_transport(signal_client.node.n2n_signal);
        n2n_agent.set_any_rpc_address();
    }

    prepare_request(req) {
        req.rpc_client = this.rpc.new_client();
        req.rpc_client.options.auth_token = {
            access_key: req.access_key,
            string_to_sign: req.string_to_sign,
            signature: req.signature,
            extra: req.noobaa_v4
        };
    }


    ///////////////////////////////
    // OPERATIONS ON THE SERVICE //
    ///////////////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTServiceGET.html
     */
    list_buckets(req) {
        return req.rpc_client.bucket.list_buckets()
            .then(reply => {
                let date = to_s3_date(new Date());
                return {
                    ListAllMyBucketsResult: {
                        Owner: DEFAULT_S3_USER,
                        Buckets: _.map(reply.buckets, bucket => ({
                            Bucket: {
                                Name: bucket.name,
                                CreationDate: date
                            }
                        }))
                    }
                };
            });
    }


    ///////////////////////////
    // OPERATIONS ON BUCKETS //
    ///////////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketHEAD.html
     */
    head_bucket(req) {
        return req.rpc_client.bucket.read_bucket({
                name: req.params.bucket
            })
            .then(bucket_info => {
                // only called to check for existance
                // no headers or reply needed
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGET.html
     * (aka list objects)
     */
    get_bucket(req) {
        // TODO GGG MUST implement Marker & MaxKeys & IsTruncated
        let params = {
            bucket: req.params.bucket,
            upload_mode: false,
        };
        if ('prefix' in req.query) {
            params.prefix = req.query.prefix;
        }
        if ('delimiter' in req.query) {
            params.delimiter = req.query.delimiter;
        }
        return req.rpc_client.object.list_objects(params)
            .then(reply => {
                return {
                    ListBucketResult: [{
                            'Name': req.params.bucket,
                            'Prefix': req.query.prefix,
                            'Delimiter': req.query.delimiter,
                            'MaxKeys': req.query['max-keys'],
                            'Marker': req.query.marker,
                            'IsTruncated': false,
                            'Encoding-Type': req.query['encoding-type'],
                        },
                        _.map(reply.objects, obj => ({
                            Contents: {
                                Key: obj.key,
                                LastModified: to_s3_date(obj.info.create_time),
                                ETag: obj.info.etag,
                                Size: obj.info.size,
                                Owner: DEFAULT_S3_USER,
                                StorageClass: STORAGE_CLASS_STANDARD,
                            }
                        })),
                        _.map(reply.common_prefixes, prefix => ({
                            CommonPrefixes: {
                                Prefix: prefix || ''
                            }
                        }))
                    ]
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETVersion.html
     * (aka list object versions)
     */
    get_bucket_versions(req) {
        // TODO GGG MUST implement KeyMarker & VersionIdMarker & MaxKeys & IsTruncated
        let params = {
            bucket: req.params.bucket,
            upload_mode: false,
        };
        if ('prefix' in req.query) {
            params.prefix = req.query.prefix;
        }
        if ('delimiter' in req.query) {
            params.delimiter = req.query.delimiter;
        }
        return req.rpc_client.object.list_objects(params)
            .then(reply => {
                return {
                    ListVersionsResult: [{
                            'Name': req.params.bucket,
                            'Prefix': req.query.prefix,
                            'Delimiter': req.query.delimiter,
                            'MaxKeys': req.query['max-keys'],
                            'KeyMarker': req.query['key-marker'],
                            'VersionIdMarker': req.query['version-id-marker'],
                            'IsTruncated': false,
                            // 'NextKeyMarker': ...
                            // 'NextVersionIdMarker': ...
                            'Encoding-Type': req.query['encoding-type'],
                        },
                        _.map(reply.objects, obj => ({
                            Version: {
                                Key: obj.key,
                                VersionId: '',
                                IsLatest: true,
                                LastModified: to_s3_date(obj.info.create_time),
                                ETag: obj.info.etag,
                                Size: obj.info.size,
                                Owner: DEFAULT_S3_USER,
                                StorageClass: STORAGE_CLASS_STANDARD,
                            }
                        })),
                        _.map(reply.common_prefixes, prefix => ({
                            CommonPrefixes: {
                                Prefix: prefix || ''
                            }
                        }))
                    ]
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadListMPUpload.html
     */
    get_bucket_uploads(req) {
        // TODO GGG MUST implement Marker & MaxKeys & IsTruncated
        let params = {
            bucket: req.params.bucket,
            upload_mode: true,
        };
        if ('prefix' in req.query) {
            params.prefix = req.query.prefix;
        }
        if ('delimiter' in req.query) {
            params.delimiter = req.query.delimiter;
        }
        return req.rpc_client.object.list_objects(params)
            .then(reply => {
                return {
                    ListMultipartUploadsResult: [{
                            'Bucket': req.params.bucket,
                            'Prefix': req.query.prefix,
                            'Delimiter': req.query.delimiter,
                            'MaxUploads': req.query['max-uploads'],
                            'KeyMarker': req.query['key-marker'],
                            'UploadIdMarker': req.query['upload-id-marker'],
                            'IsTruncated': false,
                            'Encoding-Type': req.query['encoding-type'],
                        },
                        _.map(reply.objects, obj => ({
                            Upload: {
                                Key: obj.key,
                                UploadId: obj.info.version_id,
                                Initiated: to_s3_date(obj.info.create_time),
                                Initiator: DEFAULT_S3_USER,
                                Owner: DEFAULT_S3_USER,
                                StorageClass: STORAGE_CLASS_STANDARD,
                            }
                        })),
                        _.map(reply.common_prefixes, prefix => ({
                            CommonPrefixes: {
                                Prefix: prefix || ''
                            }
                        }))
                    ]
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUT.html
     * (aka create bucket)
     */
    put_bucket(req) {
        return req.rpc_client.bucket.create_bucket({
            name: req.params.bucket
        }).return();
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETE.html
     */
    delete_bucket(req, res) {
        return req.rpc_client.bucket.delete_bucket({
            name: req.params.bucket
        }).return();
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/multiobjectdeleteapi.html
     * (aka delete objects)
     */
    post_bucket_delete(req) {
        return P.ninvoke(xml2js, 'parseString', req.body)
            .then(function(data) {
                var objects_to_delete = data.Delete.Object;
                dbg.log3('Delete objects "%s" in bucket "%s"', JSON.stringify(objects_to_delete), req.params.bucket);
                let keys = _.map(objects_to_delete, object_to_delete => object_to_delete.Key[0]);
                dbg.log3('calling delete_multiple_objects: keys=', keys);
                return req.rpc_client.object.delete_multiple_objects({
                    bucket: req.params.bucket,
                    keys: keys
                });
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETacl.html
     * (aka get bucket permissions)
     */
    get_bucket_acl(req) {
        return req.rpc_client.bucket.read_bucket({
                name: req.params.bucket
            })
            .then(bucket_info => {
                return {
                    AccessControlPolicy: {
                        Owner: DEFAULT_S3_USER,
                        AccessControlList: [{
                            Grant: {
                                Grantee: DEFAULT_S3_USER,
                                Permission: 'FULL_CONTROL'
                            }
                        }]
                    }
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTacl.html
     * (aka set bucket permissions)
     */
    put_bucket_acl(req) {
        // TODO GGG ignoring put_bucket_acl for now
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETlocation.html
     */
    get_bucket_location(req) {
        return req.rpc_client.bucket.read_bucket({
                name: req.params.bucket
            })
            .then(bucket_info => {
                return {
                    LocationConstraint: ''
                };
            });
    }


    ///////////////////////////
    // OPERATIONS ON OBJECTS //
    ///////////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html
     * (aka read object meta-data)
     */
    head_object(req, res) {
        return req.rpc_client.object.read_object_md(this._object_path(req))
            .then(object_md => {
                req.object_md = object_md;
                res.setHeader('ETag', '"' + object_md.etag + '"');
                res.setHeader('Last-Modified', to_s3_date(object_md.create_time));
                res.setHeader('Content-Type', object_md.content_type);
                res.setHeader('Content-Length', object_md.size);
                res.setHeader('Accept-Ranges', 'bytes');
                set_response_xattr(res, object_md.xattr);
                if (this._check_md_conditions(req, res, object_md) === false) {
                    // _check_md_conditions already responded
                    return false;
                }
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGET.html
     * (aka read object)
     */
    get_object(req, res) {
        return this.head_object(req, res)
            .then(should_handle => {
                if (should_handle === false) {
                    // head_object already responded
                    return false;
                }
                let object_md = req.object_md;
                let params = this._object_path(req);
                params.client = req.rpc_client;
                let code = this.object_io.serve_http_stream(
                    req, res, params, object_md);
                switch (code) {
                    case 400:
                        throw s3_errors.InvalidArgument;
                    case 416:
                        throw s3_errors.InvalidRange;
                    case 200:
                        res.status(200);
                        return false; // let the caller know we are handling the response
                    case 206:
                        res.status(206);
                        return false; // let the caller know we are handling the response
                    default:
                        throw s3_errors.InternalError;
                }
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUT.html
     * (aka upload object, or copy object)
     */
    put_object(req, res) {
        if (req.headers['x-amz-copy-source']) {
            return this._copy_object(req, res);
        }
        let params = {
            client: req.rpc_client,
            bucket: req.params.bucket,
            key: req.params.key,
            size: req.content_length,
            content_type: req.headers['content-type'],
            xattr: get_request_xattr(req),
            source_stream: req,
            calculate_md5: true,
            calculate_sha256: !_.isUndefined(req.content_sha256)
        };
        this._set_md_conditions(req, params, 'overwrite_if');
        return this.object_io.upload_stream(params)
            .then(md5_digest => {
                let etag = md5_digest.md5.toString('hex');
                res.setHeader('ETag', '"' + etag + '"');
                if (req.content_md5) {
                    if (Buffer.compare(md5_digest.md5, req.content_md5)) {
                        // TODO GGG how to handle? delete the object?
                        dbg.error('S3Controller.put_object: BadDigest',
                            'content-md5', req.content_md5.toString('hex'),
                            'etag', etag);
                        throw s3_errors.BadDigest;
                    }
                }
                if (req.content_sha256) {
                    if (Buffer.compare(md5_digest.sha256, req.content_sha256)) {
                        // TODO GGG how to handle? delete the object?
                        dbg.error('S3Controller.put_object: BadDigest',
                            'content-sha256', req.content_sha256.toString('hex'),
                            'etag', md5_digest.sha256.toString('hex'));
                        throw s3_errors.BadDigest;
                    }
                }
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectCOPY.html
     * (aka copy object)
     */
    _copy_object(req, res) {
        let copy_source = decodeURIComponent(req.headers['x-amz-copy-source']);
        let slash_index = copy_source.indexOf('/');
        let start_index = 0;
        if (slash_index === 0) {
            start_index = 1;
            slash_index = copy_source.indexOf('/', 1);
        }
        console.log('COPY OBJECT ', req.params.key);
        let source_bucket = copy_source.slice(start_index, slash_index);
        let source_key = copy_source.slice(slash_index + 1);
        let params = {
            bucket: req.params.bucket,
            key: req.params.key,
            source_bucket: source_bucket,
            source_key: source_key,
            content_type: req.headers['content-type'],
            xattr: get_request_xattr(req),
            xattr_copy: (req.headers['x-amz-metadata-directive'] === 'COPY')
        };
        this._set_md_conditions(req, params, 'overwrite_if');
        this._set_md_conditions(req, params, 'source_if', 'x-amz-copy-source-');
        return req.rpc_client.object.copy_object(params)
            .then(reply => {
                return {
                    CopyObjectResult: {
                        LastModified: to_s3_date(reply.source_md.create_time),
                        ETag: '"' + reply.source_md.etag + '"'
                    }
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPOST.html
     * (aka upload using HTTP multipart/form-data encoding)
     */
    // post_object(req) { TODO GGG }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectDELETE.html
     */
    delete_object(req) {
        return req.rpc_client.object.delete_object(this._object_path(req));
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGETacl.html
     * (aka get object acl)
     */
    get_object_acl(req) {
        return req.rpc_client.object.read_object_md(this._object_path(req))
            .then(object_md => {
                return {
                    AccessControlPolicy: {
                        Owner: DEFAULT_S3_USER,
                        AccessControlList: [{
                            Grant: {
                                Grantee: DEFAULT_S3_USER,
                                Permission: 'FULL_CONTROL'
                            }
                        }]
                    }
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUTacl.html
     * (aka set object acl)
     */
    put_object_acl(req) {
        // TODO GGG ignoring put_object_acl for now
    }


    //////////////////////
    // MULTIPART UPLOAD //
    //////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadInitiate.html
     * (aka start multipart upload)
     */
    post_object_uploads(req) {
        let params = {
            bucket: req.params.bucket,
            key: req.params.key,
            size: req.content_length,
            content_type: req.headers['content-type'],
            xattr: get_request_xattr(req),
        };
        this._set_md_conditions(req, params, 'overwrite_if');
        return req.rpc_client.object.create_object_upload(params)
            .then(reply => {
                return {
                    InitiateMultipartUploadResult: {
                        Bucket: req.params.bucket,
                        Key: req.params.key,
                        UploadId: reply.upload_id
                    }
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadComplete.html
     * (aka complete multipart upload)
     */
    post_object_uploadId(req) {
        return req.rpc_client.object.complete_object_upload({
                bucket: req.params.bucket,
                key: req.params.key,
                upload_id: req.query.uploadId,
                fix_parts_size: true,
                etag: '',
            })
            .then(reply => {
                return {
                    CompleteMultipartUploadResult: {
                        Bucket: req.params.bucket,
                        Key: req.params.key,
                        ETag: reply.etag,
                        Location: req.url,
                    }
                };
            });

    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadAbort.html
     * (aka abort multipart upload)
     */
    delete_object_uploadId(req) {
        return req.rpc_client.object.abort_object_upload({
            bucket: req.params.bucket,
            key: req.params.key,
            upload_id: req.query.uploadId,
        }).return();
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadListParts.html
     * (aka list multipart upload parts)
     */
    get_object_uploadId(req) {
        let part_number_marker = parseInt(req.query['part-number-marker'], 10) || 1;
        let max_parts = parseInt(req.query['max-parts'], 10) || 1000;
        return req.rpc_client.object.list_multipart_parts({
                bucket: req.params.bucket,
                key: req.params.key,
                upload_id: req.query.uploadId,
                part_number_marker: part_number_marker,
                max_parts: max_parts,
            })
            .then(reply => {
                return {
                    ListPartsResult: [{
                            Bucket: req.params.bucket,
                            Key: req.params.key,
                            UploadId: reply.uploadId,
                            Initiator: DEFAULT_S3_USER,
                            Owner: DEFAULT_S3_USER,
                            StorageClass: STORAGE_CLASS_STANDARD,
                            PartNumberMarker: part_number_marker,
                            MaxParts: max_parts,
                            NextPartNumberMarker: reply.next_part_number_marker,
                            IsTruncated: reply.is_truncated,
                        },
                        _.map(reply.upload_parts, part => ({
                            Part: {
                                PartNumber: part.part_number,
                                Size: part.size,
                                ETag: part.etag,
                                LastModified: to_s3_date(part.last_modified),
                            }
                        }))
                    ]
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadUploadPart.html
     * (aka upload part)
     */
    put_object_uploadId(req, res) {
        let upload_part_number = parseInt(req.query.partNumber, 10);

        // TODO GGG IMPLEMENT COPY PART
        let copy_source = req.headers['x-amz-copy-source'];
        if (copy_source) {
            // return req.rpc_client.object.copy_part({});
            throw s3_errors.NotImplemented;
        }

        return this.object_io.upload_stream_parts({
                client: req.rpc_client,
                bucket: req.params.bucket,
                key: req.params.key,
                upload_id: req.query.uploadId,
                upload_part_number: upload_part_number,
                size: req.content_length,
                source_stream: req,
                calculate_md5: true,
                calculate_sha256: !_.isUndefined(req.content_sha256)
            })
            .then(md5_digest => {
                let etag = md5_digest.md5.toString('hex');
                //let etag_sha256 = md5_digest.sha256.toString('hex');

                res.setHeader('ETag', '"' + etag + '"');
                if (req.content_md5) {
                    if (Buffer.compare(md5_digest.md5, req.content_md5)) {
                        // TODO GGG how to handle? delete the object?
                        dbg.error('S3Controller.put_object_uploadId: BadDigest',
                            'content-md5', req.content_md5.toString('hex'),
                            'etag', etag);
                        throw s3_errors.BadDigest;
                    }
                }
                if (req.content_sha256) {
                    if (Buffer.compare(md5_digest.sha256, req.content_sha256)) {
                        // TODO GGG how to handle? delete the object?
                        dbg.error('S3Controller.put_object: BadDigest',
                            'content-sha256', req.content_sha256.toString('hex'),
                            'etag', md5_digest.sha256.toString('hex'));
                        throw s3_errors.BadDigest;
                    }
                }
                return req.rpc_client.object.complete_part_upload({
                    bucket: req.params.bucket,
                    key: req.params.key,
                    upload_id: req.query.uploadId,
                    upload_part_number: upload_part_number,
                    etag: etag
                });
            });
    }


    /////////////
    // PRIVATE //
    /////////////


    _object_path(req) {
        // Support _$folder$ used by s3 clients (supported by AWS). Replace with current prefix /
        let key = req.params.key.replace(/_\$folder\$/, '/');
        return {
            bucket: req.params.bucket,
            key: key
        };
    }


    _check_md_conditions(req, res, object_md) {
        if ('if-modified-since' in req.headers && (
                object_md.create_time <=
                (new Date(req.headers['if-modified-since'])).getTime()
            )) {
            res.status(304).end();
            return false;
        }
        if ('if-unmodified-since' in req.headers && (
                object_md.create_time >=
                (new Date(req.headers['if-unmodified-since'])).getTime()
            )) {
            res.status(412).end();
            return false;
        }
        if ('if-match' in req.headers &&
            req.headers['if-match'] !== object_md.etag) {
            res.status(412).end();
            return false;
        }
        if ('if-none-match' in req.headers &&
            req.headers['if-none-match'] === object_md.etag) {
            res.status(304).end();
            return false;
        }
        return true;
    }

    _set_md_conditions(req, params, params_key, prefix) {
        prefix = prefix || '';
        if (prefix + 'if-modified-since' in req.headers) {
            params[params_key] = params[params_key] || {};
            params[params_key].if_modified_since =
                (new Date(req.headers[prefix + 'if-modified-since'])).getTime();
        }
        if (prefix + 'if-unmodified-since' in req.headers) {
            params[params_key] = params[params_key] || {};
            params[params_key].if_unmodified_since =
                (new Date(req.headers[prefix + 'if-unmodified-since'])).getTime();
        }
        if (prefix + 'if-match' in req.headers) {
            params[params_key] = params[params_key] || {};
            params[params_key].if_match_etag = req.headers[prefix + 'if-match'];
        }
        if (prefix + 'if-none-match' in req.headers) {
            params[params_key] = params[params_key] || {};
            params[params_key].if_none_match_etag = req.headers[prefix + 'if-none-match'];
        }
    }

}


function to_s3_date(input) {
    let date = input ? new Date(input) : new Date();
    date.setMilliseconds(0);
    return date.toISOString();
}

function get_request_xattr(req) {
    let xattr = {};
    _.each(req.headers, (val, hdr) => {
        if (!hdr.startsWith('x-amz-meta-')) return;
        let key = hdr.slice('x-amz-meta-'.length);
        if (!key) return;
        xattr[key] = val;
    });
    return xattr;
}

function set_response_xattr(res, xattr) {
    _.each(xattr, (val, key) => {
        res.setHeader('x-amz-meta-' + key, val);
    });
}

module.exports = S3Controller;
