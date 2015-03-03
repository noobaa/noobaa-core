'use strict';
var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var util = require('util');
var md5 = require('MD5');
var crypto = require('crypto');
var md5_stream = require('../util/md5_stream');
// var os = require('os');
// var http = require('http');
var path = require('path');
// var util = require('util');
// var repl = require('repl');
// var assert = require('assert');
// var crypto = require('crypto');
// var mkdirp = require('mkdirp');
var SliceReader = require('../util/slice_reader');
var mime = require('mime');
var concat_stream = require('concat-stream');
// var argv = require('minimist')(process.argv);
// var Semaphore = require('noobaa-util/semaphore');
// var size_utils = require('../util/size_utils');
// var range_utils = require('../util/range_utils');
var api = require('../api');
// var client_streamer = require('./client_streamer');
var dbg = require('../util/dbg')(__filename);
var S3Object = require('./models/s3-object');
//
// Q.longStackSupport = true;


process.on('uncaughtException', function(err) {
    console.log(err.stack);
});

var params = {
    address: 'http://localhost:5001',
    streamer: 5006,
    email: 'demo@noobaa.com',
    password: 'DeMo',
    system: 'demo',
    tier: 'devices',
    bucket: 'files',
};

module.exports = function(rootDirectory) {
    var FileStore = require('./file-store'),
        fileStore = new FileStore(rootDirectory),
        templateBuilder = require('./xml-template-builder');

    var client = new api.Client();
    client.options.set_address(params.address);
    Q.fcall(function() {
        var auth_params = _.pick(params,
            'email', 'password', 'system', 'role');
        if (params.bucket) {
            auth_params.extra = {
                bucket: params.bucket
            };
        }
        dbg.log1('create auth', auth_params);
        return client.create_auth_token(auth_params);

    });

    var buildXmlResponse = function(res, status, template) {
        res.header('Content-Type', 'application/xml');
        res.status(status);
        //console.log('template:',template,'headers',res);
        return res.send(template);
    };

    var uploadObject = function(req, res, file_key_name) {
        try {
            var md5 = 0;

            // tranform stream that calculates md5 on-the-fly
            var md5_calc = new md5_stream();
            req.pipe(md5_calc);

            md5_calc.on('finish', function() {
                md5 = md5_calc.toString();
                console.log('MD5 data (end)', md5);
            });

            // md5_calc.on('data', function(data) {
            //     md5Hash.update(data);
            // });
            // md5_calc.on('end', function() {
            //     md5 = md5Hash.digest('hex');
            //     console.log('go data (end)', md5);
            // });

            return client.object.upload_stream({
                bucket: params.bucket,
                key: file_key_name,
                size: parseInt(req.headers['content-length']),
                content_type: req.headers['content-type'] || mime.lookup(file_key_name),
                source_stream: md5_calc,
            }).then(function() {
                try {
                    console.log('COMPLETED: upload', file_key_name, md5);
                    res.header('ETag', md5);
                } catch (err) {
                    console.log('FAILED', err, res);

                }
                return res.status(200).end();
            }, function(err) {
                console.log('ERROR: upload', file_key_name, ' err:', util.inspect(err));
                return res.status(500).end();
            });
        } catch (err) {
            console.log('Failed upload stream to noobaa:', err);
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
            fileStore.getBucket(bucketName, function(err, bucket) {
                if (err) {
                    console.error('No bucket found for "%s"', bucketName);
                    var template = templateBuilder.buildBucketNotFound(bucketName);
                    return buildXmlResponse(res, 404, template);
                }
                req.bucket = bucket;
                return next();
            });
        },
        getBuckets: function(req, res) {
            var buckets = fileStore.getBuckets();
            console.info('Fetched %d buckets', buckets.length);
            var template = templateBuilder.buildBuckets(buckets);
            return buildXmlResponse(res, 200, template);
        },
        getBucket: function(req, res) {
            var options = {
                marker: req.query.marker || null,
                prefix: req.query.prefix || '',
                maxKeys: parseInt(req.query['max-keys']) || 1000,
                delimiter: req.query.delimiter || '/'
            };
            console.info('Fetched bucket "%s" with options', req.bucket.name);
            //  fileStore.getObjects(req.bucket, options, function(err, results) {
            //      console.info('Found %d objects for bucket "%s"', results.length, req.bucket.name, 'res', results);
            //      options.bucketName = req.bucket.name;
            //      var template = templateBuilder.buildBucketQuery(options, results);
            //      return buildXmlResponse(res, 200, template);
            //  });

            return Q.fcall(function() {
                    var list_params = {
                        bucket: params.bucket,
                    };
                    if (options.prefix) {
                        list_params.key = options.prefix;
                    }
                    return client.object.list_objects(list_params);
                })
                .then(function(results) {
                    console.log('objects in bucket', params.bucket, ':',results);
                    var i = 0;
                    var folders = {};
                    var objects = _.filter(results.objects, function(obj) {
                        var date = new Date(obj.info.create_time);
                        date.setMilliseconds(0);
                        obj.modifiedDate = date.toISOString();//toUTCString();//.toISOString();
                        obj.md5 = 100;
                        obj.size = obj.info.size;
                        obj.key = obj.key.slice(options.prefix.length);
                        if (obj.key.indexOf(req.query.delimiter) >=0) {
                            var folder = obj.key.split(req.query.delimiter, 1)[0];
                            folders[folder] = true;
                            return false;
                        }
                        if (!obj.key) {
                            // empty key - might beobject created as a folder
                            return false;
                        }
                        return true;
                    });
                    options.bucketName = req.bucket.name;
                    options.common_prefixes = _.isEmpty(folders) ? null : _.keys(folders);
                    var template = templateBuilder.buildBucketQuery(options, objects);
                    return buildXmlResponse(res, 200, template);
                })
                .then(function() {
                    console.log('COMPLETED: list');
                }, function(err) {
                    console.log('ERROR: list', err);
                });
        },
        putBucket: function(req, res) {
            var bucketName = req.params.bucket;
            var template;
            /**
             * Derived from http://docs.aws.amazon.com/AmazonS3/latest/dev/BucketRestrictions.html
             */
            if ((/^[a-z0-9]+(-[a-z0-9]+)*$/.test(bucketName) === false)) {
                template = templateBuilder.buildError('InvalidBucketName',
                    'Bucket names can contain lowercase letters, numbers, and hyphens. ' +
                    'Each label must start and end with a lowercase letter or a number.');
                console.error('Error creating bucket "%s" because the name is invalid', bucketName);
                return buildXmlResponse(res, 400, template);
            }
            if (bucketName.length < 3 || bucketName.length > 63) {
                console.error('Error creating bucket "%s" because the name is invalid', bucketName);
                template = templateBuilder.buildError('InvalidBucketName',
                    'The bucket name must be between 3 and 63 characters.');
                return buildXmlResponse(res, 400, template);
            }
            fileStore.getBucket(bucketName, function(err, bucket) {
                if (bucket) {
                    console.error('Error creating bucket. Bucket "%s" already exists', bucketName);
                    var template = templateBuilder.buildError('BucketAlreadyExists',
                        'The requested bucket already exists');
                    return buildXmlResponse(res, 409, template);
                }
                fileStore.putBucket(bucketName, function(err) {
                    if (err) {
                        console.error('Error creating bucket "%s"', err);
                        var template = templateBuilder.buildError('InternalError',
                            'We encountered an internal error. Please try again.');
                        return buildXmlResponse(res, 500, template);
                    }
                    console.info('Created new bucket "%s" successfully', bucketName);
                    res.header('Location', '/' + bucketName);
                    return res.status(200).send();
                });
            });
        },
        deleteBucket: function(req, res) {
            fileStore.deleteBucket(req.bucket, function(err) {
                if (err) {
                    var template = templateBuilder.buildBucketNotEmpty(req.bucket.name);
                    return buildXmlResponse(res, 409, template);
                }
                return res.status(204).end();
            });
        },



        getObject: function(req, res) {
            var keyName = req.params.key;
            var acl = req.query.acl;

            if (acl !== undefined) {
                var template = templateBuilder.buildAcl();
                console.log('ACL:', acl, 'template', template);
                return buildXmlResponse(res, 200, template);

            } else {


                //S3 browser format - maybe future use.
                // keyName = keyName.replace('..chunk..map','');

                Q.fcall(function() {
                        var object_path = {
                            bucket: params.bucket,
                            key: keyName
                        };
                        return client.object.get_object_md(object_path);
                    })
                    .then(function(object_md) {
                        res.header('Last-Modified', new Date().toISOString());
                        res.header('Content-Type', object_md.content_type);
                        res.header('Content-Length', object_md.size);
                        res.header('x-amz-meta-cb-modifiedtime', req.headers['x-amz-date']);
                        var defer = Q.defer();
                        var object_path = {
                            bucket: params.bucket,
                            key: keyName
                        };
                        //var stream = concat_stream(defer.resolve);
                        //stream.once('error', defer.reject);
                        //client.object.open_read_stream(object_path).pipe(stream);
                        //return defer.promise;

                        if (req.method === 'HEAD') {
                            return res.end();
                        } else {
                            var stream = client.object.open_read_stream(object_path).pipe(res);
                            // var stream_md5 = md5(stream);
                            // console.log('COMPLETED: download of ', keyName,stream_md5);
                            // res.header('Etag', stream_md5);
                            // return res.end();
                        }

                    }).then(null, function(err) {
                        console.log('ERROR: while download from noobaa', err);
                        var template = templateBuilder.buildKeyNotFound(keyName);
                        console.error('Object "%s" in bucket "%s" does not exist', keyName, req.bucket.name);
                        return buildXmlResponse(res, 404, template);
                    });
            }
        },
        putObject: function(req, res) {
            var template;
            var acl = req.query.acl;
            if (acl !== undefined) {
                template = templateBuilder.buildAcl();
                console.log('ACL:', acl, 'template', template);
                return buildXmlResponse(res, 200, template);
            }
            var copy = req.headers['x-amz-copy-source'];
            if (copy) {
                var srcObjectParams = copy.split('/'),
                    srcBucket = srcObjectParams[1],
                    srcObject = srcObjectParams.slice(2).join('/');
                fileStore.getBucket(srcBucket, function(err, bucket) {
                    if (err) {
                        console.error('No bucket found for "%s"', srcBucket);
                        template = templateBuilder.buildBucketNotFound(srcBucket);
                        return buildXmlResponse(res, 404, template);
                    }
                    fileStore.getObject(bucket, srcObject, function(err) {
                        if (err) {
                            console.error('Object "%s" in bucket "%s" does not exist', srcObject, bucket.name);
                            template = templateBuilder.buildKeyNotFound(srcObject);
                            return buildXmlResponse(res, 404, template);
                        }
                        fileStore.copyObject(bucket, srcObject, req.bucket, req.params.key, function(err, key) {
                            if (err) {
                                console.error('Error copying object "%s" from bucket "%s" into bucket "%s" with key of "%s"',
                                    srcObject, bucket.name, req.bucket.name, req.params.key);
                                template = templateBuilder.buildError('InternalError',
                                    'We encountered an internal error. Please try again.');
                                return buildXmlResponse(res, 500, template);
                            }

                            console.info('Copied object "%s" from bucket "%s"  into bucket "%s" with key of "%s"',
                                srcObject, bucket.name, req.bucket.name, req.params.key);
                            template = templateBuilder.buildCopyObject(key);
                            return buildXmlResponse(res, 200, template);
                        });
                    });
                });
            } else {

                console.log('About to store object "%s" in bucket "%s" ', req.params.key, req.bucket.name, req.headers);

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

                var client = new api.Client();

                client.options.set_address(params.address);

                Q.fcall(function() {
                    var auth_params = _.pick(params,
                        'email', 'password', 'system', 'role');
                    if (params.bucket) {
                        auth_params.extra = {
                            bucket: params.bucket
                        };
                    }
                    dbg.log1('create auth', auth_params);
                    return client.create_auth_token(auth_params);

                }).then(function() {
                    console.log('check', params.bucket, file_key_name);

                    return client.object.list_objects({
                        bucket: params.bucket,
                        key: file_key_name
                    });
                }).then(function(list_results) {
                    console.log('resres', list_results, list_results.objects.length, params.bucket, file_key_name);
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
                                console.log('Deleted old version of object "%s" in bucket "%s"', file_key_name, params.bucket);
                                uploadObject(req, res, file_key_name);
                                //                                    return res.status(204).end();
                            }, function(err) {
                                console.log('Failure while trying to delete old version of object "%s"', file_key_name, err);
                                var template = templateBuilder.buildKeyNotFound(file_key_name);
                                return buildXmlResponse(res, 500, template);

                            });
                        } else {
                            console.log('no real old version');
                            uploadObject(req, res, file_key_name);
                        }
                    } else {
                        console.log('body:', parseInt(req.headers['content-length']));
                        uploadObject(req, res, file_key_name);
                    }

                });
            }
        },
        deleteObject: function(req, res) {
            var key = req.params.key;
            Q.fcall(function() {
                    return client.object.list_objects({
                        bucket: params.bucket,
                        key: key
                    });
                })
                .then(function(res) {
                    console.log('res', res);

                    if (res.objects.length === 0) {
                        console.error('Could not delete object "%s"', key);
                        var template = templateBuilder.buildKeyNotFound(key);
                        return buildXmlResponse(res, 404, template);
                    }
                    console.log('objects in bucket', params.bucket, ' with key ', key, ':');
                    var i = 0;
                    _.each(res.objects, function(obj) {
                        console.log('#' + i, obj.key, '\t', obj.info.size, 'bytes');
                        i++;
                    });
                    return client.object.delete_object({
                        bucket: params.bucket,
                        key: key
                    });
                }).then(function() {
                    console.info('Deleted object "%s" in bucket "%s"', key, req.bucket.name);
                    return res.status(204).end();
                }, function(err) {
                    console.error('Failure while trying to delete object "%s"', key, err);
                    var template = templateBuilder.buildKeyNotFound(key);
                    return buildXmlResponse(res, 500, template);

                });
        }
    };
};
