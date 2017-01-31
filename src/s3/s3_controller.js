/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const uuid = require('node-uuid');
const xml2js = require('xml2js');
const moment = require('moment');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const ObjectIO = require('../api/object_io');
const s3_errors = require('./s3_errors');
const http_utils = require('../util/http_utils');
const time_utils = require('../util/time_utils');

dbg.set_level(5);

const S3_USAGE_INFO_DEFAULTS = {
    prepare_request: 0,
    list_buckets: 0,
    head_bucket: 0,
    get_bucket: 0,
    get_bucket_versions: 0,
    get_bucket_uploads: 0,
    put_bucket: 0,
    delete_bucket: 0,
    post_bucket_delete: 0,
    get_bucket_acl: 0,
    put_bucket_acl: 0,
    get_bucket_location: 0,
    head_object: 0,
    get_object: 0,
    put_object: 0,
    copy_object: 0,
    delete_object: 0,
    get_object_acl: 0,
    put_object_acl: 0,
    post_object_uploads: 0,
    post_object_uploadId: 0,
    delete_object_uploadId: 0,
    get_object_uploadId: 0,
    put_object_uploadId: 0,
};

const STORAGE_CLASS_STANDARD = 'STANDARD';
const DEFAULT_S3_USER = Object.freeze({
    ID: '123',
    DisplayName: 'NooBaa'
});

class S3Controller {

    constructor(rpc) {
        this.usage_report = {
            s3_usage_info: _.cloneDeep(S3_USAGE_INFO_DEFAULTS),
            s3_errors_info: {
                total_errors: 0
            },
            last_updated: new Date(),
        };
        this.rpc = rpc;
        this.object_io = new ObjectIO();
        let signal_client = this.rpc.new_client();
        let n2n_agent = this.rpc.register_n2n_agent(signal_client.node.n2n_signal);
        n2n_agent.set_any_rpc_address();
    }

    prepare_request(req) {
        this.usage_report.s3_usage_info.prepare_request += 1;
        req.rpc_client = this.rpc.new_client();
        req.rpc_client.options.auth_token = req.auth_token;
        return this._update_usage_report(req);
    }

    register_s3_error(req, s3_error) {
        // We check access_key in order to be sure that we've passed authenticate_s3_request
        // Access_key was chosen because it is the identifier and required
        // All errors that are prior to authenticate_s3_request won't be registered
        // This is because we need to create an auth_token in order to register the errors
        // The only way to create the token is using the s3 authentication path
        // TODO TODO TODO (Pink Panther Theme)
        // *** NOTICE IMPORTANT ***
        // Authentication failure attemps might not be included in the report
        // Because the access_key we won't be able to create a token and update the MD Server
        if (!s3_error ||
            !_.isObject(s3_error) ||
            !req.auth_token ||
            !req.auth_token.access_key) {
            dbg.log0('Could not register error:', s3_error,
                'Request Headers:', req.headers,
                'Request Method:', req.method,
                'Request Url:', req.originalUrl);
            return;
        }
        this.usage_report.s3_errors_info.total_errors += 1;
        this.usage_report.s3_errors_info[s3_error.code] = (this.usage_report.s3_errors_info[s3_error.code] || 0) + 1;
        req.rpc_client = this.rpc.new_client();
        req.rpc_client.options.auth_token = req.auth_token;
        return this._update_usage_report(req);
    }


