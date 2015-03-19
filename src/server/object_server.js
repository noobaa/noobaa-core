/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var rest_api = require('../util/rest_api');
var api = require('../api');
var db = require('./db');
var object_mapper = require('./object_mapper');
var glob_to_regexp = require('glob-to-regexp');
var dbg = require('noobaa-util/debug_module')(__filename);

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
                content_type: req.rest_params.content_type || 'application/octet-stream',
                upload_size: 0,
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
            if (!_.isNumber(obj.upload_size)) {
                throw new Error('object not in upload mode ' + obj.key);
            }

            db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'obj.uploaded',
                obj: obj,
            });

            return obj.update({
                    $unset: {
                        upload_size: 1
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
    //TODO: Maybe mark the ul as aborted so we won't continue to allocate parts
    //and only then delete. Thus not having currently allocated parts deleted,
    //while continuing to ul resulting in a partial file
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
            if (!_.isNumber(obj.upload_size)) {
                throw new Error('object not in upload mode ' + obj.key);
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
            if (!_.isNumber(obj.upload_size)) {
                throw new Error('object not in upload mode ' + obj.key);
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
            var params = _.pick(req.rest_params,
                'start',
                'end',
                'fragment',
                'block_id',
                'is_write');
            params.obj = obj;
            return object_mapper.bad_block_in_part(params);
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
            var params = _.pick(req.rest_params,
                'start',
                'end',
                'skip',
                'limit',
                'details');
            params.obj = obj;
            // allow details only to admin!
            if (params.details && req.role !== 'admin') {
                params.details = false;
            }
            return object_mapper.read_object_mappings(params);
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
    var deleted_object;
    return load_bucket(req)
        .then(function() {
            var query = _.omit(object_md_query(req), 'deleted');
            return db.ObjectMD.findOne(query).exec();
        })
        .then(db.check_not_found(req, 'object'))
        .then(function(obj) {
            deleted_object = obj;
            dbg.log4('deleting object', obj);
            return obj.update({
                deleted: new Date()
            }).exec();
        })
        .then(function() {
            return object_mapper.delete_object_mappings(deleted_object);
        })
        .thenResolve();
}


function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
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
                info.key = new RegExp('^' + escapeRegExp(req.rest_params.key));
            } else if (req.rest_params.key_regexp) {
                info.key = new RegExp(req.rest_params.key_regexp);
            } else if (req.rest_params.key_glob) {
                info.key = glob_to_regexp(req.rest_params.key_glob);
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
    info.create_time = md.create_time.getTime();
    if (_.isNumber(md.upload_size)) {
        info.upload_size = md.upload_size;
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
