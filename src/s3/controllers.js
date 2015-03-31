'use strict';
var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var util = require('util');
var md5 = require('MD5');
var crypto = require('crypto');
var md5_stream = require('../util/md5_stream');
var path = require('path');
var SliceReader = require('../util/slice_reader');
var mime = require('mime');
var concat_stream = require('concat-stream');
var api = require('../api');
var dbg = require('noobaa-util/debug_module')(__filename);
var S3Object = require('./models/s3-object');


process.on('uncaughtException', function(err) {
    dbg.log0('process uncaughtException: ' + err);
});


module.exports = function(params) {
    var templateBuilder = require('./xml-template-builder');
    var objects_avarage_part_size = {};
    var client;
    params.bucket = 'files';
    Q.fcall(function() {
        var auth_params = _.pick(params,
            'email', 'password', 'system', 'role');
        if (_.isEmpty(auth_params)) {
            if (_.isEmpty(params.s3_access_key)) {
                dbg.log0('Exiting as there is no credential information.');

                throw new Error("No credentials");

            } else {
                dbg.log0('Using noobaa access key.');
                var access_res = {
                    res: "Access Param",
                    token: params.s3_access_key
                };
                client = new api.Client({
                    address: params.address,
                    auth_token: params.s3_access_key,
                    bucket: params.bucket
                });
                return access_res;
            }
        } else {
            client = new api.Client({
                address: params.address
            });
            if (params.bucket) {
                auth_params.extra = {
                    bucket: params.bucket
                };
            }
            dbg.log1('create auth', auth_params);
            var token = client.create_auth_token(auth_params);
            return token;
        }
    }).then(function(token) {
        dbg.log0('token:', token);

    });

    var uploadPart = function(req, res) {
        Q.fcall(function() {
            var template;
            var mydata = '';
            var content_length = req.headers['content-length'];

            var upload_part_info = {
                bucket: params.bucket,
                key: encodeURIComponent(req.query.uploadId),
                size: content_length,
                content_type: req.headers['content-type'] || mime.lookup(req.query.uploadId),
                source_stream: req,
                upload_part_number: parseInt(req.query.partNumber)
            };
            dbg.log0('Uploading part number', req.query.partNumber, ' of uploadID ',
                req.query.uploadId, 'content length:', req.headers['content-length']);
            dbg.log0('upload info', _.pick(upload_part_info, 'bucket', 'key', 'size',
                'content_type', 'upload_part_number'));

            return client.object_client.upload_stream_parts(upload_part_info)
                .then(function() {
                    try {
                        dbg.log0('COMPLETED: upload', req.query.uploadId);
                        res.header('ETag', req.query.uploadId + req.query.partNumber);
                    } catch (err) {
                        dbg.log0('FAILED', err, res);

                    }
                    return res.status(200).end();
                }, function(err) {
                    dbg.log0('ERROR: upload:' + req.query.uploadId + ' err:' + util.inspect(err.stack));
                    return res.status(500).end();
                });

        });
    };
    var listPartsResult = function(req, res) {
        Q.fcall(function() {
            var template;
            var upload_id = req.query.uploadId;
            var max_parts = req.query['max-parts'] || 1000;

            var part_number_marker = req.query['part-number​-marker'] || '';
            dbg.log0('List part results for upload id:', upload_id, 'max parts', max_parts, 'part marker', part_number_marker);
            var list_options = {
                bucket: params.bucket,
                key: req.query.uploadId,
                part_number_marker: 1,
                max_parts: 1000
            };
            return client.object.list_multipart_parts(list_options)
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
        //dbg.log0('template:',template,'headers',res);
        return res.send(template);
    };

    var copy_object = function(from_object, to_object) {
        from_object = decodeURIComponent(from_object);
        var object_path = {
            bucket: params.bucket,
            key: from_object
        };
        var create_params = {};
        return client.object_client.get_object_md(object_path)
            .then(function(md) {
                //check if folder
                if (md.size === 0) {
                    dbg.log0('Folder copy:', from_object, ' to ', to_object);
                    list_objects_with_prefix(from_object, '/')
                        .then(function(objects_and_folders) {
                            return Q.all(_.times(objects_and_folders.objects.length, function(i) {
                                dbg.log0('copy inner objects:', objects_and_folders.objects[i].key, objects_and_folders.objects[i].key.replace(from_object, to_object));
                                copy_object(objects_and_folders.objects[i].key, objects_and_folders.objects[i].key.replace(from_object, to_object));
                            })).then(function() {
                                //                                dbg.log0('folders......',_.keys(objects_and_folders.folders));
                                return Q.all(_.each(_.keys(objects_and_folders.folders), function(folder) {
                                    dbg.log0('copy inner folders:', folder, folder.replace(from_object, to_object));
                                    copy_object(folder, folder.replace(from_object, to_object));
                                }));
                            });
                        });
                }
                create_params.content_type = md.content_type;
                create_params.size = md.size;
                return client.object.read_object_mappings({
                        bucket: params.bucket,
                        key: from_object,
                    })
                    .then(function(mappings) {
                        dbg.log0('\n\nListing object maps:', from_object);
                        var i = 1;
                        _.each(mappings.parts, function(part) {
                            dbg.log0('#' + i, '[' + part.start + '..' + part.end + ']:\t', part);
                            i += 1;
                        });
                        //copy
                        var new_obj_parts = {
                            bucket: params.bucket,
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
                        create_params.bucket = params.bucket;
                        create_params.key = to_object;

                        return client.object.create_multipart_upload(create_params)
                            .then(function(info) {
                                return client.object.allocate_object_parts(new_obj_parts)
                                    .then(function(res) {
                                        dbg.log0('complete multipart copy ', create_params);
                                        var bucket_key_params = _.pick(create_params, 'bucket', 'key');
                                        return client.object.complete_multipart_upload(bucket_key_params);
                                    })
                                    .then(function(res) {
                                        dbg.log0('COMPLETED: copy');

                                        return true;
                                    });
                            });
                    });
            }).then(null, function(err) {
                dbg.error("Failed to upload", err);
                return false;
            });

    };
    var list_objects_with_prefix = function(prefix, delimiter) {
        var list_params = {
            bucket: params.bucket,
        };
        if (prefix) {
            //prefix = prefix.replace(/%2F/g, '/');
            prefix = decodeURI(prefix);
            list_params.key = prefix;
        }
        if (delimiter) {
            delimiter = decodeURI(delimiter);
        }
        dbg.log0('Listing objects with', list_params, delimiter);
        return client.object.list_objects(list_params)
            .then(function(results) {
                var i = 0;
                var folders = {};
                var objects = _.filter(results.objects, function(obj) {
                    try {
                        var date = new Date(obj.info.create_time);
                        date.setMilliseconds(0);
                        obj.modifiedDate = date.toISOString(); //toUTCString();//.toISOString();
                        obj.md5 = 100;
                        obj.size = obj.info.size;

                        //we will keep the full path for CloudBerry online cloud backup tool

                        var obj_sliced_key = obj.key.slice(prefix.length);
                        dbg.log3('obj.key:', obj.key, ' prefix ', prefix);
                        if (obj_sliced_key.indexOf(delimiter) >= 0) {
                            var folder = obj_sliced_key.split(delimiter, 1)[0];
                            folders[prefix + folder + "/"] = true;
                            return false;
                        }
                        if (list_params.key === obj.key) {
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
        try {
            var md5 = 0;
            //
            // tranform stream that calculates md5 on-the-fly
            var md5_calc = new md5_stream();
            req.pipe(md5_calc);

            md5_calc.on('finish', function() {
                md5 = md5_calc.toString();
                dbg.log3('MD5 data (end)', md5);
            });

            return client.object_client.upload_stream({
                bucket: params.bucket,
                key: file_key_name,
                size: parseInt(req.headers['content-length']),
                content_type: req.headers['content-type'] || mime.lookup(file_key_name),
                source_stream: md5_calc,
            }).then(function() {
                try {
                    dbg.log0('COMPLETED: upload', file_key_name, md5);
                    res.header('ETag', md5);
                } catch (err) {
                    dbg.error('Failed to upload stream', err, res);

                }
                return res.status(200).end();
            }, function(err) {
                dbg.error('ERROR: upload:' + file_key_name + ' err:' + util.inspect(err.stack));
                return res.status(500).end();
            });
        } catch (err) {
            dbg.error('Failed upload stream to noobaa:', err);
        }
    };


    /**
     * The following methods correspond the S3 api. For more information visit:
     * http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html
     */
    return {
        /**
         * Middleware to check if a bucket exists
         */
        bucketExists: function(req, res, next) {
            var bucketName = req.params.bucket;
            if (bucketName !== params.bucket) {
                dbg.log0('(1) No bucket found for "%s"', bucketName);
                var template = templateBuilder.buildBucketNotFound(bucketName);
                return buildXmlResponse(res, 404, template);
            }
            req.bucket = bucketName;
            return next();

        },
        getBuckets: function(req, res) {
            var date = new Date();
            date.setMilliseconds(0);
            date = date.toISOString();
            var buckets = [{
                name: params.bucket,
                creationDate: date
            }];
            dbg.log3('Fetched %d buckets', buckets.length, ' b: ', params.bucket);
            var template = templateBuilder.buildBuckets(buckets);
            dbg.log2('bucket response:', template);
            return buildXmlResponse(res, 200, template);
        },
        getBucket: function(req, res) {
            var options = {
                marker: req.query.marker || null,
                prefix: req.query.prefix || '',
                maxKeys: parseInt(req.query['max-keys']) || 1000,
                delimiter: req.query.delimiter // removed default value - shouldn't be such || '/'
            };
            dbg.log0('get bucket (list objects) with options:', options);
            var template;

            if (req.query.location !== undefined) {
                template = templateBuilder.buildLocation();
                return buildXmlResponse(res, 200, template);

            } else {

                list_objects_with_prefix(options.prefix, options.delimiter)
                    .then(function(objects_and_folders) {
                        options.bucketName = req.bucket.name || params.bucket;
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
                    });
            }

        },
        putBucket: function(req, res) {
            var bucketName = req.params.bucket;
            var template;
            template = templateBuilder.buildError('InvalidBucketName',
                'Creating new bucket is not supported');
            dbg.log0('Error creating bucket "%s" because it is not supported', bucketName);
            return buildXmlResponse(res, 400, template);

            /**
             * Derived from http://docs.aws.amazon.com/AmazonS3/latest/dev/BucketRestrictions.html
             */

        },
        deleteBucket: function(req, res) {
            var template = templateBuilder.buildBucketNotEmpty(req.bucket.name);
            return buildXmlResponse(res, 409, template);
        },



        getObject: function(req, res) {
            //if ListMultipartUploads
            if (!_.isUndefined(req.query.uploadId)) {
                return listPartsResult(req, res);
            }
            var keyName = req.params.key;
            var acl = req.query.acl;
            var template;
            if (acl !== undefined) {
                template = templateBuilder.buildAcl();
                return buildXmlResponse(res, 200, template);
            } else {
                if (req.query.location !== undefined) {
                    template = templateBuilder.buildLocation();
                    return buildXmlResponse(res, 200, template);
                } else {
                    if (req.path.indexOf('Thumbs.db', req.path.length - 9) !== -1) {
                        dbg.log2('Thumbs up "%s" in bucket "%s" does not exist', keyName, params.bucket);
                        template = templateBuilder.buildKeyNotFound(keyName);
                        return buildXmlResponse(res, 404, template);
                    }
                    //S3 browser format - maybe future use.
                    // keyName = keyName.replace('..chunk..map','');
                    var object_path = {
                        bucket: params.bucket,
                        key: keyName
                    };
                    return client.object_client.get_object_md(object_path)
                        .then(function(object_md) {
                            var create_date = new Date(object_md.create_time);
                            create_date.setMilliseconds(0);

                            res.header('Last-Modified', create_date);
                            res.header('Content-Type', object_md.content_type);
                            res.header('Content-Length', object_md.size);
                            res.header('x-amz-meta-cb-modifiedtime', req.headers['x-amz-date']);
                            if (req.method === 'HEAD') {
                                return res.end();
                            } else {
                                var stream = client.object_client.open_read_stream(object_path).pipe(res);
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
                                dbg.error('Cannot find file. will retry as folder', err);
                                //retry as folder name
                                object_path.key = object_path.key + '/';
                            }

                            return client.object_client.get_object_md(object_path)
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
                                        var stream = client.object_client.open_read_stream(object_path).pipe(res);
                                    }
                                }).then(null, function(err) {
                                    dbg.error('ERROR: while download from noobaa', err);
                                    var template = templateBuilder.buildKeyNotFound(keyName);
                                    dbg.error('Object "%s" in bucket "%s" does not exist', keyName, req.bucket.name);
                                    return buildXmlResponse(res, 404, template);
                                });
                        });
                }
            }
        },
        putObject: function(req, res) {
            var template;
            var acl = req.query.acl;
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
                if (srcBucket !== params.bucket) {
                    dbg.error('No bucket found (2) for "%s"', srcBucket, params.bucket, delimiter, copy.indexOf(delimiter), copy.indexOf('/'), srcObjectParams, srcObject);
                    template = templateBuilder.buildBucketNotFound(srcBucket);
                    return buildXmlResponse(res, 404, template);
                }
                copy_object(srcObject, req.params.key)
                    .then(function(is_copied) {
                        if (is_copied) {
                            template = templateBuilder.buildCopyObject(req.params.key);
                            return buildXmlResponse(res, 200, template);
                        } else {
                            template = templateBuilder.buildKeyNotFound(srcObject);
                            return buildXmlResponse(res, 404, template);
                        }
                    });
            } else {

                //dbg.log0('About to store object "%s" in bucket "%s" ', req.params.key, req.bucket.name, req.headers);

                var file_key_name = req.params.key;

                // generate unique name - disable for now
                //
                // var ext_match = file_key_name.match(/^(.*)(\.[^\.]*)$/);
                //
                // var serial = (((Date.now() / 1000) % 10000000) | 0).toString();
                // if (ext_match) {
                //     file_key_name = ext_match[1] + '_' + serial + ext_match[2];
                // } else {
                //     file_key_name = file_key_name + '_' + serial;
                // }

                Q.fcall(function() {

                    return client.object.list_objects({
                        bucket: params.bucket,
                        key: file_key_name
                    });
                }).then(function(list_results) {
                    //object exists. Delete and write.
                    if (list_results.objects.length > 0) {
                        var obj_index = _.findIndex(list_results.objects, function(chr) {
                            return chr.key === file_key_name;
                        });
                        //the current implementation of list_objects returns list of objects with key
                        // that starts with the provided name. we will validate it.
                        if (obj_index >= 0) {
                            return client.object.delete_object({
                                bucket: params.bucket,
                                key: file_key_name
                            }).then(function() {
                                dbg.log0('Deleted old version of object "%s" in bucket "%s"', file_key_name, params.bucket);
                                uploadObject(req, res, file_key_name);
                            }, function(err) {
                                dbg.log0('Failure while trying to delete old version of object "%s"', file_key_name, err);
                                var template = templateBuilder.buildKeyNotFound(file_key_name);
                                return buildXmlResponse(res, 500, template);

                            });
                        } else {
                            dbg.warning('no real old version');
                            uploadObject(req, res, file_key_name);
                        }
                    } else {
                        dbg.log0('body:', parseInt(req.headers['content-length']));
                        uploadObject(req, res, file_key_name);
                    }

                });
            }
        },

        postMultipartObject: function(req, res) {
            Q.fcall(function() {
                var template;
                //init multipart upload
                if (req.query.uploads === '') {
                    dbg.log0('Init Multipart', req.originalUrl);
                    var key = (req.originalUrl).replace('/' + params.bucket + '/', '');
                    key = key.substring(0, key.indexOf('?uploads'));
                    var create_params = {
                        bucket: params.bucket,
                        key: key,
                        size: 0,
                        content_type: req.headers['content-type']
                    };
                    return client.object.create_multipart_upload(create_params)
                        .then(function(info) {
                            template = templateBuilder.buildInitiateMultipartUploadResult(req.params.key);
                            return buildXmlResponse(res, 200, template);
                        }).then(null, function(err) {
                            template = templateBuilder.buildKeyNotFound(req.query.uploadId);
                            dbg.error('Error init multipart', template);
                            return buildXmlResponse(res, 500, template);
                        });
                }
                //CompleteMultipartUpload
                else if (!_.isUndefined(req.query.uploadId)) {
                    dbg.log0('request to complete ', req.query.uploadId);
                    return client.object.complete_multipart_upload({
                        bucket: params.bucket,
                        key: req.query.uploadId,
                        fix_parts_size: true
                    }).then(function(info) {
                        dbg.log0('done complete', info);
                        delete objects_avarage_part_size[req.query.uploadId];
                        var completeMultipartInformation = {
                            Bucket: params.bucket,
                            Key: req.query.uploadId,
                            Location: 'https://' + req.hostname + '/' + params.bucket + '/' + req.query.uploadId,
                            ETag: 1234
                        };

                        template = templateBuilder.completeMultipleUpload(completeMultipartInformation);
                        dbg.log0('Complete multipart', template);
                        return buildXmlResponse(res, 200, template);
                    }).then(null, function(err) {
                        dbg.error('Err Complete multipart', err);
                        template = templateBuilder.buildKeyNotFound(req.query.uploadId);
                        return buildXmlResponse(res, 500, template);

                    });
                }
            });
        },
        deleteObject: function(req, res) {
            //this is also valid for the Abort Multipart Upload
            var key = req.params.key;

            Q.fcall(function() {
                    return client.object.list_objects({
                        bucket: params.bucket,
                        key: key
                    });
                })
                .then(function(res) {

                    if (res.objects.length === 0) {
                        dbg.log2('Could not delete object "%s"', key);
                        var template = templateBuilder.buildKeyNotFound(key);
                        return buildXmlResponse(res, 404, template);
                    }
                    dbg.log2('objects in bucket', params.bucket, ' with key ', key, ':');
                    var i = 0;
                    _.each(res.objects, function(obj) {
                        dbg.log2('#' + i, obj.key, '\t', obj.info.size, 'bytes');
                        i++;
                    });
                    return client.object.delete_object({
                        bucket: params.bucket,
                        key: key
                    });
                }).then(function() {
                    dbg.log0('Deleted object "%s" in bucket "%s"', key, req.bucket.name);
                    return res.status(204).end();
                }, function(err) {
                    dbg.error('Failure while trying to delete object "%s"', key, err);
                    var template = templateBuilder.buildKeyNotFound(key);
                    return buildXmlResponse(res, 500, template);

                });
        }
    };
};
