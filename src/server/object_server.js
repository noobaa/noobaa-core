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
    report_bad_block: report_bad_block,

    // read
    read_object_mappings: read_object_mappings,

    // object meta-data
    read_object_md: read_object_md,
    update_object_md: update_object_md,
    delete_object: delete_object,
    list_objects: list_objects,
});



/**
 *
 * CREATE_MULTIPART_UPLOAD
 *
 */
function create_multipart_upload(req) {
    return get_bucket_from_cache(req)
        .then(function(bucket) {
            var info = {
                system: req.system.id,
                bucket: bucket.id,
                key: req.rest_params.key,
                size: req.rest_params.size,
                content_type: req.rest_params.content_type,
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
    return get_bucket_from_cache(req)
        .then(function(bucket) {
            var info = {
                system: req.system.id,
                bucket: bucket.id,
                key: req.rest_params.key,
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
    return get_bucket_from_cache(req)
        .then(function(bucket) {
            var info = {
                system: req.system.id,
                bucket: bucket.id,
                key: req.rest_params.key,
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
    var bucket;
    return get_bucket_from_cache(req)
        .then(function(bucket_arg) {
            bucket = bucket_arg;
            var info = {
                system: req.system.id,
                bucket: bucket.id,
                key: req.rest_params.key,
            };
            return db.ObjectMD.findOne(info).exec();
        })
        .then(db.check_not_deleted(req, 'object'))
        .then(function(obj) {
            if (!obj.upload_mode) {
                // TODO handle the upload_mode state
                // throw new Error('object not in upload mode');
            }
            return object_mapper.allocate_object_part(
                bucket,
                obj,
                req.rest_params.start,
                req.rest_params.end,
                req.rest_params.md5sum);
        });
}


function report_bad_block(req) {
    var bucket;
    var obj;
    return get_bucket_from_cache(req)
        .then(function(bucket_arg) {
            bucket = bucket_arg;
            var info = {
                system: req.system.id,
                bucket: bucket.id,
                key: req.rest_params.key,
            };
            return db.ObjectMD.findOne(info).exec();
        })
        .then(db.check_not_deleted(req, 'object'))
        .then(function(obj_arg) {
            obj = obj_arg;
            return object_mapper.bad_block_in_part(
                obj,
                req.rest_params.start,
                req.rest_params.end,
                req.rest_params.fragment,
                req.rest_params.block_id,
                req.rest_params.is_write);
        })
        .then(function(new_block) {
            if (new_block) {
                return {
                    new_block: new_block
                };
            }
        });
}


/**
 *
 * READ_OBJECT_MAPPING
 *
 */
function read_object_mappings(req) {
    var obj;

    return get_bucket_from_cache(req)
        .then(function(bucket) {
            var info = {
                system: req.system.id,
                bucket: bucket.id,
                key: req.rest_params.key,
            };
            return db.ObjectMD.findOne(info).exec();
        })
        .then(db.check_not_deleted(req, 'object'))
        .then(function(obj_arg) {
            obj = obj_arg;
            var start = Number(req.rest_params.start);
            var end = Number(req.rest_params.end);
            return object_mapper.read_object_mappings(obj, start, end);
        })
        .then(function(parts) {
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
    return get_bucket_from_cache(req)
        .then(function(bucket) {
            var info = {
                system: req.system.id,
                bucket: bucket.id,
                key: req.rest_params.key,
            };
            return db.ObjectMD.findOne(info).exec();
        })
        .then(db.check_not_deleted(req, 'object'))
        .then(function(obj) {
            return get_object_info(obj);
        });
}



/**
 *
 * UPDATE_OBJECT_MD
 *
 */
function update_object_md(req) {
    return get_bucket_from_cache(req)
        .then(function(bucket) {
            var info = {
                system: req.system.id,
                bucket: bucket.id,
                key: req.rest_params.key,
            };
            var updates = _.pick(req.rest_params, 'content_type');
            return db.ObjectMD.findOneAndUpdate(info, updates).exec();
        })
        .then(db.check_not_deleted(req, 'object'))
        .thenResolve();
}



/**
 *
 * DELETE_OBJECT
 *
 */
function delete_object(req) {
    return get_bucket_from_cache(req)
        .then(function(bucket) {
            var info = {
                system: req.system.id,
                bucket: bucket.id,
                key: req.rest_params.key,
            };
            return db.ObjectMD.findOneAndRemove(info).exec();
        })
        .then(db.check_not_found(req, 'object'))
        .thenResolve();
}



/**
 *
 * LIST_OBJECTS
 *
 */
function list_objects(req) {
    return get_bucket_from_cache(req)
        .then(function(bucket) {
            var info = {
                system: req.system.id,
                bucket: bucket.id,
            };
            if (req.rest_params.key) {
                info.key = new RegExp(req.rest_params.key);
            }
            return db.ObjectMD.find(info).exec();
        })
        .then(function(objects) {
            return {
                objects: _.map(objects, function(obj) {
                    return {
                        key: obj.key,
                        info: get_object_info(obj),
                    };
                })
            };
        });
}





// UTILS //////////////////////////////////////////////////////////


function get_object_info(md) {
    var info = _.pick(md, 'size', 'content_type');
    info.size = info.size || 0;
    info.content_type = info.content_type || '';
    info.create_time = md.create_time.toString();
    if (md.upload_mode) {
        info.upload_mode = md.upload_mode;
    }
    return info;
}

function get_bucket_from_cache(req) {
    return db.BucketCache.get({
            system: req.system.id,
            name: req.rest_params.bucket,
        })
        .then(db.check_not_deleted(req, 'bucket'));
}
