/* jshint node:true */
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var object_mapper = require('./mapper/object_mapper');
var system_store = require('./stores/system_store');
var glob_to_regexp = require('glob-to-regexp');
var dbg = require('../util/debug_module')(__filename);
var string_utils = require('../util/string_utils');

/**
 *
 * OBJECT_SERVER
 *
 */
var object_server = {

    // object upload
    create_multipart_upload: create_multipart_upload,
    list_multipart_parts: list_multipart_parts,
    complete_multipart_upload: complete_multipart_upload,
    abort_multipart_upload: abort_multipart_upload,
    allocate_object_parts: allocate_object_parts,
    finalize_object_parts: finalize_object_parts,
    report_bad_block: report_bad_block,
    complete_part_upload: complete_part_upload,
    // read
    read_object_mappings: read_object_mappings,

    // object meta-data
    read_object_md: read_object_md,
    update_object_md: update_object_md,
    delete_object: delete_object,
    list_objects: list_objects,

    //cloud sync related
    set_all_files_for_sync: set_all_files_for_sync
};

module.exports = object_server;



/**
 *
 * CREATE_MULTIPART_UPLOAD
 *
 */
function create_multipart_upload(req) {
    load_bucket(req);
    dbg.log0('create_multipart_upload xattr', req.rpc_params);
    var info = {
        system: req.system._id,
        bucket: req.bucket._id,
        key: req.rpc_params.key,
        size: req.rpc_params.size,
        content_type: req.rpc_params.content_type || 'application/octet-stream',
        upload_size: 0,
        cloud_synced: false,
        xattr: req.rpc_params.xattr
    };
    return P.when(db.ObjectMD.create(info)).return();
}



/**
 *
 * LIST_MULTIPART_PARTS
 *
 */
function list_multipart_parts(req) {
    return find_object_md(req)
        .then(function(obj) {
            fail_obj_not_in_upload_mode(req, obj);
            var params = _.pick(req.rpc_params,
                'part_number_marker',
                'max_parts');
            params.obj = obj;
            return object_mapper.list_multipart_parts(params);
        });
}


/**
 *
 * COMPLETE_PART_UPLOAD
 *
 * Set md5 for part (which is part of multipart upload)
 */
function complete_part_upload(req) {
    dbg.log1('complete_part_upload - etag', req.rpc_params.etag, 'req:', req);
    return find_object_md(req)
        .then(function(obj) {
            fail_obj_not_in_upload_mode(req, obj);
            var params = _.pick(req.rpc_params,
                'upload_part_number', 'etag');
            params.obj = obj;
            return object_mapper.set_multipart_part_md5(params);
        });
}

/**
 *
 * COMPLETE_MULTIPART_UPLOAD
 *
 */
function complete_multipart_upload(req) {
    var obj;
    var obj_etag = req.rpc_params.etag;

    return find_object_md(req)
        .then(function(obj_arg) {
            obj = obj_arg;
            fail_obj_not_in_upload_mode(req, obj);
            if (req.rpc_params.fix_parts_size) {
                return object_mapper.calc_multipart_md5(obj)
                    .then(function(aggregated_md5) {
                        obj_etag = aggregated_md5;
                        dbg.log0('aggregated_md5', obj_etag);
                        if (req.rpc_params.fix_parts_size) {
                            return object_mapper.fix_multipart_parts(obj);
                        }
                    });
            }
        })
        .then(function(object_size) {
            db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'obj.uploaded',
                obj: obj,
            });

            return db.ObjectMD.collection.updateOne({
                _id: obj._id
            }, {
                $set: {
                    size: object_size || obj.size,
                    etag: obj_etag,
                },
                $unset: {
                    upload_size: 1
                }
            });
        }).then(null, function(err) {
            dbg.error('complete_multipart_upload_err ', err, err.stack);
        })
        .then(function() {
            system_store.make_changes_in_background({
                update: {
                    buckets: [{
                        _id: obj.bucket,
                        $inc: {
                            'stats.writes': 1
                        }
                    }]
                }
            });
            return {
                etag: obj_etag
            };
        });
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
    return find_cached_object_md(req)
        .then(function(obj) {
            fail_obj_not_in_upload_mode(req, obj);
            return object_mapper.allocate_object_parts(
                req.bucket,
                obj,
                req.rpc_params.parts);
        });
}


