/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var rest_api = require('../util/rest_api');
var api = require('../api');
var system_server = require('./system_server');
var LRU = require('noobaa-util/lru');
var object_mapper = require('./object_mapper');
var db = require('./db');


/**
 *
 * OBJECT SERVER (REST)
 *
 */
module.exports = new api.object_api.Server({
    // object upload
    create_multipart_upload: create_multipart_upload,
    complete_multipart_upload: complete_multipart_upload,
    abort_multipart_upload: abort_multipart_upload,
    allocate_object_part: allocate_object_part,
    // read
    read_object_mappings: read_object_mappings,
    // object meta-data
    read_object_md: read_object_md,
    update_object_md: update_object_md,
    delete_object: delete_object,
}, {
    before: function(req) {
        return req.load_system(['admin']);
    }
});



/**
 *
 * CREATE_MULTIPART_UPLOAD
 *
 */
function create_multipart_upload(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;
    var size = req.rest_params.size;

    return db.BucketCache.get({
            system: req.system.id,
            name: bucket_name,
        })
        .then(function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
                size: size,
                upload_mode: true,
            };
            return db.ObjectMD.create(info);
        }).thenResolve();
}



/**
 *
 * COMPLETE_MULTIPART_UPLOAD
 *
 */
function complete_multipart_upload(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return db.BucketCache.get({
            system: req.system.id,
            name: bucket_name,
        })
        .then(function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            var updates = {
                $unset: {
                    upload_mode: 1
                }
            };
            return db.ObjectMD.findOneAndUpdate(info, updates).exec();
        }).thenResolve();
}



/**
 *
 * ABORT_MULTIPART_UPLOAD
 *
 */
function abort_multipart_upload(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return db.BucketCache.get({
            system: req.system.id,
            name: bucket_name,
        })
        .then(function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            var updates = {
                upload_mode: true
            };
            return db.ObjectMD.findOneAndUpdate(info, updates).exec();
        }).thenResolve();
}



/**
 *
 * ALLOCATE_OBJECT_PART
 *
 */
function allocate_object_part(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;
    var start = Number(req.rest_params.start);
    var end = Number(req.rest_params.end);
    var md5sum = req.rest_params.md5sum;

    return db.BucketCache.get({
            system: req.system.id,
            name: bucket_name,
        })
        .then(function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            return db.ObjectMD.findOne(info).exec();
        }).then(function(obj) {
            if (!obj) {
                throw new Error('object not found');
            }
            if (!obj.upload_mode) {
                // TODO handle the upload_mode state
                // throw new Error('object not in upload mode');
            }
            return object_mapper.allocate_object_part(obj, start, end, md5sum);
        });
}



/**
 *
 * READ_OBJECT_MAPPING
 *
 */
function read_object_mappings(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;
    var start = Number(req.rest_params.start);
    var end = Number(req.rest_params.end);
    var obj;

    return db.BucketCache.get({
            system: req.system.id,
            name: bucket_name,
        })
        .then(function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            return db.ObjectMD.findOne(info).exec();
        }).then(function(obj_arg) {
            obj = obj_arg;
            return object_mapper.read_object_mappings(obj, start, end);
        }).then(function(parts) {
            return {
                size: obj.size,
                parts: parts,
            };
        });
}



/**
 *
 * READ_OBJECT_MD
 *
 */
function read_object_md(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return db.BucketCache.get({
            system: req.system.id,
            name: bucket_name,
        })
        .then(function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            return db.ObjectMD.findOne(info).exec();
        }).then(function(obj) {
            return get_object_info(obj);
        });
}



/**
 *
 * UPDATE_OBJECT_MD
 *
 */
function update_object_md(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return db.BucketCache.get({
            system: req.system.id,
            name: bucket_name,
        })
        .then(function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            // TODO no fields can be updated for now
            var updates = _.pick(req.rest_params);
            return db.ObjectMD.findOneAndUpdate(info, updates).exec();
        }).thenResolve();
}



/**
 *
 * DELETE_OBJECT
 *
 */
function delete_object(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return db.BucketCache.get({
            system: req.system.id,
            name: bucket_name,
        })
        .then(function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            return db.ObjectMD.findOneAndRemove(info).exec();
        }).thenResolve();
}



// UTILS //////////////////////////////////////////////////////////


function get_object_info(md) {
    var info = {
        size: md.size || 0,
        create_time: md.create_time.toString(),
    };
    if (md.upload_mode) {
        info.upload_mode = md.upload_mode;
    }
    return info;
}
