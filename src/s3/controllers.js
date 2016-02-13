'use strict';
require('../util/panic');

var _ = require('lodash');
var P = require('../util/promise');
var util = require('util');
var MD5Stream = require('../util/md5_stream');
var mime = require('mime');
var api = require('../api');
var dbg = require('../util/debug_module')(__filename);
var string_utils = require('../util/string_utils');
var promise_utils = require('../util/promise_utils');

var xml2js = require('xml2js');
var FileStore = require('./file-store');
var fileStore = new FileStore('/tmp');
var indexDocument = '';
var errorDocument = '';
var path = require('path');
var time_utils = require('../util/time_utils');


module.exports = function(params) {
    var templateBuilder = require('./xml-template-builder');
    var objects_avarage_part_size = {};
    var clients = {};
    var store_locally = false;
    var calculate_md5 = true;
    var buckets_cache;
    var rpc = api.new_rpc(params.address);
    var signal_client = rpc.new_client();
    var n2n_agent = rpc.register_n2n_transport(signal_client.node.n2n_signal);
    n2n_agent.set_any_rpc_address();

    function getBucketLocally(req, res) {
        var options = {
            marker: req.query.marker || null,
            prefix: req.query.prefix || null,
            maxKeys: parseInt(req.query['max-keys']) || 1000,
            delimiter: req.query.delimiter || null
        };

        if (indexDocument) {
            fileStore.getObject(req.bucket, indexDocument, function(err, object, data) {
                if (err) {
                    return errorResponse(req, res, indexDocument);
                } else {
                    dbg.log3('Serving Page: %s', object.key);
                    return buildResponse(req, res, 200, object, data);
                }
            });
        } else {
            dbg.log3('Fetched bucket "%s" with options %s', req.bucket, options);
            fileStore.getObjects(req.bucket, options, function(err, results) {
                dbg.log3('Found %d objects for bucket "%s"', results.length, req.bucket);

                var template = templateBuilder.buildBucketQuery(options, results);
                return buildXmlResponse(res, 200, template);
            });
        }
    }

    function putObjectLocally(req, res, file_key_name) {
        req.params.key = file_key_name;
        P.ninvoke(fileStore, "putObject", req.params.bucket, req)
            .then(function(key) {
                dbg.log3('Stored object "%s" in bucket "%s" successfully', req.params.key, req.params.bucket);
                res.header('ETag', '"' + key.md5 + '"');
                return res.status(200).end();
            }).then(null, function(err) {
                dbg.error('Error uploading object "%s" to bucket "%s"',
                    file_key_name, req.params.bucket, err, err.stack);
                var template = templateBuilder.buildError('InternalError',
                    'We encountered an internal error. Please try again.');
                return buildXmlResponse(res, 500, template);

            });
    }

    function getObjectLocally(req, res) {
        var keyName = req.params.key;
        var acl = req.query.acl;
        if (acl !== undefined) {
            var template = templateBuilder.buildAcl();
            return buildXmlResponse(res, 200, template);
        }
        P.ninvoke(fileStore, "getObject", req.bucket, keyName)
            .then(function(object, data) {
                var noneMatch = req.headers['if-none-match'];
                if (noneMatch && (noneMatch === object.md5 || noneMatch === '*')) {
                    return res.status(304).end();
                }
                var modifiedSince = req.headers['if-modified-since'];
                if (modifiedSince) {
                    var time = new Date(modifiedSince);
                    var modifiedDate = new Date(object.modifiedDate);
                    if (time >= modifiedDate) {
                        return res.status(304).end();
                    }
                }
                return buildResponse(req, res, 200, object, data);
            }).then(null, function(err) {
                if (indexDocument) {
                    keyName = path.join(keyName, indexDocument);
                    return fileStore.getObject(req.bucket, keyName, function(err, object, data) {
                        if (err) {
                            return errorResponse(req, res, keyName);
                        } else {
                            return buildResponse(req, res, 200, object, data);
                        }
                    });
                } else {
                    return errorResponse(req, res, keyName);
                }
            });
    }

    function buildResponse(req, res, status, object, data) {
        res.header('Etag', '"' + object.md5 + '"');
        res.header('Last-Modified', time_utils.toRFC822(new Date(object.modifiedDate)));
        res.header('Content-Type', object.contentType);

        if (object.contentEncoding) {
            res.header('Content-Encoding', object.contentEncoding);
        }

        res.header('Content-Length', object.size);
        if (object.customMetaData.length > 0) {
            object.customMetaData.forEach(function(metaData) {
                res.header(metaData.key, metaData.value);
            });
        }
        res.status(status);
        _.each(object.xattr, function(val, key) {
            res.header('x-amz-meta-' + key, val);
            dbg.log3('RETURN XATTR (2)', key, val);
        });
        if (req.method === 'HEAD') {
            return res.end();
        }
        return res.end(data);
    }

    function errorResponse(req, res, keyName) {
        dbg.error('Object "%s" in bucket "%s" does not exist', keyName, req.bucket.name);

        if (indexDocument) {
            if (errorDocument) {
                fileStore.getObject(req.bucket, errorDocument, function(err, object, data) {
                    if (err) {
                        console.error('Custom Error Document not found: ' + errorDocument);
                        return notFoundResponse(req, res);
                    } else {
                        return buildResponse(req, res, 404, object, data);
                    }
                });
            } else {
                return notFoundResponse(req, res);
            }
        } else {
            var template = templateBuilder.buildKeyNotFound(keyName);
            return buildXmlResponse(res, 404, template);
        }
    }

    function notFoundResponse(req, res) {
        var ErrorDoc = '<!DOCTYPE html>\n<html><head><title>404 - Resource Not Found</title></head><body><h1>404 - Resource Not Found</h1></body></html>';

        return buildResponse(req, res, 404, {
            modifiedDate: new Date(),
            contentType: 'text/html',
            customMetaData: [],
            size: ErrorDoc.length
        }, ErrorDoc);
    }

    function extract_access_key(req) {
        var req_access_key;
        if (req.headers.authorization) {
            var end_of_aws_key = req.headers.authorization.indexOf(':');
            if (req.headers.authorization.substring(0, 4) === 'AWS4') {
                //authorization: 'AWS4-HMAC-SHA256 Credential=wwwwwwwwwwwww123aaaa/20151023/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=0b04a57def200559b3353551f95bce0712e378c703a97d58e13a6eef41a20877',
                var credentials_location = req.headers.authorization.indexOf('Credential') + 11;
                req_access_key = req.headers.authorization.substring(credentials_location, req.headers.authorization.indexOf('/'));
            } else {
                req_access_key = req.headers.authorization.substring(4, end_of_aws_key);
            }
        } else {
            if (req.query.AWSAccessKeyId) {
                req_access_key = req.query.AWSAccessKeyId;
            } else if (req.query['X-Amz-Credential']) {
                req_access_key = req.query['X-Amz-Credential'].substring(0, req.query['X-Amz-Credential'].indexOf('/'));
            }
        }
        return req_access_key;
    }

    function extract_s3_info(req) {

        if (!_.has(clients, req.access_key)) {
            return P.fcall(function() {
                return this.add_new_system_client(req);
            });
        }

        if (_.isUndefined(clients[req.access_key].client.options)) {
            dbg.error('extract_s3_info problem');
        }
        var auth_token = clients[req.access_key].client.options.auth_token;
        if (auth_token && auth_token.indexOf('auth_token') > 0) {
            //update signature and string_to_sign
            //TODO: optimize this part. two converstions per request is a bit too much.

            var auth_token_obj = JSON.parse(auth_token);
            auth_token_obj.signature = req.signature;
            auth_token_obj.string_to_sign = req.string_to_sign;
            auth_token_obj.access_key = req.access_key;
            return auth_token_obj;

        } else {
            //TODO:
            //Quick patch.
            //Need to find a better way to use client objects in parallel and pass the request information
            var new_params = {
                'auth_token': auth_token,
                'signature': req.signature,
                'string_to_sign': req.string_to_sign,
                'access_key': req.access_key
            };

            return new_params;
        }
    }

    function set_xattr(req, params) {
        params.xattr = params.xattr || {};
        _.each(req.headers, function(val, hdr) {
            // if (!_.isString(hdr) || !_.isString(val)) return;
            if (hdr.slice(0, 'x-amz-meta-'.length) !== 'x-amz-meta-') return;
            var key = hdr.slice('x-amz-meta-'.length);
            if (!key) return;
            params.xattr[key] = val;
            dbg.log3('SET XATTR', key, val);
        });
        // if (!_.isEmpty(params.xattr)) {
        //     delete params.xattr;
        // }
    }


    function uploadPart(req, res) {

        if (store_locally) {
            return putObjectLocally(req, res, req.query.uploadId + '___' + req.query.partNumber);
        }
        var md5_calc = new MD5Stream();
        var part_md5 = '0';
        var access_key = extract_access_key(req);
        var upload_part_number = parseInt(req.query.partNumber, 10);

        P.fcall(function() {
                var bucket_name = req.bucket;


                if (calculate_md5) {
                    req.pipe(md5_calc);
                }
                md5_calc.on('finish', function() {
                    part_md5 = md5_calc.toString();
                    dbg.log3('uploadObject: MD5 data (end)', part_md5, 'part:', upload_part_number);
                    return part_md5;
                });

                var content_length = req.headers['content-length'];
                // tranform stream that calculates md5 on-the-fly
                var upload_part_info = {
                    bucket: bucket_name,
                    key: decodeURIComponent(req.query.uploadId),
                    size: content_length,
                    content_type: req.headers['content-type'] || mime.lookup(req.query.uploadId),
                    source_stream: calculate_md5 ? md5_calc : req,
                    upload_part_number: upload_part_number

                };
                dbg.log3('Uploading part number', req.query, req.query.partNumber, ' of uploadID ',
                    req.query.uploadId, ' VS ', req.query.uploadId, 'content length:', req.headers['content-length']);
                dbg.log3('upload info', _.pick(upload_part_info, 'bucket', 'key', 'size',
                    'content_type', 'upload_part_number', 'md5'));

                return clients[access_key].client.object_driver_lazy().upload_stream_parts(upload_part_info);
            })
            .then(function() {
                return promise_utils.pwhile(
                    function() {
                        return part_md5 === '0';
                    },
                    function() {
                        dbg.log0('waiting for md5 for ', req.query.uploadId, ' with part', req.query.partNumber);
                        return P.delay(5);
                    });
            }).then(function() {
                return clients[access_key].client.object.complete_part_upload({
                    bucket: req.bucket,
                    key: decodeURIComponent(req.query.uploadId),
                    upload_part_number: upload_part_number,
                    etag: part_md5
                });

            }).then(function() {
                try {

                    dbg.log0('COMPLETED: upload', req.query.uploadId, ' part:', req.query.partNumber, 'md5:', part_md5);
                    res.header('ETag', '"' + part_md5 + '"');

                } catch (err) {
                    dbg.error('FAILED', err, res);

                }
                return res.status(200).end();

            }).then(null, function(err) {
                dbg.error('ERROR: upload:' + req.query.uploadId + ' err:' + util.inspect(err.stack));
                return res.status(500).end();
            });
    }

    function listPartsResult(req, res) {
        P.fcall(function() {
            var template;
            var upload_id = req.query.uploadId;
            var max_parts = req.query['max-parts'] || 1000;
            var access_key = extract_access_key(req);
            var part_number_marker = req.query['part-number​-marker'] || '';
            dbg.log3('List part results for upload id:', upload_id, 'max parts', max_parts, 'part marker', part_number_marker);
            var list_options = {
                bucket: req.bucket,
                key: req.query.uploadId,
                part_number_marker: 1,
                max_parts: 1000
            };
            var options = {
                auth_token: JSON.stringify(extract_s3_info(req))
            };

            return clients[access_key].client.object.list_multipart_parts(list_options, options)
                .then(function(list_result) {
                    list_options.NextPartNumberMarker = list_result.next_part_number_marker;
                    list_options.IsTruncated = list_result.next_part_number_marker > list_result.max_parts;
                    list_options.MaxParts = list_result.max_parts;
                    template = templateBuilder.ListPartsResult(list_result.upload_parts, list_options);
                    return buildXmlResponse(res, 200, template);
                });
        });
    }

    function buildXmlResponse(res, status, template) {
        //dbg.log("build",res);
        res.header('Content-Type', 'application/xml');
        res.status(status);
        dbg.log2('template:', template);
        return res.send(template);
    }

    function delete_if_exists(target_object, access_key) {
        dbg.log3('listing ', target_object.key, ' in bucket:', target_object.bucket);
        return clients[access_key].client.object.delete_object({
            bucket: target_object.bucket,
            key: target_object.key
        }).then(function() {
            dbg.log0('Deleted old version of object "%s" in bucket "%s"', target_object.key, target_object.bucket);
        }, function(err) {
            if (err.rpc_code === 'NOT_FOUND') {
                //ignore
            } else {
                dbg.error('Failure while trying to delete old version of object "%s"', target_object.key, err);
            }
        });
    }

    function copy_object(from_object, to_object, src_bucket, target_bucket, access_key, req) {
        dbg.log0('copy:', from_object, to_object, src_bucket, target_bucket, access_key);

        from_object = decodeURIComponent(from_object);
        var object_path = {
            bucket: src_bucket,
            key: from_object
        };
        var create_params = {};
        var source_object_md;
        //read source object meta data. if doesn't exist, send error to the client.
        return clients[access_key].client.object_driver_lazy().get_object_md(object_path)
            .then(function(md) {
                var target_object_path = {
                    bucket: target_bucket,
                    key: to_object
                };
                source_object_md = md;
                //check if target exists. if so, delete it (s3 overwrites objects)
                return delete_if_exists(target_object_path, access_key)
                    .then(function() {
                        //check if folder
                        var last_char = from_object[from_object.length - 1];
                        if (source_object_md.size === 0 && last_char === '/') {
                            dbg.log0('Folder copy:', from_object, ' to ', to_object);
                            return list_objects_with_prefix(from_object, '/', src_bucket, access_key)
                                .then(function(objects_and_folders) {
                                    return P.all(_.times(objects_and_folders.objects.length, function(i) {
                                        dbg.log0('copy inner objects:', objects_and_folders.objects[i].key, objects_and_folders.objects[i].key.replace(from_object, to_object));
                                        return copy_object(objects_and_folders.objects[i].key,
                                            objects_and_folders.objects[i].key.replace(from_object, to_object),
                                            src_bucket, target_bucket, access_key);
                                    })).then(function() {
                                        //                                dbg.log0('folders......',_.keys(objects_and_folders.folders));
                                        return P.map(_.keys(objects_and_folders.folders), function(folder) {
                                            dbg.log0('copy inner folders:', folder, folder.replace(from_object, to_object));
                                            return copy_object(folder, folder.replace(from_object, to_object),
                                                src_bucket, target_bucket, access_key);
                                        });
                                    });
                                });
                        }
                        create_params.content_type = md.content_type;
                        create_params.size = md.size;
                        dbg.log0('DIRECTIVE FOR METADATA:', req.headers['x-amz-metadata-directive']);
                        if (req && req.headers['x-amz-metadata-directive'] === 'REPLACE') {
                            set_xattr(req, create_params);
                        } else {
                            create_params.xattr = _.clone(md.xattr);
                        }
                        dbg.log3('XATTR PARAMS:', create_params);
                        var new_obj_parts;
                        return clients[access_key].client.object.read_object_mappings({
                                bucket: src_bucket,
                                key: from_object,
                            })
                            .then(function(mappings) {
                                dbg.log3('\n\nListing object maps:', from_object);
                                var i = 1;
                                _.each(mappings.parts, function(part) {
                                    dbg.log3('#' + i, '[' + part.start + '..' + part.end + ']:\t', part);
                                    i += 1;
                                });
                                //copy
                                new_obj_parts = {
                                    bucket: target_bucket,
                                    key: to_object,
                                    parts: _.map(mappings.parts, function(part) {
                                        return {
                                            start: part.start,
                                            end: part.end,
                                            chunk: part.chunk,
                                            frags: part.frags
                                        };
                                    })
                                };
                                create_params.bucket = target_bucket;
                                create_params.key = to_object;

                                return clients[access_key].client.object.create_multipart_upload(create_params);
                            })
                            .then(function(info) {
                                return clients[access_key].client.object.allocate_object_parts(new_obj_parts);
                            })
                            .then(function(res) {
                                dbg.log0('complete multipart copy ', create_params);
                                var bucket_key_params = _.pick(create_params, 'bucket', 'key');
                                bucket_key_params.etag = source_object_md.etag;

                                return clients[access_key].client.object.complete_multipart_upload(bucket_key_params);
                            })
                            .then(function(res) {
                                dbg.log3('COMPLETED: copy');

                                return true;
                            });
                    });

            }).then(null, function(err) {
                dbg.error("Failed to upload", err);
                return false;
            });
    }

    function list_objects_with_prefix(prefix, delimiter, bucket_name, access_key) {
        var list_params = {
            bucket: bucket_name,
            key_s3_prefix: ''
        };
        if (prefix) {
            //prefix = prefix.replace(/%2F/g, '/');
            prefix = decodeURI(prefix);
            list_params.key_s3_prefix = prefix;
        }
        if (delimiter) {
            delimiter = decodeURI(delimiter);
        }
        dbg.log3('Listing objects with', list_params, delimiter, 'key:', access_key);
        return clients[access_key].client.object.list_objects(list_params)
            .then(function(results) {
                var folders = {};
                dbg.log3('results:', results);
                var objects = _.filter(results.objects, function(obj) {
                    try {
                        var date = new Date(obj.info.create_time);
                        date.setMilliseconds(0);
                        obj.modifiedDate = date.toISOString();
                        obj.md5 = 100;
                        obj.size = obj.info.size;

                        //we will keep the full path for CloudBerry online cloud backup tool
                        var obj_sliced_key = obj.key.slice(prefix.length);
                        dbg.log3('obj.key:', obj.key, ' prefix ', prefix, ' sliced', obj_sliced_key);
                        if (obj_sliced_key.indexOf(delimiter) >= 0) {
                            var folder = obj_sliced_key.split(delimiter, 1)[0];
                            folders[prefix + folder + "/"] = true;
                            return false;
                        }

                        if (list_params.key === obj.key) {
                            dbg.log3('LISTED KEY same as REQUIRED', obj.key);
                            if (prefix === obj.key && prefix.substring(prefix.length - 1) !== delimiter) {

                                return true;
                            }

                            return false;
                        }
                        if (!obj.key) {
                            // empty key - might be object created as a folder
                            return false;
                        }
                        return true;
                    } catch (err) {
                        dbg.error('Error while listing objects:', err);
                    }
                });

                var objects_and_folders = {
                    objects: objects,
                    folders: folders
                };
                dbg.log3('About to return objects and folders:', objects_and_folders);
                return objects_and_folders;
            }).then(null, function(err) {
                dbg.error('failed to list object with prefix', err);
                return {
                    objects: {},
                    folders: {}
                };
            });
    }

    function uploadObject(req, res, file_key_name) {
        var create_params = {};
        var md5 = '0';
        P.fcall(function() {
                if (store_locally) {
                    putObjectLocally(req, res, file_key_name);
                } else {
                    var access_key = extract_access_key(req);
                    dbg.log3('uploadObject: upload', file_key_name);

                    // tranform stream that calculates md5 on-the-fly
                    var md5_calc = new MD5Stream();
                    if (calculate_md5) {
                        req.pipe(md5_calc);
                    }

                    md5_calc.on('finish', function() {
                        md5 = md5_calc.toString();
                        dbg.log0('uploadObject: MD5 data (end)', md5);
                    });

                    var upload_params = {
                        bucket: req.bucket,
                        key: file_key_name,
                        size: parseInt(req.headers['content-length'], 10),
                        content_type: req.headers['content-type'] || mime.lookup(file_key_name),
                        source_stream: calculate_md5 ? md5_calc : req
                    };

                    create_params = _.pick(upload_params, 'bucket', 'key', 'size', 'content_type');
                    var bucket_key_params = _.pick(upload_params, 'bucket', 'key');

                    set_xattr(req, create_params);

                    dbg.log3('upload_stream: start upload', upload_params.key, upload_params.size, 'create params', create_params);
                    if (_.isUndefined(clients[access_key].buckets[req.bucket])) {
                        clients[access_key].buckets = [req.bucket];
                        clients[access_key].buckets[req.bucket] = {
                            upload_ids: []
                        };
                    }

                    clients[access_key].buckets[req.bucket].upload_ids[file_key_name] = {
                        start: time_utils.millistamp()
                    };

                    return clients[access_key].client.object.create_multipart_upload(create_params)
                        .then(function() {
                            return clients[access_key].client.object_driver_lazy().upload_stream_parts(upload_params);
                        })
                        .then(function() {
                            bucket_key_params.etag = md5;
                            dbg.log0('upload_stream: complete upload', upload_params.key, 'with md5', bucket_key_params, ' took', time_utils.millitook(clients[access_key].buckets[req.bucket].upload_ids[file_key_name].start));
                            return clients[access_key].client.object.complete_multipart_upload(bucket_key_params);
                        }, function(err) {
                            dbg.error('upload_stream: error write stream', upload_params.key, err);
                            throw err;
                        });

                }

            })
            .then(function() {
                dbg.log3('COMPLETED: uploadObject', file_key_name, md5);
                res.header('ETag', '"' + md5 + '"');
                _.each(create_params.xattr, function(val, key) {
                    res.header('x-amz-meta-' + key, val);
                    dbg.log3('RETURN XATTR (2)', key, val);
                });

                return res.status(200).end();
            })
            .then(null, function(err) {
                dbg.error('ERROR: uploadObject:' + file_key_name + ' err:' + util.inspect(err.stack));
                return res.status(500).end();
            });
    }


    function isBucketExists(bucketName, s3_info) {
        dbg.log3('isBucketExists', bucketName, ' info:', s3_info, 'key:', s3_info.access_key, 'auth', clients[s3_info.access_key].client.options.auth_token);

        var options = {
            auth_token: JSON.stringify(s3_info)
        };

        return clients[s3_info.access_key].client.bucket.list_buckets({}, options)
            .then(function(reply) {
                dbg.log3('trying to find', bucketName, 'in', reply.buckets);
                buckets_cache = reply.buckets;
                if (_.findIndex(reply.buckets, {
                        'name': bucketName
                    }) < 0) {
                    return false;
                } else {
                    return true;
                }
            });
    }

    /**
     * The following methods correspond the S3 api. For more information visit:
     * http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html
     */
    return {
        build_unauthorized_response: function(res, string_to_sign) {
            var template = templateBuilder.buildSignatureDoesNotMatch(string_to_sign);
            return buildXmlResponse(res, 401, template);
        },
        update_system_auth: function(req) {},
        is_system_client_exists: function(access_key) {
            return P.fcall(function() {
                dbg.log3('check if system exists for key:', access_key, _.has(clients, access_key));
                return _.has(clients, access_key);
            });
        },
        add_new_system_client: function(req) {
            dbg.log3('add_new_system_client', req.access_key);
            return P.fcall(function() {
                if (_.isEmpty(req.access_key)) {
                    dbg.log3('Exiting as there is no credential information.');
                    throw new Error("No credentials");

                } else {
                    dbg.log3('Adding new system client.', req.access_key);
                    clients[req.access_key] = {
                        client: rpc.new_client(),
                        buckets: []
                    };
                    return clients[req.access_key];
                }
            }).then(function(new_client_system) {
                dbg.log3('create auth', new_client_system);
                return clients[req.access_key].client.create_access_key_auth({
                    'access_key': req.access_key,
                    'string_to_sign': req.string_to_sign,
                    'signature': req.signature,
                });
            }).then(function(token) {
                dbg.log2('Got Token:', token, clients[req.access_key]);
            }).then(null, function(err) {
                dbg.error('failure while creating new client', err, err.stack);
                delete clients[req.access_key];
                throw {
                    statusCode: 401,
                    data: 'SignatureDoesNotMatch'
                };
            });
        },

        /**
         * Middleware to check if a bucket exists
         */
        bucketExists: function(req, res, next) {
            var bucketName = req.params.bucket;
            isBucketExists(bucketName, extract_s3_info(req))
                .then(function(exists) {
                    if (!exists) {
                        dbg.error('(1) No bucket found for "%s"', bucketName);
                        var template = templateBuilder.buildBucketNotFound(bucketName);
                        return buildXmlResponse(res, 404, template);
                    }
                    req.bucket = bucketName;
                    return next();
                }).then(null, function(err) {
                    dbg.error('error while trying to check if bucket exists', err);
                    var template = templateBuilder.buildSignatureDoesNotMatch(req.string_to_sign);
                    return buildXmlResponse(res, 401, template);
                });
        },
        bucketExistsInCache: function(req, res, next) {
            var bucketName = req.params.bucket;
            return P.fcall(function() {
                if (_.isEmpty(buckets_cache)) {
                    dbg.log3('buckets cache empty');
                    return isBucketExists(bucketName, extract_s3_info(req))
                        .then(function(exists) {
                            return exists;
                        });
                } else {
                    dbg.log3('has buckets cache ', buckets_cache, _.findIndex(buckets_cache, {
                        'name': bucketName
                    }));
                    if (_.findIndex(buckets_cache, {
                            'name': bucketName
                        }) < 0) {
                        return false;
                    } else {
                        return true;
                    }
                }
            }).then(function(bucket_exists) {
                if (!bucket_exists) {
                    dbg.warn('(1) No bucket found for "%s"', bucketName);
                    return isBucketExists(bucketName, extract_s3_info(req))
                        .then(function(exists) {
                            bucket_exists = exists;
                            if (!bucket_exists) {
                                dbg.error('(1) No bucket found for "%s" in server as well', bucketName, buckets_cache);
                                var template = templateBuilder.buildBucketNotFound(bucketName);
                                return buildXmlResponse(res, 404, template);
                            } else {
                                dbg.log3('Found bucket name in server ' + bucketName);
                                req.bucket = bucketName;
                                return next();
                            }
                        });
                } else {
                    dbg.log3('got bucket name ' + bucketName);
                    req.bucket = bucketName;
                    return next();
                }
            });
        },

        getBuckets: function(req, res) {
            dbg.log3('getBuckets', req.params.bucket);
            var date = new Date();
            date.setMilliseconds(0);
            date = date.toISOString();

            /*
            var buckets = [{
                name: req.params.bucket,
                creationDate: date
            }];
            */
            var access_key = extract_access_key(req);
            var template;
            var options = {
                auth_token: JSON.stringify(extract_s3_info(req))
            };
            clients[access_key].client.bucket.list_buckets({}, options)
                .then(function(reply) {
                    _.each(reply.buckets, function(bucket) {
                        bucket.creationDate = date;
                    });
                    dbg.log3('Fetched %d buckets', reply.buckets.length, ' b: ', reply.buckets);
                    var template = templateBuilder.buildBuckets(reply.buckets);
                    dbg.log3('bucket response:', template);
                    return buildXmlResponse(res, 200, template);
                })
                .then(null, function(err) {
                    dbg.error('Failed to get list of buckets', err);
                    if (err.status) {
                        if (err.status === 401) {
                            template = templateBuilder.buildSignatureDoesNotMatch('');
                            return buildXmlResponse(res, 401, template);
                        } else {
                            template = templateBuilder.buildBuckets({});
                            return buildXmlResponse(res, err.status, template);
                        }

                    } else {
                        template = templateBuilder.buildBuckets({});
                        return buildXmlResponse(res, 500, template);
                    }
                });
        },
        getBucket: function(req, res) {

            if (store_locally) {
                return getBucketLocally(req, res);
            }
            var options = {
                marker: req.query.marker || null,
                prefix: req.query.prefix || '',
                maxKeys: parseInt(req.query['max-keys']) || 1000,
                delimiter: req.query.delimiter // removed default value - shouldn't be such || '/'
            };
            dbg.log3('get bucket (list objects) with options:', options, req.bucket, req.params);
            var template;

            if (req.query.location !== undefined) {
                template = templateBuilder.buildLocation();
                return buildXmlResponse(res, 200, template);

            } else {

                list_objects_with_prefix(options.prefix, options.delimiter, req.bucket, extract_access_key(req))
                    .then(function(objects_and_folders) {
                        options.bucketName = req.bucket || params.bucket;
                        options.common_prefixes = _.isEmpty(objects_and_folders.folders) ? '' : _.keys(objects_and_folders.folders);
                        dbg.log3('total of objects:', objects_and_folders.objects.length, ' folders:', options.common_prefixes, 'bucket:', options.bucketName);

                        if (req.query.versioning !== undefined) {
                            if (!_.isEmpty(options.common_prefixes)) {
                                var date = new Date();
                                date.setMilliseconds(0);
                                date = date.toISOString();
                                _.each(options.common_prefixes, function(folder) {
                                    dbg.log3('adding common_prefixe (folder):', folder);
                                    objects_and_folders.objects.unshift({
                                        key: folder,
                                        modifiedDate: date,
                                        md5: 100,
                                        size: 0
                                    });
                                });
                            }
                            template = templateBuilder.buildBucketVersionQuery(options, objects_and_folders.objects);
                        } else {
                            template = templateBuilder.buildBucketQuery(options, objects_and_folders.objects);
                        }
                        return buildXmlResponse(res, 200, template);
                    })
                    .then(function() {
                        dbg.log3('COMPLETED: list');
                    }).then(null, function(err) {
                        dbg.error('ERROR: list', err, err.stack, options);
                        if (err.status) {
                            if (err.status === 401) {
                                template = templateBuilder.buildSignatureDoesNotMatch('');
                                return buildXmlResponse(res, 401, template);
                            } else {
                                template = templateBuilder.buildBuckets({});
                                return buildXmlResponse(res, err.status, template);
                            }

                        } else {
                            template = templateBuilder.buildBuckets({});
                            return buildXmlResponse(res, 500, template);
                        }
                    });
            }

        },
        putBucket: function(req, res) {
            var bucketName = req.params.bucket;
            var template;
            var s3_info = extract_s3_info(req);
            var access_key = s3_info.access_key;
            dbg.log3('put bucket');
            /**
             * Derived from http://docs.aws.amazon.com/AmazonS3/latest/dev/BucketRestrictions.html
             */
            if ((/^[a-z0-9]+(-[a-z0-9]+)*$/.test(bucketName) === false)) {
                template = templateBuilder.buildError('InvalidBucketName',
                    'Bucket names can contain only lowercase letters, numbers, and hyphens. ' +
                    'Each label must start and end with a lowercase letter or a number.');
                dbg.error('Error creating bucket "%s" because the name is invalid', bucketName);
                return buildXmlResponse(res, 400, template);
            }
            if (bucketName.length < 3 || bucketName.length > 63) {
                dbg.error('Error creating bucket "%s" because the name is invalid', bucketName);
                template = templateBuilder.buildError('InvalidBucketName',
                    'The bucket name must be between 3 and 63 characters.');
                return buildXmlResponse(res, 400, template);
            }
            P.fcall(function() {
                dbg.log3('check if bucket exists');
                return isBucketExists(bucketName, s3_info)
                    .then(function(exists) {
                        if (exists) {
                            dbg.error('Error creating bucket. Bucket "%s" already exists', bucketName);
                            var template = templateBuilder.buildError('BucketAlreadyExists',
                                'The requested bucket already exists');
                            return buildXmlResponse(res, 409, template);
                        } else {
                            dbg.log3('Creating new tiering_policy for bucket', bucketName);
                            return clients[access_key].client.tiering_policy.create_policy({
                                    name: bucketName + '_tiering_' + Date.now(),
                                    tiers: [{
                                        order: 0,
                                        tier: 'default_tier'
                                    }]
                                })
                                .then(function() {
                                    dbg.log3('Creating new bucket', bucketName);
                                    return clients[access_key].client.bucket.create_bucket({
                                        name: bucketName,
                                        tiering: bucketName + '_tiering'
                                    });
                                })
                                .then(function() {
                                    dbg.log3('Created new bucket "%s" successfully', bucketName);
                                    res.header('Location', '/' + bucketName);
                                    return res.status(200).send();
                                });

                        }
                    })
                    .then(null, function(err) {
                        dbg.error('Error creating bucket "%s"', err);
                        var template = templateBuilder.buildError('InternalError',
                            'We encountered an internal error. Please try again.');
                        return buildXmlResponse(res, 500, template);
                    });
            });
        },
        deleteBucket: function(req, res) {
            var bucketName = req.params.bucket;
            var s3_info = extract_s3_info(req);

            P.fcall(function() {
                dbg.log3('check if bucket exists');
                return isBucketExists(bucketName, s3_info)
                    .then(function(exists) {
                        if (exists) {
                            clients[s3_info.access_key].client.bucket.delete_bucket({
                                    name: bucketName
                                })
                                .then(function() {
                                    dbg.log0('Deleted new bucket "%s" successfully', bucketName);
                                    res.header('Location', '/' + bucketName);
                                    return res.status(200).send();
                                }).then(null, function(err) {
                                    var template = templateBuilder.buildBucketNotEmpty(req.bucket.name);
                                    return buildXmlResponse(res, 409, template);
                                });
                        } else {
                            dbg.error('no such bucket', bucketName);
                        }
                    });
            });

        },



        getObject: function(req, res) {
            if (store_locally) {
                return getObjectLocally(req, res);
            }

            //if ListMultipartUploads
            if (!_.isUndefined(req.query.uploadId)) {
                return listPartsResult(req, res);
            }

            var keyName = req.params.key;
            var acl = req.query.acl;
            var template;
            var access_key = extract_access_key(req);

            if (acl !== undefined) {
                template = templateBuilder.buildAcl();
                return buildXmlResponse(res, 200, template);
            } else {
                if (req.query.location !== undefined) {
                    template = templateBuilder.buildLocation();
                    return buildXmlResponse(res, 200, template);
                } else {
                    if (req.path.indexOf('Thumbs.db', req.path.length - 9) !== -1) {
                        dbg.log2('Thumbs up "%s" in bucket "%s" does not exist', keyName, req.bucket);
                        template = templateBuilder.buildKeyNotFound(keyName);
                        return buildXmlResponse(res, 404, template);
                    }
                    //S3 browser format - maybe future use.
                    // keyName = keyName.replace('..chunk..map','');
                    var object_path = {
                        bucket: req.bucket,
                        key: keyName
                    };
                    //Support _$folder$ used by s3 clients (supported by AWS). Replace with current prefix /
                    dbg.log3('getObject', object_path, req.method);
                    object_path.key = object_path.key.replace(/_\$folder\$/, '/');
                    dbg.log3('getObject (after)', object_path, req.method);

                    return clients[access_key].client.object.read_object_md(object_path)
                        .then(function(object_md) {
                            dbg.log3('object_md:', object_md);
                            var create_date = new Date(object_md.create_time);
                            create_date.setMilliseconds(0);

                            res.header('ETag', '"' + object_md.etag + '"');
                            res.header('Last-Modified', time_utils.toRFC822(create_date));
                            res.header('Content-Type', object_md.content_type);
                            res.header('Content-Length', object_md.size);
                            res.header('x-amz-meta-cb-modifiedtime', req.headers['x-amz-date'] || create_date);
                            res.header('x-amz-restore', 'ongoing-request="false"');
                            res.header('x-amz-id-2', 'FSVaTMjrmBp3Izs1NnwBZeu7M19iI8UbxMbi0A8AirHANJBo+hEftBuiESACOMJp');
                            res.header('x-amz-request-id', 'E5CEFCB143EB505A');
                            _.each(object_md.xattr, function(val, key) {
                                res.header('x-amz-meta-' + key, val);
                                dbg.log3('RETURN XATTR(3)', key, val);
                            });

                            if (req.method === 'HEAD') {
                                dbg.log3('Head ', res._headers);

                                return res.status(200).end();
                            } else {
                                //read ranges
                                if (req.header('range')) {
                                    clients[access_key].client.object_driver_lazy().serve_http_stream(req, res, object_path);
                                } else {
                                    clients[access_key].client.object_driver_lazy().open_read_stream(object_path).pipe(res);
                                }
                            }
                        }).then(null, function(err) {
                            //if cloudberry tool is looking for its own format for large files and can find it,
                            //we will try with standard format
                            if (object_path.key.indexOf('..chunk..map') > 0) {
                                dbg.log0('Identified cloudberry format, return error 404');
                                object_path.key = object_path.key.replace('..chunk..map', '');
                                var template = templateBuilder.buildKeyNotFound(keyName);
                                return buildXmlResponse(res, 404, template);
                            } else {
                                dbg.error('Cannot find file. will retry as folder (', object_path.key + '/', ')', err);
                                //retry as folder name
                                object_path.key = object_path.key + '/';
                            }

                            return clients[access_key].client.object.read_object_md(object_path)
                                .then(function(object_md) {
                                    dbg.log3('obj_md2', object_md);
                                    var create_date = new Date(object_md.create_time);
                                    create_date.setMilliseconds(0);

                                    res.header('Last-Modified', time_utils.toRFC822(create_date));
                                    res.header('Content-Type', object_md.content_type);
                                    res.header('Content-Length', object_md.size);
                                    res.header('x-amz-meta-cb-modifiedtime', req.headers['x-amz-date']);
                                    _.each(object_md.xattr, function(val, key) {
                                        res.header('x-amz-meta-' + key, val);
                                        dbg.log3('RETURN XATTR', key, val);
                                    });
                                    if (req.method === 'HEAD') {
                                        return res.end();
                                    } else {
                                        clients[access_key].client.object_driver_lazy().open_read_stream(object_path).pipe(res);
                                    }
                                }).then(null, function(err) {
                                    dbg.error('ERROR: while download from noobaa', err);
                                    var template = templateBuilder.buildKeyNotFound(keyName);
                                    dbg.error('Object "%s" in bucket "%s" does not exist', keyName, req.bucket);
                                    return buildXmlResponse(res, 404, template);
                                });
                        });
                }
            }
        },
        putObject: function(req, res) {
            dbg.log0('put object');

            var template;
            var acl = req.query.acl;
            var access_key = extract_access_key(req);
            var delimiter = req.query.delimiter;
            if (acl !== undefined) {
                template = templateBuilder.buildAcl();
                dbg.log3('Fake ACL (200)');
                return buildXmlResponse(res, 200, template);
            }
            var copy = req.headers['x-amz-copy-source'];

            if (!_.isUndefined(req.query.partNumber)) {
                if (copy) {
                    template = templateBuilder.buildError('Upload Part - Copy',
                        'Copy of part is not supported');
                    dbg.log3('Copy of part is not supported');
                    return buildXmlResponse(res, 400, template);
                } else {
                    return uploadPart(req, res);
                }
            }

            if (copy) {
                delimiter = req.query.delimiter || '%2F';
                if (copy.indexOf('/') === 0) {
                    delimiter = '/';
                    copy = copy.substring(1);
                }
                var srcObjectParams = copy.split(delimiter);

                var srcBucket = srcObjectParams[0];
                var srcObject = srcObjectParams.slice(1).join(delimiter);
                dbg.log0('Attempt to copy object:', srcObject, ' from bucket:', srcBucket, ' to ', req.params.key, ' srcObjectParams: ', srcObjectParams, ' delimiter:', delimiter);
                return isBucketExists(srcBucket, extract_s3_info(req))
                    .then(function(exists) {
                        if (!exists) {
                            dbg.error('No bucket found (2) for "%s"', srcBucket, delimiter, copy.indexOf(delimiter), copy.indexOf('/'), srcObjectParams, srcObject);
                            template = templateBuilder.buildBucketNotFound(srcBucket);
                            return buildXmlResponse(res, 404, template);
                        }
                        if (decodeURIComponent(srcObject) === req.params.key && srcBucket === req.bucket) {
                            dbg.log0('DIRECTIVE FOR METADATA:', req.headers['x-amz-metadata-directive']);
                            srcObject = decodeURIComponent(srcObject);
                            var create_params = {};
                            if (req && req.headers['x-amz-metadata-directive'] === 'REPLACE') {
                                set_xattr(req, create_params);
                            } else {
                                return clients[access_key].client.object.read_object_md({
                                    bucket: srcBucket,
                                    key: srcObject,
                                }).then(function(md) {
                                    create_params.xattr = _.clone(md.xattr);
                                });
                            }

                            return clients[access_key].client.object.update_object_md({
                                bucket: req.bucket,
                                key: srcObject,
                                xattr: create_params.xattr

                            }).then(function() {
                                template = templateBuilder.buildCopyObject(req.params.key);
                                _.each(create_params.xattr, function(val, key) {
                                    res.header('x-amz-meta-' + key, val);
                                    dbg.log0('RETURN XATTR', key, val);
                                });

                                return buildXmlResponse(res, 200, template);
                            });

                        } else {
                            return copy_object(srcObject, req.params.key, srcBucket,
                                    req.bucket, access_key, req)
                                .then(function(is_copied) {
                                    if (is_copied) {
                                        template = templateBuilder.buildCopyObject(req.params.key);
                                        return buildXmlResponse(res, 200, template);
                                    } else {
                                        template = templateBuilder.buildKeyNotFound(srcObject);
                                        return buildXmlResponse(res, 404, template);
                                    }
                                });

                        }
                    });
            } else {

                var file_key_name = req.params.key;
                if (store_locally) {
                    return putObjectLocally(req, res, file_key_name);
                }
                return P.fcall(function() {
                    dbg.log0('listing ', req.params.key, ' in bucket:', req.bucket);
                    return clients[access_key].client.object_driver_lazy().get_object_md({
                        bucket: req.bucket,
                        key: file_key_name
                    });
                }).then(null, function(err) {
                    dbg.log0('Got Error:', err.rpc_code, err);
                    if (err.rpc_code === 'NOT_FOUND') {
                        //ignore.
                        dbg.log0('ignore not found');
                        return null;
                    } else {
                        dbg.error('Failure while trying to find previous versions "%s"', file_key_name, err);
                        var template = templateBuilder.buildKeyNotFound(file_key_name);
                        return buildXmlResponse(res, 500, template);

                    }
                }).then(function(list_results) {
                    //object exists. Delete and write.
                    if (list_results) {

                        //the current implementation of list_objects returns list of objects with key
                        // that starts with the provided name. we will validate it.
                        return clients[access_key].client.object.delete_object({
                            bucket: req.bucket,
                            key: file_key_name
                        }).then(function() {
                            dbg.log0('Deleted old version of object "%s" in bucket "%s"', file_key_name, req.bucket);
                            uploadObject(req, res, file_key_name);
                        }).then(null, function(err) {
                            dbg.error('Failure while trying to delete old version of object "%s"', file_key_name, err);
                            var template = templateBuilder.buildKeyNotFound(file_key_name);
                            return buildXmlResponse(res, 500, template);

                        });

                    } else {
                        dbg.log0('body:', parseInt(req.headers['content-length']));
                        uploadObject(req, res, file_key_name);
                    }

                });
            }
        },

        postMultipartObject: function(req, res) {
            var aggregated_md5 = '';
            P.fcall(function() {
                var template;
                var access_key = extract_access_key(req);
                //init multipart upload
                if (req.query.uploads === '') {
                    dbg.log0('Init Multipart', req.originalUrl);

                    var key = (req.originalUrl).replace('/' + req.bucket + '/', '');
                    //TODO:Replace with s3 rest param, initiated from the constructor
                    //key = key.replace('/s3', '');
                    key = key.substring(0, key.indexOf('?uploads'));
                    key = decodeURIComponent(key);
                    dbg.log0('Init Multipart key', key);
                    //Always try to delete existing object
                    return delete_if_exists({
                        'key': key,
                        'bucket': req.bucket
                    }, access_key).then(function() {

                        var create_params = {
                            bucket: req.bucket,
                            key: key,
                            size: 0,
                            content_type: req.headers['content-type']
                        };
                        set_xattr(req, create_params);

                        dbg.log0('Init Multipart, buckets', clients[access_key].buckets, '::::',
                            _.filter(clients[access_key].buckets, {
                                bucket: req.bucket
                        }));
                        if (!_.has(clients[access_key].buckets, req.bucket)) {

                            clients[access_key].buckets[req.bucket] = {
                                upload_ids: []
                            };
                            dbg.log0('Init Multipart, buckets (pushed)', clients[access_key].buckets);

                        }
                        try {
                            clients[access_key].buckets[req.bucket].upload_ids[key] = {
                                start: time_utils.millistamp()
                            };

                            dbg.log3('Init Multipart 2', clients[access_key].buckets[req.bucket]);

                        } catch (err) {
                            dbg.error('init error:', err);
                        }
                        dbg.log3('Init Multipart - create_multipart_upload ', create_params, 'key:', req.params.key, ' encoded:', encodeURIComponent(string_utils.encodeXML(req.params.key)), 'prev', string_utils.encodeXML(req.params.key));
                        //TODO: better override. from some reason, sometimes movies are octet.
                        if (create_params.content_type === 'application/octet-stream') {
                            create_params.content_type = mime.lookup(key) || create_params.content_type;
                            dbg.log0('Init Multipart - create_multipart_upload - override mime ', create_params);
                        }
                        return clients[access_key].client.object.create_multipart_upload(create_params)
                            .then(function(info) {
                                template = templateBuilder.buildInitiateMultipartUploadResult(string_utils.encodeXML(req.params.key), req.bucket);
                                dbg.log0('upload fine', template);
                                return buildXmlResponse(res, 200, template);
                            }).then(null, function(err) {
                                template = templateBuilder.buildKeyNotFound(req.query.uploadId);
                                dbg.error('Error init multipart', template);
                                return buildXmlResponse(res, 500, template);
                            });
                    });

                }
                //CompleteMultipartUpload
                else if (!_.isUndefined(req.query.uploadId)) {
                    dbg.log3('request to complete ', req.query.uploadId);

                    if (store_locally) {
                        dbg.log3('Complete multipart', template);
                        return buildXmlResponse(res, 200, template);
                    }

                    return clients[access_key].client.object.complete_multipart_upload({
                        bucket: req.bucket,
                        key: decodeURIComponent(req.query.uploadId),
                        fix_parts_size: true,
                        etag: aggregated_md5
                    }).then(function(reply) {
                        dbg.log3('done complete', reply.etag, 'https://' + req.hostname + '/' + req.bucket + '/' + req.query.uploadId);
                        delete objects_avarage_part_size[req.query.uploadId];
                        var completeMultipartInformation = {
                            Bucket: req.bucket,
                            Key: (req.query.uploadId),
                            Location: 'https://' + req.hostname + '/' + req.bucket + '/' + encodeURI(req.query.uploadId),
                            ETag: reply.etag
                        };

                        template = templateBuilder.completeMultipleUpload(completeMultipartInformation);
                        dbg.log0('Complete multipart', template);

                        return buildXmlResponse(res, 200, template);
                    }).then(null, function(err) {
                        dbg.error('Err Complete multipart', err, err.stack);
                        template = templateBuilder.buildKeyNotFound(req.query.uploadId);
                        return buildXmlResponse(res, 500, template);

                    });
                }
            });
        },
        deleteObject: function(req, res) {
            //this is also valid for the Abort Multipart Upload
            var key = req.params.key;
            //Support _$folder$ used by s3 clients (supported by AWS). Replace with current prefix /
            key = key.replace(/_\$folder\$/, '/');

            dbg.log3('Attempt to delete object "%s" in bucket "%s"', key, req.bucket);
            var access_key = extract_access_key(req);
            var template;
            P.fcall(function() {
                return clients[access_key].client.object.delete_object({
                    bucket: req.bucket,
                    key: key
                });
            }).then(function() {
                dbg.log0('Deleted object "%s" in bucket "%s"', key, req.bucket);
                return res.status(204).end();
            }).
            then(null, function(err) {
                template = templateBuilder.buildKeyNotFound(key);

                if (err.rpc_code === 'NOT_FOUND') {
                    dbg.log0('Could not delete object "%s"', key);
                    return buildXmlResponse(res, 404, template);

                } else {
                    dbg.error('Failure while trying to delete object "%s"', key, err, err.stack);
                    return buildXmlResponse(res, 500, template);
                }

            });
        },
        deleteObjects: function(req, res) {
            var template = '';
            var access_key = extract_access_key(req);
            var errors = [];
            var deleted = [];
            return P.ninvoke(xml2js, 'parseString', req.body)
                .then(function(data) {
                    var objects_to_delete = data.Delete.Object;
                    dbg.log3('Delete objects "%s" in bucket "%s"', JSON.stringify(objects_to_delete), req.bucket);
                    return P.all(_.map(objects_to_delete, function(object_to_delete) {
                        dbg.log2('About to delete ', object_to_delete.Key[0]);
                        return clients[access_key].client.object.delete_object({
                            bucket: req.bucket,
                            key: object_to_delete.Key[0]
                        }).then(function() {
                            dbg.log2('deleted', object_to_delete.Key[0]);
                            deleted.push({
                                'Key': object_to_delete.Key[0]
                            });
                        }).then(null, function(err) {
                            dbg.log2('cannot delete:', object_to_delete.Key[0], err.message);
                            errors.push({
                                'Key': object_to_delete.Key[0],
                                'Code': 'InternalError', //only options are AccessDenied, InternalError
                                'Message': err.message
                            });
                        });
                    }));
                }).
            then(function() {
                template = templateBuilder.buildDeleteResult(deleted, errors);
                return buildXmlResponse(res, 200, template);
            }).

            then(null, function(err) {
                dbg.error('Failure while trying to delete objects', err, err.stack);
                var template = templateBuilder.buildError('InternalError',
                    'We encountered an internal error. Please try again.');
                return buildXmlResponse(res, 500, template);
            });
        }
    };
};