/**
 *
 * FINALIZE_OBJECT_PART
 *
 */
function finalize_object_parts(req) {
    return find_cached_object_md(req)
        .then(function(obj) {
            fail_obj_not_in_upload_mode(req, obj);
            return object_mapper.finalize_object_parts(
                req.bucket,
                obj,
                req.rpc_params.parts);
        });
}


function report_bad_block(req) {
    return find_object_md(req)
        .then(function(obj) {
            var params = req.rpc_params;
            params.obj = obj;
            return object_mapper.report_bad_block(params);
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
    var reply;

    return find_object_md(req)
        .then(function(obj_arg) {
            obj = obj_arg;
            var params = _.pick(req.rpc_params,
                'start',
                'end',
                'skip',
                'limit',
                'adminfo');
            params.obj = obj;
            // allow adminfo only to admin!
            if (params.adminfo && req.role !== 'admin') {
                params.adminfo = false;
            }
            return object_mapper.read_object_mappings(params);
        })
        .then(function(parts) {
            reply = {
                size: obj.size,
                parts: parts,
            };
            // when called from admin console, we do not update the stats
            // so that viewing the mapping in the ui will not increase read count
            if (req.rpc_params.adminfo) {
                return;
            }
            system_store.make_changes_in_background({
                update: {
                    buckets: [{
                        _id: obj.bucket,
                        $inc: {
                            'stats.reads': 1
                        }
                    }]
                }
            });
            return P.when(db.ObjectMD.collection.updateOne({
                _id: obj._id
            }, {
                $inc: {
                    'stats.reads': 1
                }
            }));
        })
        .then(function() {
            return reply;
        });
}



/**
 *
 * READ_OBJECT_MD
 *
 */
function read_object_md(req) {
    dbg.log0('read_obj(1):', req.rpc_params);
    var objid;
    return find_object_md(req)
        .then(function(obj) {
            objid = obj._id;
            dbg.log0('read_obj:', obj);
            return get_object_info(obj);
        })
        .then(function(info) {
            if (!req.rpc_params.get_parts_count) {
                return info;
            } else {
                return P.when(db.ObjectPart.count({
                        obj: objid,
                        deleted: null,
                    }))
                    .then(function(c) {
                        info.total_parts_count = c;
                        return info;
                    });
            }
        });
}



/**
 *
 * UPDATE_OBJECT_MD
 *
 */
function update_object_md(req) {
    dbg.log0('update object md', req.rpc_params);
    return find_object_md(req)
        .then(function(obj) {
            var updates = _.pick(req.rpc_params, 'content_type', 'xattr');
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
    load_bucket(req);
    return P.fcall(function() {
            var query = _.omit(object_md_query(req), 'deleted');
            return db.ObjectMD.findOne(query).exec();
        })
        .then(db.check_not_found(req, 'object'))
        .then(function(obj) {
            deleted_object = obj;
            dbg.log4('deleting object', obj);
            return obj.update({
                deleted: new Date(),
                cloud_synced: false
            }).exec();
        })
        .then(function() {
            return object_mapper.delete_object_mappings(deleted_object);
        })
        .thenResolve();
}


/**
 * return a regexp pattern to be appended to a prefix
 * to make it match "prefix/file" or "prefix/dir/"
 * but with a custom delimiter instead of /
 * @param delimiter - a single character.
 */
function one_level_delimiter(delimiter) {
    var d = string_utils.escapeRegExp(delimiter[0]);
    return '[^' + d + ']*' + d + '?$';
}

/**
 * common case is / as delimiter
 */
var ONE_LEVEL_SLASH_DELIMITER = one_level_delimiter('/');


/**
 *
 * LIST_OBJECTS
 *
 */
function list_objects(req) {
    dbg.log0('key query', req.rpc_params);
    load_bucket(req);
    return P.fcall(function() {
            var info = _.omit(object_md_query(req), 'key');
            if (req.rpc_params.key_query) {
                info.key = new RegExp(string_utils.escapeRegExp(req.rpc_params.key_query), 'i');
            } else if (req.rpc_params.key_regexp) {
                info.key = new RegExp(req.rpc_params.key_regexp);
            } else if (req.rpc_params.key_glob) {
                info.key = glob_to_regexp(req.rpc_params.key_glob);
            } else if (req.rpc_params.key_prefix) {
                info.key = new RegExp('^' + string_utils.escapeRegExp(req.rpc_params.key_prefix));
            } else if (!_.isUndefined(req.rpc_params.key_s3_prefix)) {
                // match "prefix/file" or "prefix/dir/"
                var one_level = req.rpc_params.delimiter ?
                    one_level_delimiter(req.rpc_params.delimiter) :
                    ONE_LEVEL_SLASH_DELIMITER;
                var prefix = string_utils.escapeRegExp(req.rpc_params.key_s3_prefix);
                info.key = new RegExp('^' + prefix + one_level);
            }

            var skip = req.rpc_params.skip;
            var limit = req.rpc_params.limit;
            console.log('key query2', info);
            var find = db.ObjectMD.find(info);
            if (skip) {
                find.skip(skip);
            }
            if (limit) {
                find.limit(limit);
            }
            var sort = req.rpc_params.sort;
            if (sort) {
                var order = (req.rpc_params.order === -1) ? -1 : 1;
                var sort_opt = {};
                sort_opt[sort] = order;
                find.sort(sort_opt);
            }

            return P.all([
                find.exec(),
                req.rpc_params.pagination && db.ObjectMD.count(info)
            ]);
        })
        .spread(function(objects, total_count) {
            var res = {
                objects: _.map(objects, function(obj) {
                    return {
                        key: obj.key,
                        info: get_object_info(obj),
                    };
                })
            };
            if (req.rpc_params.pagination) {
                res.total_count = total_count;
            }
            return res;
        });
}

//mark all objects on specific bucket for sync
//TODO:: use mongoDB bulk instead of two mongoose ops
function set_all_files_for_sync(sysid, bucketid) {
    dbg.log2('marking all objects on sys', sysid, 'bucket', bucketid, 'as sync needed');
    //Mark all "live" objects to be cloud synced
    return P.when(db.ObjectMD.update({
            system: sysid,
            bucket: bucketid,
            cloud_synced: true,
            deleted: null,
        }, {
            cloud_synced: false
        }, {
            multi: true
        }).exec())
        .then(function() {
            //Mark all "previous" deleted objects as not needed for cloud sync
            return P.when(db.ObjectMD.update({
                system: sysid,
                bucket: bucketid,
                cloud_synced: false,
                deleted: {
                    $ne: null
                },
            }, {
                cloud_synced: true
            }, {
                multi: true
            }).exec());
        });
}
// UTILS //////////////////////////////////////////////////////////


function get_object_info(md) {
    var info = _.pick(md, 'size', 'content_type', 'etag', 'xattr', 'stats');
    info.size = info.size || 0;
    info.content_type = info.content_type || 'application/octet-stream';
    info.etag = info.etag || '';
    info.create_time = md.create_time.getTime();
    if (_.isNumber(md.upload_size)) {
        info.upload_size = md.upload_size;
    }
    return info;
}

function load_bucket(req) {
    req.bucket = req.system.buckets_by_name[req.rpc_params.bucket];
}

function object_md_query(req) {
    return {
        system: req.system._id,
        bucket: req.bucket._id,
        key: req.rpc_params.key,
        deleted: null
    };
}

function find_object_md(req) {
    load_bucket(req);
    return P.fcall(function() {
            return db.ObjectMD.findOne(object_md_query(req)).exec();
        })
        .then(db.check_not_deleted(req, 'object'));
}

function find_cached_object_md(req) {
    load_bucket(req);
    return P.fcall(function() {
            return db.ObjectMDCache.get({
                system: req.system._id,
                bucket: req.bucket._id,
                key: req.rpc_params.key
            });
        })
        .then(db.check_not_deleted(req, 'object'));
}

function fail_obj_not_in_upload_mode(req, obj) {
    if (!_.isNumber(obj.upload_size)) {
        throw req.rpc_error('BAD_STATE', 'object not in upload mode ' + obj.key + ' size:' + obj.upload_size);
    }
}