    ///////////////////////////////
    // OPERATIONS ON THE SERVICE //
    ///////////////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTServiceGET.html
     */
    list_buckets(req) {
        this.usage_report.s3_usage_info.list_buckets += 1;
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
        this.usage_report.s3_usage_info.head_bucket += 1;
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
        this.usage_report.s3_usage_info.get_bucket += 1;
        if (req.query['list-type'] === '2') {
            throw s3_errors.NotImplemented;
        }
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
        if ('marker' in req.query) {
            params.key_marker = req.query.marker;
        }

        let max_keys_received = Number(req.query['max-keys'] || 1000);
        if (!_.isInteger(max_keys_received) || max_keys_received < 0) {
            throw s3_errors.InvalidArgument;
        }
        params.limit = Math.min(max_keys_received, 1000);

        return req.rpc_client.object.list_objects_s3(params)
            .then(reply => ({
                ListBucketResult: [{
                        'Name': req.params.bucket,
                        'Prefix': req.query.prefix,
                        'Delimiter': req.query.delimiter,
                        'MaxKeys': max_keys_received,
                        'Marker': req.query.marker,
                        'IsTruncated': reply.is_truncated,
                        'NextMarker': reply.next_marker,
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
            }));
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETVersion.html
     * (aka list object versions)
     */
    get_bucket_versions(req) {
        this.usage_report.s3_usage_info.get_bucket_versions += 1;
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
        if ('key-marker' in req.query) {
            params.key_marker = req.query['key-marker'];
        }

        let max_keys_received = Number(req.query['max-keys'] || 1000);
        if (!_.isInteger(max_keys_received) || max_keys_received < 0) {
            throw s3_errors.InvalidArgument;
        }
        params.limit = Math.min(max_keys_received, 1000);

        return req.rpc_client.object.list_objects_s3(params)
            .then(reply => ({
                ListVersionsResult: [{
                        'Name': req.params.bucket,
                        'Prefix': req.query.prefix,
                        'Delimiter': req.query.delimiter,
                        'MaxKeys': max_keys_received,
                        'KeyMarker': req.query['key-marker'],
                        'VersionIdMarker': req.query['version-id-marker'],
                        'IsTruncated': reply.is_truncated,
                        'NextKeyMarker': reply.next_marker,
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
            }));
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadListMPUpload.html
     */
    get_bucket_uploads(req) {
        this.usage_report.s3_usage_info.get_bucket_uploads += 1;
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
        if ('key-marker' in req.query) {
            params.key_marker = req.query['key-marker'];
        }

        let max_keys_received = Number(req.query['max-uploads'] || 1000);
        if (!_.isInteger(max_keys_received) || max_keys_received < 0) {
            throw s3_errors.InvalidArgument;
        }
        params.limit = Math.min(max_keys_received, 1000);

        return req.rpc_client.object.list_objects_s3(params)
            .then(reply => ({
                ListMultipartUploadsResult: [{
                        'Bucket': req.params.bucket,
                        'Prefix': req.query.prefix,
                        'Delimiter': req.query.delimiter,
                        'MaxUploads': max_keys_received,
                        'KeyMarker': req.query['key-marker'],
                        'UploadIdMarker': req.query['upload-id-marker'],
                        'IsTruncated': reply.is_truncated,
                        'NextKeyMarker': reply.next_marker,
                        'Encoding-Type': req.query['encoding-type'],
                    },
                    _.map(reply.objects, obj => ({
                        Upload: {
                            Key: obj.key,
                            UploadId: obj.info.version_id,
                            Initiated: to_s3_date(obj.info.upload_started),
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
            }));
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUT.html
     * (aka create bucket)
     */
    put_bucket(req, res) {
        this.usage_report.s3_usage_info.put_bucket += 1;
        return req.rpc_client.bucket.create_bucket({
                name: req.params.bucket
            })
            .then(() => {
                res.setHeader('Location', '/' + req.params.bucket);
            })
            .return();
    }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETElifecycle.html
     */
    delete_bucket_lifecycle(req, res) {
        return req.rpc_client.bucket.delete_bucket_lifecycle({
            name: req.params.bucket
        }).return();
    }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETE.html
     */
    delete_bucket(req, res) {
        this.usage_report.s3_usage_info.delete_bucket += 1;
        return req.rpc_client.bucket.delete_bucket({
            name: req.params.bucket
        }).return();
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/multiobjectdeleteapi.html
     * (aka delete objects)
     */
    post_bucket_delete(req) {
        this.usage_report.s3_usage_info.post_bucket_delete += 1;
        let keys;
        return P.fromCallback(callback => xml2js.parseString(req.body, callback))
            .then(data => {
                keys = _.map(data.Delete.Object, obj => obj.Key[0]);
                dbg.log3('post_bucket_delete: keys', keys);
            })
            .then(() => req.rpc_client.object.delete_multiple_objects({
                bucket: req.params.bucket,
                keys: keys
            }))
            .then(reply => ({
                DeleteResult: [
                    _.map(keys, key => ({
                        Deleted: {
                            Key: key,
                        }
                    }))
                ]
            }));
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETacl.html
     * (aka get bucket permissions)
     */
    get_bucket_acl(req) {
        this.usage_report.s3_usage_info.get_bucket_acl += 1;
        return req.rpc_client.bucket.read_bucket({
                name: req.params.bucket
            })
            .then(bucket_info => ({
                AccessControlPolicy: {
                    Owner: DEFAULT_S3_USER,
                    AccessControlList: [{
                        Grant: {
                            Grantee: DEFAULT_S3_USER,
                            Permission: 'FULL_CONTROL'
                        }
                    }]
                }
            }));
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTacl.html
     * (aka set bucket permissions)
     */
    put_bucket_acl(req) {
        this.usage_report.s3_usage_info.put_bucket_acl += 1;
        // TODO GGG ignoring put_bucket_acl for now
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETlocation.html
     */
    get_bucket_location(req) {
        this.usage_report.s3_usage_info.get_bucket_location += 1;
        return req.rpc_client.bucket.read_bucket({
                name: req.params.bucket
            })
            .then(bucket_info => ({
                LocationConstraint: ''
            }));
    }


    ///////////////////////////
    // OPERATIONS ON OBJECTS //
    ///////////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html
     * (aka read object meta-data)
     */
    head_object(req, res) {
        this.usage_report.s3_usage_info.head_object += 1;
        return req.rpc_client.object.read_object_md(this._object_path(req))
            .then(object_md => {
                req.object_md = object_md;
                res.setHeader('ETag', '"' + object_md.etag + '"');
                res.setHeader('Last-Modified', to_aws_date_for_http_header(object_md.create_time));
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
        this.usage_report.s3_usage_info.get_object += 1;
        return this.head_object(req, res)
            .then(should_handle => {
                if (should_handle === false) {
                    // head_object already responded
                    return false;
                }
                let object_md = req.object_md;
                let params = this._object_path(req);
                params.client = req.rpc_client;
                let code = this.object_io.serve_http_stream(req, res, params, object_md);
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
        this.usage_report.s3_usage_info.put_object += 1;
        if (req.headers['x-amz-copy-source']) {
            return this._copy_object(req, res);
        }
        let params = {
            client: req.rpc_client,
            bucket: req.params.bucket,
            key: req.params.key,
            content_type: req.headers['content-type'],
            xattr: get_request_xattr(req),
            source_stream: req,
        };
        if (req.content_length >= 0) params.size = req.content_length;
        if (req.content_md5) params.md5_b64 = req.content_md5.toString('base64');
        if (req.content_sha256) params.sha256_b64 = req.content_sha256.toString('base64');
        this._set_md_conditions(req, params, 'overwrite_if');
        return this.object_io.upload_object(params)
            .then(reply => {
                res.setHeader('ETag', '"' + reply.etag + '"');
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectCOPY.html
     * (aka copy object)
     */
    _copy_object(req, res) {
        this.usage_report.s3_usage_info.copy_object += 1;
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
            .then(reply => ({
                CopyObjectResult: {
                    LastModified: to_s3_date(reply.source_md.create_time),
                    ETag: '"' + reply.source_md.etag + '"'
                }
            }));
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
        this.usage_report.s3_usage_info.delete_object += 1;
        return req.rpc_client.object.delete_object(this._object_path(req));
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGETacl.html
     * (aka get object acl)
     */
    get_object_acl(req) {
        this.usage_report.s3_usage_info.get_object_acl += 1;
        return req.rpc_client.object.read_object_md(this._object_path(req))
            .then(object_md => ({
                AccessControlPolicy: {
                    Owner: DEFAULT_S3_USER,
                    AccessControlList: [{
                        Grant: {
                            Grantee: DEFAULT_S3_USER,
                            Permission: 'FULL_CONTROL'
                        }
                    }]
                }
            }));
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUTacl.html
     * (aka set object acl)
     */
    put_object_acl(req) {
        this.usage_report.s3_usage_info.put_object_acl += 1;
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
        this.usage_report.s3_usage_info.post_object_uploads += 1;
        const params = {
            bucket: req.params.bucket,
            key: req.params.key,
            content_type: req.headers['content-type'],
            xattr: get_request_xattr(req),
        };
        this._set_md_conditions(req, params, 'overwrite_if');
        return req.rpc_client.object.create_object_upload(params)
            .then(reply => ({
                InitiateMultipartUploadResult: {
                    Bucket: req.params.bucket,
                    Key: req.params.key,
                    UploadId: reply.upload_id
                }
            }));
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadComplete.html
     * (aka complete multipart upload)
     */
    post_object_uploadId(req) {
        this.usage_report.s3_usage_info.post_object_uploadId += 1;
        return P.fromCallback(callback => xml2js.parseString(req.body || '', callback))
            .then(data => req.rpc_client.object.complete_object_upload({
                bucket: req.params.bucket,
                key: req.params.key,
                upload_id: req.query.uploadId,
                multiparts: _.map(_.get(data, 'CompleteMultipartUpload.Part'), multipart => ({
                    num: Number(multipart.PartNumber[0]),
                    etag: strip_etag_quotes(multipart.ETag[0]),
                }))
            }))
            .then(reply => ({
                CompleteMultipartUploadResult: {
                    Bucket: req.params.bucket,
                    Key: req.params.key,
                    ETag: reply.etag,
                    Location: req.originalUrl,
                }
            }));

    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadAbort.html
     * (aka abort multipart upload)
     */
    delete_object_uploadId(req) {
        this.usage_report.s3_usage_info.delete_object_uploadId += 1;
        return req.rpc_client.object.abort_object_upload({
            bucket: req.params.bucket,
            key: req.params.key,
            upload_id: req.query.uploadId,
        }).return();
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadUploadPart.html
     * (aka upload part)
     */
    put_object_uploadId(req, res) {
        this.usage_report.s3_usage_info.put_object_uploadId += 1;
        const num = Number(req.query.partNumber);
        if (!_.isInteger(num) || num < 1 || num > 10000) throw s3_errors.InvalidArgument;

        // TODO GGG IMPLEMENT COPY PART
        const copy_source = req.headers['x-amz-copy-source'];
        if (copy_source) {
            // return req.rpc_client.object.copy_part({});
            throw s3_errors.NotImplemented;
        }

        const params = {
            client: req.rpc_client,
            bucket: req.params.bucket,
            key: req.params.key,
            upload_id: req.query.uploadId,
            num: num,
            source_stream: req,
        };
        if (req.content_length >= 0) params.size = req.content_length;
        if (req.content_md5) params.md5_b64 = req.content_md5.toString('base64');
        if (req.content_sha256) params.sha256_b64 = req.content_sha256.toString('base64');
        return this.object_io.upload_multipart(params)
            .then(reply => {
                res.setHeader('ETag', '"' + reply.etag + '"');
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadListParts.html
     * (aka list multipart upload parts)
     */
    get_object_uploadId(req) {
        this.usage_report.s3_usage_info.get_object_uploadId += 1;
        const max = Number(req.query['max-parts']);
        const num_marker = Number(req.query['part-number-marker']);
        if (!_.isInteger(max) || max < 0) throw s3_errors.InvalidArgument;
        if (!_.isInteger(num_marker) || num_marker < 1 || num_marker > 10000) throw s3_errors.InvalidArgument;

        return req.rpc_client.object.list_multiparts({
                bucket: req.params.bucket,
                key: req.params.key,
                upload_id: req.query.uploadId,
                max: Math.min(max, 1000),
                num_marker,
            })
            .then(reply => ({
                ListPartsResult: [{
                        Bucket: req.params.bucket,
                        Key: req.params.key,
                        UploadId: req.query.uploadId,
                        Initiator: DEFAULT_S3_USER,
                        Owner: DEFAULT_S3_USER,
                        StorageClass: STORAGE_CLASS_STANDARD,
                        MaxParts: max,
                        PartNumberMarker: num_marker,
                        IsTruncated: reply.is_truncated,
                        NextPartNumberMarker: reply.next_num_marker,
                    },
                    _.map(reply.multiparts, part => ({
                        Part: {
                            PartNumber: part.num,
                            Size: part.size,
                            ETag: part.etag,
                            LastModified: to_s3_date(part.last_modified),
                        }
                    }))
                ]
            }));
    }


    ///////////////
    // LIFECYCLE //
    ///////////////

    put_bucket_lifecycle(req) {
        return P.fromCallback(callback => xml2js.parseString(req.body, callback))
            .then(data => {
                // <Rule>
                //     <ID>id2</ID>
                //     <Prefix>logs/</Prefix>
                //     <Status>Enabled</Status>
                //    <Expiration>
                //      <Days>365</Days>
                //    </Expiration>
                //  </Rule>
                //var lifecycle_rules = data.LifecycleConfiguration.Rule;
                var lifecycle_rules = [];
                _.each(data.LifecycleConfiguration.Rule, rule => {
                        var rule_id = uuid().split('-')[0];
                        if (rule.ID) {
                            rule_id = rule.ID[0];
                        }
                        let current_rule = {
                            id: rule_id,
                            prefix: rule.Prefix[0],
                            status: rule.Status[0]
                        };
                        if (rule.Expiration) {
                            current_rule.expiration = {};
                            if (rule.Expiration[0].Days) {
                                current_rule.expiration.days = parseInt(rule.Expiration[0].Days[0], 10);
                                if (rule.Expiration[0].Days < 1) {
                                    throw s3_errors.InvalidArgument;
                                }
                            } else {
                                current_rule.expiration.date = (new Date(rule.Expiration[0].Date[0])).getTime();
                            }

                            if (rule.Expiration[0].ExpiredObjectDeleteMarker) {
                                current_rule.expiration.expired_object_delete_marker = rule.Expiration[0].ExpiredObjectDeleteMarker[0] === 'true';
                            }

                        }
                        if (rule.AbortIncompleteMultipartUpload) {
                            current_rule.abort_incomplete_multipart_upload = {
                                days_after_initiation: rule.AbortIncompleteMultipartUpload[0].DaysAfterInitiation ?
                                    parseInt(rule.AbortIncompleteMultipartUpload[0].DaysAfterInitiation[0], 10) : null
                            };
                        }
                        if (rule.Transition) {
                            current_rule.transition = {
                                date: rule.Transition[0].Date ? (new Date(rule.Transition[0].Date[0])).getTime() : null,
                                storage_class: rule.Transition[0].StorageClass ? rule.Transition[0].StorageClass[0] : 'STANDARD_IA'
                            };
                        }
                        if (rule.NoncurrentVersionExpiration) {
                            current_rule.noncurrent_version_expiration = {
                                noncurrent_days: rule.NoncurrentVersionExpiration[0].NoncurrentDays ?
                                    parseInt(rule.NoncurrentVersionExpiration[0].NoncurrentDays[0], 10) : null
                            };
                        }
                        if (rule.NoncurrentVersionTransition) {
                            current_rule.noncurrent_version_transition = {
                                noncurrent_days: rule.NoncurrentVersionTransition[0].NoncurrentDays ?
                                    parseInt(rule.NoncurrentVersionTransition[0].NoncurrentDays[0], 10) : null,
                                storage_class: rule.NoncurrentVersionTransition[0].StorageClass ?
                                    rule.NoncurrentVersionTransition[0].StorageClass[0] : 'STANDARD_IA'
                            };
                        }

                        lifecycle_rules.push(current_rule);
                    }

                );
                let params = {
                    name: req.params.bucket,
                    rules: lifecycle_rules
                };
                return req.rpc_client.bucket.set_bucket_lifecycle_configuration_rules(params)
                    .then(() => {
                        dbg.log('set_bucket_lifecycle', req.params.rule);
                    });
            });
    }

    get_bucket_lifecycle(req) {
        let params = {
            name: req.params.bucket
        };
        return req.rpc_client.bucket.get_bucket_lifecycle_configuration_rules(params)
            .then(reply => ({
                LifecycleConfiguration: _.map(reply, rule => ({
                    Rule: [{
                            ID: rule.id,
                            Prefix: rule.prefix,
                            Status: rule.status,
                        },
                        rule.transition ? {
                            Transition: {
                                Days: rule.transition.days,
                                StorageClass: rule.transition.storage_class,
                            }
                        } : {},
                        rule.expiration ? {
                            Expiration: (rule.expiration.days ? {
                                Days: rule.expiration.days,
                                ExpiredObjectDeleteMarker: rule.expiration.expired_object_delete_marker ?
                                    rule.expiration.expired_object_delete_marker : {}
                            } : {
                                Date: rule.expiration.date,
                                ExpiredObjectDeleteMarker: rule.expiration.expired_object_delete_marker ?
                                    rule.expiration.expired_object_delete_marker : {}
                            })
                        } : {},
                        rule.noncurrent_version_transition ? {
                            NoncurrentVersionTransition: {
                                NoncurrentDays: rule.noncurrent_version_transition.noncurrent_days,
                                StorageClass: rule.noncurrent_version_transition.storage_class,
                            }
                        } : {},
                        rule.noncurrent_version_expiration ? {
                            NoncurrentVersionExpiration: {
                                NoncurrentDays: rule.noncurrent_version_expiration.noncurrent_days,
                            }
                        } : {},
                    ]
                }))
            }));
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
            !http_utils.match_etag(req.headers['if-match'], object_md.etag)) {
            res.status(412).end();
            return false;
        }
        if ('if-none-match' in req.headers &&
            http_utils.match_etag(req.headers['if-none-match'], object_md.etag)) {
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

    _update_usage_report(req) {
        // TODO: Maybe we should plus both prepare_request and total_errors and check their limit?
        // TODO: Maybe we should change from 10 seconds to a higher number cycle? Like minutes/hours?
        if ((this.usage_report.s3_usage_info.prepare_request > 10 ||
                this.usage_report.s3_errors_info.total_errors > 10) &&
            Math.abs(moment().diff(this.usage_report.last_updated, 'Seconds')) > 10) {
            return req.rpc_client.object.add_s3_usage_report({
                    s3_usage_info: this.usage_report.s3_usage_info,
                    s3_errors_info: this.usage_report.s3_errors_info
                })
                .then(() => {
                    this.usage_report = {
                        s3_usage_info: _.cloneDeep(S3_USAGE_INFO_DEFAULTS),
                        s3_errors_info: {
                            total_errors: 0
                        },
                        last_updated: new Date(),
                    };
                })
                .catch(err => {
                    console.error('Error Updating S3 Usage Report', err);
                });
        }
    }
}


function to_s3_date(input) {
    let date = input ? new Date(input) : new Date();
    date.setMilliseconds(0);
    return date.toISOString();
}

function to_aws_date_for_http_header(input) {
    return time_utils.toRFC822(new Date(input));
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

function strip_etag_quotes(etag) {
    const match = (/\s*"(.*)"\s*/).exec(etag);
    return match ? match[1] : etag;
}

module.exports = S3Controller;
