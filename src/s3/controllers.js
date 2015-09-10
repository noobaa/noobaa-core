'use strict';
require('../util/panic');

var _ = require('lodash');
var P = require('../util/promise');
var util = require('util');
var md5_stream = require('../util/md5_stream');
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
    var getBucketLocally = function(req, res) {
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
                    dbg.log0('Serving Page: %s', object.key);
                    return buildResponse(req, res, 200, object, data);
                }
            });
        } else {
            dbg.log0('Fetched bucket "%s" with options %s', req.bucket, options);
            fileStore.getObjects(req.bucket, options, function(err, results) {
                dbg.log0('Found %d objects for bucket "%s"', results.length, req.bucket);

                var template = templateBuilder.buildBucketQuery(options, results);
                return buildXmlResponse(res, 200, template);
            });
        }
    };
    var putObjectLocally = function(req, res, file_key_name) {
        req.params.key = file_key_name;
        P.ninvoke(fileStore, "putObject", req.params.bucket, req)
            .then(function(key) {
                dbg.log0('Stored object "%s" in bucket "%s" successfully', req.params.key, req.params.bucket);
                res.header('ETag', key.md5);
                return res.status(200).end();
            }).then(null, function(err) {
                dbg.error('Error uploading object "%s" to bucket "%s"',
                    file_key_name, req.params.bucket, err, err.stack);
                var template = templateBuilder.buildError('InternalError',
                    'We encountered an internal error. Please try again.');
                return buildXmlResponse(res, 500, template);

            });
    };
    var getObjectLocally = function(req, res) {
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

    };
    var buildResponse = function(req, res, status, object, data) {
        res.header('Etag', object.md5);
        res.header('Last-Modified', new Date(object.modifiedDate).toUTCString());
        res.header('Content-Type', object.contentType);

        if (object.contentEncoding)
            res.header('Content-Encoding', object.contentEncoding);

        res.header('Content-Length', object.size);
        if (object.customMetaData.length > 0) {
            object.customMetaData.forEach(function(metaData) {
                res.header(metaData.key, metaData.value);
            });
        }
        res.status(status);
        if (req.method === 'HEAD') {
            return res.end();
        }
        return res.end(data);
    };
    var errorResponse = function(req, res, keyName) {
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
    };
    var notFoundResponse = function(req, res) {
        var ErrorDoc = '<!DOCTYPE html>\n<html><head><title>404 - Resource Not Found</title></head><body><h1>404 - Resource Not Found</h1></body></html>';

        return buildResponse(req, res, 404, {
            modifiedDate: new Date(),
            contentType: 'text/html',
            customMetaData: [],
            size: ErrorDoc.length
        }, ErrorDoc);
    };
    var extract_access_key = function(req) {
        var req_access_key;
        if (req.headers.authorization) {
            var end_of_aws_key = req.headers.authorization.indexOf(':');
            req_access_key = req.headers.authorization.substring(4, end_of_aws_key);
        } else {
            if (req.query.AWSAccessKeyId) {
                req_access_key = req.query.AWSAccessKeyId;
            }
        }
        return req_access_key;
    };

    var extract_s3_info = function(req) {

        if (_.isUndefined(clients[req.access_key].client.options)) {
            dbg.error('extract_s3_info problem');
        }
        if (clients[req.access_key].client.options.auth_token.indexOf('auth_token') > 0) {
            //update signature and string_to_sign
            //TODO: optimize this part. two converstions per request is a bit too much.

            var auth_token_obj = JSON.parse(clients[req.access_key].client.options.auth_token);
            auth_token_obj.signature = req.signature;
            auth_token_obj.string_to_sign = req.string_to_sign;
            auth_token_obj.access_key = req.access_key;
            return auth_token_obj;

        } else {
            //TODO:
            //Quick patch.
            //Need to find a better way to use client objects in parallel and pass the request information
            var new_params = {
                'auth_token': clients[req.access_key].client.options.auth_token,
                'signature': req.signature,
                'string_to_sign': req.string_to_sign,
                'access_key': req.access_key
            };

            return new_params;
        }
    };


    var uploadPart = function(req, res) {

        if (store_locally) {
            return putObjectLocally(req, res, req.query.uploadId + '___' + req.query.partNumber);
        }
        var md5_calc = new md5_stream();
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
                    dbg.log0('uploadObject: MD5 data (end)', part_md5, 'part:', upload_part_number);
                    return part_md5;
                });

                var content_length = req.headers['content-length'];
                // tranform stream that calculates md5 on-the-fly
                var upload_part_info = {
                    bucket: bucket_name,
                    key: (req.query.uploadId),
                    size: content_length,
                    content_type: req.headers['content-type'] || mime.lookup(req.query.uploadId),
                    source_stream: calculate_md5 ? md5_calc : req,
                    upload_part_number: upload_part_number

                };
                dbg.log0('Uploading part number', req.query.partNumber, ' of uploadID ',
                    req.query.uploadId, ' VS ', req.query.uploadId, 'content length:', req.headers['content-length']);
                dbg.log0('upload info', _.pick(upload_part_info, 'bucket', 'key', 'size',
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
                    key: req.query.uploadId,
                    upload_part_number: upload_part_number,
                    etag: part_md5
                });

            }).then(function() {
                try {

                    dbg.log0('COMPLETED: upload', req.query.uploadId, ' part:', req.query.partNumber, 'md5:', part_md5);

                    res.header('ETag', req.query.uploadId + req.query.partNumber);
                } catch (err) {
                    dbg.log0('FAILED', err, res);

                }
                return res.status(200).end();

            }).then(null, function(err) {
                dbg.error('ERROR: upload:' + req.query.uploadId + ' err:' + util.inspect(err.stack));
                return res.status(500).end();
            });
    };

    var listPartsResult = function(req, res) {
        P.fcall(function() {
            var template;
            var upload_id = req.query.uploadId;
            var max_parts = req.query['max-parts'] || 1000;
            var access_key = extract_access_key(req);
            var part_number_marker = req.query['part-number​-marker'] || '';
            dbg.log0('List part results for upload id:', upload_id, 'max parts', max_parts, 'part marker', part_number_marker);
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
    };

    var buildXmlResponse = function(res, status, template) {
        //dbg.log("build",res);
        res.header('Content-Type', 'application/xml');
        res.status(status);
        dbg.log2('template:', template);
        return res.send(template);
    };

    var delete_if_exists = function(target_object, access_key) {
        dbg.log0('listing ', target_object.key, ' in bucket:', target_object.bucket);
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


    };

    var copy_object = function(from_object, to_object, src_bucket, target_bucket, access_key) {
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
                        if (source_object_md.size === 0) {
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
                        var new_obj_parts;
                        return clients[access_key].client.object.read_object_mappings({
                                bucket: src_bucket,
                                key: from_object,
                            })
                            .then(function(mappings) {
                                dbg.log0('\n\nListing object maps:', from_object);
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
                                            crypt: part.crypt,
                                            chunk_size: part.chunk_size
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
                                dbg.log0('COMPLETED: copy');

                                return true;
                            });
                    });

            }).then(null, function(err) {
                dbg.error("Failed to upload", err);
                return false;
            });

    };
    var list_objects_with_prefix = function(prefix, delimiter, bucket_name, access_key) {
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
        dbg.log0('Listing objects with', list_params, delimiter, 'key:', access_key);
        return clients[access_key].client.object.list_objects(list_params)
            .then(function(results) {
                var folders = {};
                dbg.log3('results:', results);
                var objects = _.filter(results.objects, function(obj) {
                    try {
                        var date = new Date(obj.info.create_time);
                        date.setMilliseconds(0);
                        obj.modifiedDate = date.toISOString(); //toUTCString();//.toISOString();
                        obj.md5 = 100;
                        obj.size = obj.info.size;

                        //we will keep the full path for CloudBerry online cloud backup tool
                        var obj_sliced_key = obj.key.slice(prefix.length);
                        dbg.log0('obj.key:', obj.key, ' prefix ', prefix, ' sliced', obj_sliced_key);
                        if (obj_sliced_key.indexOf(delimiter) >= 0) {
                            var folder = obj_sliced_key.split(delimiter, 1)[0];
                            folders[prefix + folder + "/"] = true;
                            return false;
                        }

                        if (list_params.key === obj.key) {
                            dbg.log0('LISTED KEY same as REQUIRED', obj.key);
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
    };

    var uploadObject = function(req, res, file_key_name) {

        var md5 = '0';
        P.fcall(function() {
                if (store_locally) {
                    putObjectLocally(req, res, file_key_name);
                } else {
                    var access_key = extract_access_key(req);
                    dbg.log0('uploadObject: upload', file_key_name);

                    // tranform stream that calculates md5 on-the-fly
                    var md5_calc = new md5_stream();
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

                    var create_params = _.pick(upload_params, 'bucket', 'key', 'size', 'content_type');
                    var bucket_key_params = _.pick(upload_params, 'bucket', 'key');

                    dbg.log0('upload_stream: start upload', upload_params.key,upload_params.size);
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
                            dbg.log0('upload_stream: error write stream', upload_params.key, err);
                            throw err;
                        });

                }

            })
            .then(function() {
                dbg.log0('COMPLETED: uploadObject', file_key_name, md5);
                res.header('ETag', md5);
                return res.status(200).end();
            })
            .then(null, function(err) {
                dbg.error('ERROR: uploadObject:' + file_key_name + ' err:' + util.inspect(err.stack));
                return res.status(500).end();
            });
    };


    var isBucketExists = function(bucketName, s3_info) {
        dbg.log0('isBucketExists', bucketName, ' info:', s3_info, 'key:', s3_info.access_key, 'auth', clients[s3_info.access_key].client.options.auth_token);

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
    };

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
                dbg.log0('check if system exists for key:', access_key, _.has(clients, access_key));
                return _.has(clients, access_key);
            });
        },
        add_new_system_client: function(req) {
            dbg.log0('add_new_system_client', req.access_key);
            return P.fcall(function() {
                if (_.isEmpty(req.access_key)) {
                    dbg.log0('Exiting as there is no credential information.');
                    throw new Error("No credentials");

                } else {
                    dbg.log0('Adding new system client.', req.access_key);
                    clients[req.access_key] = {
                        client: new api.Client(),
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
            var bucket_exists = false;
            if (_.isEmpty(buckets_cache)) {
                dbg.log0('buckets cache empty');
                isBucketExists(bucketName, extract_s3_info(req))
                    .then(function(exists) {
                        bucket_exists = exists;
                    });
            } else {
                dbg.log0('has buckets cache ');
                bucket_exists = (_.findIndex(buckets_cache, {
                    'name': bucketName
                }) < 0);
            }
            if (bucket_exists) {
                dbg.error('(1) No bucket found for "%s"', bucketName);
                var template = templateBuilder.buildBucketNotFound(bucketName);
                return buildXmlResponse(res, 404, template);

            } else {
                dbg.log0('got bucket name ' + bucketName);
                req.bucket = bucketName;
                return next();
            }
        },

        getBuckets: function(req, res) {
            dbg.log0('getBuckets', req.params.bucket);
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
            dbg.log0('get bucket (list objects) with options:', options, req.bucket, req.params);
            var template;

            if (req.query.location !== undefined) {
                template = templateBuilder.buildLocation();
                return buildXmlResponse(res, 200, template);

            } else {

                list_objects_with_prefix(options.prefix, options.delimiter, req.bucket, extract_access_key(req))
                    .then(function(objects_and_folders) {
                        options.bucketName = req.bucket || params.bucket;
                        options.common_prefixes = _.isEmpty(objects_and_folders.folders) ? '' : _.keys(objects_and_folders.folders);
                        dbg.log0('total of objects:', objects_and_folders.objects.length, ' folders:', options.common_prefixes, 'bucket:', options.bucketName);

                        if (req.query.versioning !== undefined) {
                            if (!_.isEmpty(options.common_prefixes)) {
                                var date = new Date();
                                date.setMilliseconds(0);
                                date = date.toISOString();
                                _.each(options.common_prefixes, function(folder) {
                                    dbg.log0('adding common_prefixe (folder):', folder);
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
                        dbg.log0('COMPLETED: list');
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
            dbg.log0('put bucket');
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
                dbg.log0('check if bucket exists');
                return isBucketExists(bucketName, s3_info)
                    .then(function(exists) {
                        if (exists) {
                            dbg.error('Error creating bucket. Bucket "%s" already exists', bucketName);
                            var template = templateBuilder.buildError('BucketAlreadyExists',
                                'The requested bucket already exists');
                            return buildXmlResponse(res, 409, template);
                        } else {
                            dbg.log0('Creating new bucket', bucketName);
                            clients[access_key].client.bucket.create_bucket({
                                    name: bucketName,
                                    tiering: ['nodes']
                                })
                                .then(function() {
                                    dbg.log0('Created new bucket "%s" successfully', bucketName);
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
            var template = templateBuilder.buildBucketNotEmpty(req.bucket.name);
            return buildXmlResponse(res, 409, template);
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
                    dbg.log0('getObject', object_path, req.method);
                    return clients[access_key].client.object_driver_lazy().get_object_md(object_path)
                        .then(function(object_md) {
                            dbg.log0('object_md:', object_md);
                            var create_date = new Date(object_md.create_time);
                            create_date.setMilliseconds(0);

                            //res.header('Last-Modified', null);
                            res.header('Content-Type', object_md.content_type);
                            res.header('Content-Length', object_md.size);
                            res.header('x-amz-meta-cb-modifiedtime', req.headers['x-amz-date'] || create_date);
                            res.header('x-amz-restore', 'ongoing-request="false"');
                            res.header('ETag', object_md.etag);
                            res.header('x-amz-id-2', 'FSVaTMjrmBp3Izs1NnwBZeu7M19iI8UbxMbi0A8AirHANJBo+hEftBuiESACOMJp');
                            res.header('x-amz-request-id', 'E5CEFCB143EB505A');

                            if (req.method === 'HEAD') {
                                dbg.log0('Head ', res._headers);

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
                            dbg.log0('ERROR:', err);
                            if (object_path.key.indexOf('..chunk..map') > 0) {
                                dbg.log0('Identified cloudberry format, return error 404');
                                object_path.key = object_path.key.replace('..chunk..map', '');
                                var template = templateBuilder.buildKeyNotFound(keyName);
                                return buildXmlResponse(res, 404, template);
                            } else {
                                dbg.error('Cannot find file. will retry as folder', err);
                                //retry as folder name
                                object_path.key = object_path.key + '/';
                            }

                            return clients[access_key].client.object_driver_lazy().get_object_md(object_path)
                                .then(function(object_md) {
                                    dbg.log3('obj_md2', object_md);
                                    var create_date = new Date(object_md.create_time);
                                    create_date.setMilliseconds(0);

                                    res.header('Last-Modified', create_date);
                                    res.header('Content-Type', object_md.content_type);
                                    res.header('Content-Length', object_md.size);
                                    res.header('x-amz-meta-cb-modifiedtime', req.headers['x-amz-date']);
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
                dbg.log0('Fake ACL (200)');
                return buildXmlResponse(res, 200, template);
            }
            var copy = req.headers['x-amz-copy-source'];

            if (!_.isUndefined(req.query.partNumber)) {
                if (copy) {
                    template = templateBuilder.buildError('Upload Part - Copy',
                        'Copy of part is not supported');
                    dbg.log0('Copy of part is not supported');
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
                            template = templateBuilder.buildCopyObject(req.params.key);
                            return buildXmlResponse(res, 200, template);
                        } else {
                            return copy_object(srcObject, req.params.key, srcBucket,
                                    req.bucket, access_key)
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

                        dbg.log0('Init Multipart, buckets', clients[access_key].buckets, '::::', _.where(clients[access_key].buckets, {
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

                            dbg.log0('Init Multipart 2', clients[access_key].buckets[req.bucket]);

                        } catch (err) {
                            dbg.error('init error:', err);
                        }
                        dbg.log0('Init Multipart - create_multipart_upload ', create_params);
                        //TODO: better override. from some reason, sometimes movies are octet.
                        if (create_params.content_type === 'application/octet-stream') {
                            create_params.content_type = mime.lookup(key) || create_params.content_type;
                            dbg.log0('Init Multipart - create_multipart_upload - override mime ', create_params);
                        }
                        return clients[access_key].client.object.create_multipart_upload(create_params)
                            .then(function(info) {
                                template = templateBuilder.buildInitiateMultipartUploadResult(string_utils.encodeXML(req.params.key), req.bucket);
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
                    dbg.log0('request to complete ', req.query.uploadId);

                    if (store_locally) {
                        dbg.log0('Complete multipart', template);
                        return buildXmlResponse(res, 200, template);
                    }

                    return clients[access_key].client.object.complete_multipart_upload({
                        bucket: req.bucket,
                        key: (req.query.uploadId),
                        fix_parts_size: true,
                        etag: aggregated_md5
                    }).then(function(calculated_etag) {
                        dbg.log0('done complete', calculated_etag, 'https://' + req.hostname + '/' + req.bucket + '/' + req.query.uploadId);
                        delete objects_avarage_part_size[req.query.uploadId];
                        var completeMultipartInformation = {
                            Bucket: req.bucket,
                            Key: (req.query.uploadId),
                            Location: 'https://' + req.hostname + '/' + req.bucket + '/' + encodeURI(req.query.uploadId),
                            ETag: calculated_etag
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
            dbg.log0('Attempt to delete object "%s" in bucket "%s"', key, req.bucket);
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
                    dbg.log0('Delete objects "%s" in bucket "%s"', JSON.stringify(objects_to_delete), req.bucket);
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
