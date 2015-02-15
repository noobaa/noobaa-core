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
    allocate_object_parts: allocate_object_parts,
    finalize_object_parts: finalize_object_parts,
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
    return load_bucket(req)
        .then(function() {
            var info = {
                system: req.system.id,
                bucket: req.bucket.id,
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
    return find_object_md(req)
        .then(function(obj) {
            return obj.update({
                    $unset: {
                        upload_mode: 1
                    }
                })
                .exec();
        })
        .thenResolve();
}



/**
 *
 * ABORT_MULTIPART_UPLOAD
 *
 */
function abort_multipart_upload(req) {
    return delete_object(req);
}



/**
 *
 * ALLOCATE_OBJECT_PARTS
 *
 */
function allocate_object_parts(req) {
    return find_object_md(req)
        .then(function(obj) {
            if (!obj.upload_mode) {
                throw new Error('object not in upload mode');
            }
            return object_mapper.allocate_object_parts(
                req.bucket,
                obj,
                req.rest_params.parts);
        });
}


/**
 *
 * FINALIZE_OBJECT_PART
 *
 */
function finalize_object_parts(req) {
    return find_object_md(req)
        .then(function(obj) {
            if (!obj.upload_mode) {
                throw new Error('object not in upload mode');
            }
            return object_mapper.finalize_object_parts(
                req.bucket,
                obj,
                req.rest_params.parts);
        });
}


function report_bad_block(req) {
    return find_object_md(req)
        .then(function(obj) {
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

    return find_object_md(req)
        .then(function(obj_arg) {
            obj = obj_arg;
            return object_mapper.read_object_mappings(
                obj,
                req.rest_params.start,
                req.rest_params.end,
                req.rest_params.skip,
                req.rest_params.limit);
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
    return find_object_md(req)
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
    return find_object_md(req)
        .then(function(obj) {
            var updates = _.pick(req.rest_params, 'content_type');
            return obj.update(updates).exec();
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
    return load_bucket(req)
        .then(function() {
            var query = _.omit(object_md_query(req), 'deleted');
            return db.ObjectMD.findOne(query).exec();
        })
        .then(db.check_not_found(req, 'object'))
        .then(function(obj) {
            return obj.update({
                deleted: new Date()
            }).exec();
        })
        .then(db.check_not_found(req, 'object'))
        .then(function(obj) {
            return object_mapper.delete_object_mappings(obj);
        })
        .thenResolve();
}



/**
 *
 * LIST_OBJECTS
 *
 */
function list_objects(req) {
    return load_bucket(req)
        .then(function() {
            var info = _.omit(object_md_query(req), 'key');
            if (req.rest_params.key) {
                info.key = new RegExp(req.rest_params.key);
            }
            var skip = req.rest_params.skip;
            var limit = req.rest_params.limit;
            var find = db.ObjectMD.find(info).sort('-_id');
            if (skip) {
                find.skip(skip);
            }
            if (limit) {
                find.limit(limit);
            }
            return find.exec();
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

function load_bucket(req) {
    return db.BucketCache.get({
            system: req.system.id,
            name: req.rest_params.bucket,
        })
        .then(db.check_not_deleted(req, 'bucket'))
        .then(function(bucket) {
            req.bucket = bucket;
        });
}

function object_md_query(req) {
    return {
        system: req.system.id,
        bucket: req.bucket.id,
        key: req.rest_params.key,
        deleted: null
    };
}

function find_object_md(req) {
    return load_bucket(req)
        .then(function() {
            return db.ObjectMD.findOne(object_md_query(req)).exec();
        })
        .then(db.check_not_deleted(req, 'object'));
}
