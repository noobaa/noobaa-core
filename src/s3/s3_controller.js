'use strict';

var _ = require('lodash');
// var P = require('../util/promise');
var mime = require('mime');
// var xml2js = require('xml2js');
// var path = require('path');
var api = require('../api');
var dbg = require('../util/debug_module')(__filename);
var string_utils = require('../util/string_utils');
// var time_utils = require('../util/time_utils');
var s3_errors = require('./s3_errors');

dbg.set_level(5);

const DISPLAY_NAME = 'NooBaa';
const DEFAULT_OWNER = Object.freeze({
    ID: 123,
    DisplayName: DISPLAY_NAME
});

class S3Controller {

    constructor(params) {
        this.rpc_client_by_access_key = {};
        this.rpc = api.new_rpc(params.address);
        var signal_client = this.rpc.new_client();
        var n2n_agent = this.rpc.register_n2n_transport(signal_client.node.n2n_signal);
        n2n_agent.set_any_rpc_address();
    }

    prepare_request(req) {
        req.rpc_client = this.rpc_client_by_access_key[req.access_key];
        if (!req.rpc_client) {
            req.rpc_client =
                this.rpc_client_by_access_key[req.access_key] =
                this.rpc.new_client();
            return req.rpc_client.create_access_key_auth({
                access_key: req.access_key,
                string_to_sign: req.string_to_sign,
                signature: req.signature,
            }).return();
        }
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
                var date = to_s3_date(new Date());
                return {
                    ListAllMyBucketsResult: {
                        Owner: DEFAULT_OWNER,
                        Buckets: if_not_empty(_.map(reply.buckets, bucket => ({
                            Bucket: {
                                Name: bucket.name,
                                CreationDate: date
                            }
                        })))
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
        };
        if ('prefix' in req.query) {
            params.key_s3_prefix = decodeURI(req.query.prefix);
        }
        if ('delimiter' in req.query) {
            params.delimiter = decodeURI(req.query.delimiter);
        }
        return req.rpc_client.object.list_objects(params)
            .then(reply => {
                return {
                    ListBucketResult: [{
                            Name: req.params.bucket,
                            Prefix: req.query.prefix,
                            Delimiter: req.query.delimiter,
                            MaxKeys: req.query['max-keys'],
                            Marker: req.query.marker,
                            IsTruncated: false,
                            'Encoding-Type': req.query['encoding-type'],
                        },
                        if_not_empty(_.map(reply.objects, obj => ({
                            Contents: {
                                Key: string_utils.encodeXML(obj.key),
                                LastModified: to_s3_date(obj.info.create_time),
                                ETag: obj.info.etag,
                                Size: obj.info.size,
                                StorageClass: 'Standard',
                                Owner: DEFAULT_OWNER
                            }
                        }))),
                        if_not_empty(_.map(reply.common_prefixes, prefix => ({
                            CommonPrefixes: {
                                Prefix: prefix || ''
                            }
                        })))
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
        };
        if ('prefix' in req.query) {
            params.key_s3_prefix = decodeURI(req.query.prefix);
        }
        if ('delimiter' in req.query) {
            params.delimiter = decodeURI(req.query.delimiter);
        }
        return req.rpc_client.object.list_objects(params)
            .then(reply => {
                return {
                    ListVersionsResult: [{
                            Name: req.params.bucket,
                            Prefix: req.query.prefix,
                            Delimiter: req.query.delimiter,
                            MaxKeys: req.query['max-keys'],
                            KeyMarker: req.query['key-marker'],
                            VersionIdMarker: req.query['version-id-marker'],
                            IsTruncated: false,
                            // NextKeyMarker: ...
                            // NextVersionIdMarker: ...
                            'Encoding-Type': req.query['encoding-type'],
                        },
                        if_not_empty(_.map(reply.objects, obj => ({
                            Version: {
                                Key: string_utils.encodeXML(obj.key),
                                VersionId: '',
                                IsLatest: true,
                                LastModified: to_s3_date(obj.info.create_time),
                                ETag: obj.info.etag,
                                Size: obj.info.size,
                                StorageClass: 'Standard',
                                Owner: DEFAULT_OWNER
                            }
                        }))),
                        if_not_empty(_.map(reply.common_prefixes, prefix => ({
                            CommonPrefixes: {
                                Prefix: prefix || ''
                            }
                        })))
                    ]
                };
            });
    }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadListMPUpload.html
     */
    // get_bucket_uploads(req) { TODO GGG }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETacl.html
     */
    get_bucket_acl(req) {
        return req.rpc_client.bucket.read_bucket({
                name: req.params.bucket
            })
            .then(bucket_info => {
                return {
                    AccessControlPolicy: {
                        Owner: DEFAULT_OWNER
                    }
                };
            });
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
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTacl.html
     * (aka set bucket acl)
     */
    put_bucket_acl(req) {
        // TODO GGG ignoring put_bucket_acl for now
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
    // post_bucket_delete(req) { TODO GGG }



    ///////////////////////////
    // OPERATIONS ON OBJECTS //
    ///////////////////////////

    _object_path(req) {
        // Support _$folder$ used by s3 clients (supported by AWS). Replace with current prefix /
        let key = req.params.key.replace(/_\$folder\$/, '/');
        return {
            bucket: req.params.bucket,
            key: key
        };
    }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html
     */
    head_object(req, res) {
        return req.rpc_client.object.read_object_md(this._object_path(req))
            .then(object_md => {
                res.setHeader('ETag', '"' + object_md.etag + '"');
                res.setHeader('Last-Modified', to_s3_date(object_md.create_time));
                res.setHeader('Content-Type', object_md.content_type);
                res.setHeader('Content-Length', object_md.size);
                set_response_xattr(res, object_md.xattr);
            });
    }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGET.html
     */
    get_object(req, res) {
        return this.head_object(req, res)
            .then(() => {
                let object_driver = req.rpc_client.object_driver_lazy();
                object_driver.serve_http_stream(req, res, this._object_path(req));
                return false; // let the caller know we are handling the response
            });
    }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGETacl.html
     */
    get_object_acl(req) {
        return req.rpc_client.object.read_object_md(this._object_path(req))
            .then(object_md => {
                return {
                    AccessControlPolicy: {
                        Owner: DEFAULT_OWNER
                    }
                };
            });
    }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUT.html
     * (aka upload object, or copy object)
     */
    put_object(req, res) {
        var copy_source = req.headers['x-amz-copy-source'];
        if (copy_source) {
            // TODO GGG COPY OBJECT
            // return req.rpc_client.object.copy_object({});
            throw s3_errors.NotImplemented;
        } else {
            dbg.log0('S3Controller.put_object: headers', req.headers);
            let object_driver = req.rpc_client.object_driver_lazy();
            return object_driver.upload_stream({
                    bucket: req.params.bucket,
                    key: req.params.key,
                    size: req.content_length,
                    content_type: req.headers['content-type'] || mime.lookup(req.params.key),
                    xattr: get_request_xattr(req),
                    source_stream: req,
                    calculate_md5: true
                })
                .then(md5_digest => {
                    let etag = md5_digest.toString('hex');
                    res.setHeader('ETag', '"' + etag + '"');
                    if (req.content_md5) {
                        if (Buffer.compare(md5_digest, req.content_md5)) {
                            // TODO GGG how to handle? delete the object?
                            dbg.error('S3Controller.put_object: BadDigest',
                                'content-md5', req.content_md5.toString('hex'),
                                'etag', etag);
                            throw s3_errors.BadDigest;
                        }
                    }
                });
        }
    }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPOST.html
     */
    // post_object(req) { TODO GGG }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectDELETE.html
     */
    delete_object(req) {
        return req.rpc_client.object.delete_object({
            bucket: req.params.bucket,
            key: req.params.key
        });
    }


    //////////////////////
    // MULTIPART UPLOAD //
    //////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadInitiate.html
     */
    // post_object_uploads(req) { TODO GGG }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadUploadPart.html
     */
    // put_object_uploadId(req) { TODO GGG }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadComplete.html
     */
    // post_object_uploadId(req) { TODO GGG }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadAbort.html
     */
    // delete_object_uploadId(req) { TODO GGG }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadListParts.html
     */
    // get_object_uploadId(req) { TODO GGG }

}


function to_s3_date(input) {
    let date = new Date(input);
    date.setMilliseconds(0);
    return date.toISOString();
}

function if_not_empty(obj) {
    return _.isEmpty(obj) ? undefined : obj;
}

function get_request_xattr(req) {
    let xattr = {};
    _.each(req.headers, (val, hdr) => {
        if (!hdr.startsWith('x-amz-meta-')) return;
        var key = hdr.slice('x-amz-meta-'.length);
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
