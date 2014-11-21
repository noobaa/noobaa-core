/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var rest_api = require('../util/rest_api');
var object_api = require('../api/object_api');
var account_server = require('./account_server');
var LRU = require('noobaa-util/lru');
var object_mapper = require('./object_mapper');
var db = require('./db');


module.exports = new object_api.Server({
    // bucket actions
    list_buckets: list_buckets,
    create_bucket: create_bucket,
    read_bucket: read_bucket,
    update_bucket: update_bucket,
    delete_bucket: delete_bucket,
    list_bucket_objects: list_bucket_objects,
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
}, [
    // middleware to verify the account session
    account_server.account_session
]);


function list_buckets(req) {
    return Q.fcall(
        function() {
            return db.Bucket.find({
                account: req.account.id
            }).exec();
        }
    ).then(
        function(buckets) {
            return {
                buckets: _.map(buckets, function(bucket) {
                    return _.pick(bucket, 'name');
                })
            };
        }
    );
}


function create_bucket(req) {
    var bucket_name = req.rest_params.bucket;

    return Q.fcall(
        function() {
            var info = {
                account: req.account.id,
                name: bucket_name,
            };
            return db.Bucket.create(info);
        }
    ).thenResolve();
}


function read_bucket(req) {
    var bucket_name = req.rest_params.bucket;

    return find_bucket(req.account.id, bucket_name, 'force').then(
        function(bucket) {
            return _.pick(bucket, 'name');
        }
    );
}


function update_bucket(req) {
    var bucket_name = req.rest_params.bucket;

    return Q.fcall(
        function() {
            // TODO no fields can be updated for now
            var updates = _.pick(req.rest_params);
            var info = {
                account: req.account.id,
                name: bucket_name,
            };
            return db.Bucket.findOneAndUpdate(info, updates).exec();
        }
    ).thenResolve();
}


function delete_bucket(req) {
    var bucket_name = req.rest_params.bucket;
    // TODO mark deleted on objects and reclaim data blocks

    return Q.fcall(
        function() {
            var info = {
                account: req.account.id,
                name: bucket_name,
            };
            return db.Bucket.findOneAndRemove(info).exec();
        }
    ).thenResolve();
}


function list_bucket_objects(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return find_bucket(req.account.id, bucket_name).then(
        function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
            };
            if (key) {
                info.key = new RegExp(key);
            }
            return db.ObjectMD.find(info).exec();
        }
    ).then(
        function(objects) {
            return {
                objects: _.map(objects, function(obj) {
                    return {
                        key: obj.key,
                        info: get_object_info(obj),
                    };
                })
            };
        }
    );
}


function create_multipart_upload(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;
    var size = req.rest_params.size;

    return find_bucket(req.account.id, bucket_name).then(
        function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
                size: size,
                upload_mode: true,
            };
            return db.ObjectMD.create(info);
        }
    ).thenResolve();
}

function complete_multipart_upload(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return find_bucket(req.account.id, bucket_name).then(
        function(bucket) {
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
        }
    ).thenResolve();
}

function abort_multipart_upload(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return find_bucket(req.account.id, bucket_name).then(
        function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            var updates = {
                upload_mode: true
            };
            return db.ObjectMD.findOneAndUpdate(info, updates).exec();
        }
    ).thenResolve();
}

function allocate_object_part(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;
    var start = Number(req.rest_params.start);
    var end = Number(req.rest_params.end);
    var md5sum = req.rest_params.md5sum;

    return find_bucket(req.account.id, bucket_name).then(
        function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            return db.ObjectMD.findOne(info).exec();
        }
    ).then(
        function(obj) {
            if (!obj) {
                throw new Error('object not found');
            }
            if (!obj.upload_mode) {
                // TODO handle the upload_mode state
                // throw new Error('object not in upload mode');
            }
            return object_mapper.allocate_object_part(obj, start, end, md5sum);
        }
    );
}


function read_object_mappings(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;
    var start = Number(req.rest_params.start);
    var end = Number(req.rest_params.end);
    var obj;

    return find_bucket(req.account.id, bucket_name).then(
        function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            return db.ObjectMD.findOne(info).exec();
        }
    ).then(
        function(obj_arg) {
            obj = obj_arg;
            return object_mapper.read_object_mappings(obj, start, end);
        }
    ).then(
        function(parts) {
            return {
                size: obj.size,
                parts: parts,
            };
        }
    );
}


//////////////////////
// object meta-data //
//////////////////////

function read_object_md(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return find_bucket(req.account.id, bucket_name).then(
        function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            return db.ObjectMD.findOne(info).exec();
        }
    ).then(
        function(obj) {
            return get_object_info(obj);
        }
    );
}


function update_object_md(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return find_bucket(req.account.id, bucket_name).then(
        function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            // TODO no fields can be updated for now
            var updates = _.pick(req.rest_params);
            return db.ObjectMD.findOneAndUpdate(info, updates).exec();
        }
    ).thenResolve();
}


function delete_object(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return find_bucket(req.account.id, bucket_name).then(
        function(bucket) {
            var info = {
                account: req.account.id,
                bucket: bucket.id,
                key: key,
            };
            return db.ObjectMD.findOneAndRemove(info).exec();
        }
    ).thenResolve();
}



// 10 minutes expiry
var buckets_lru = new LRU({
    max_length: 200,
    expiry_ms: 600000,
    name: 'buckets_lru'
});

function find_bucket(account_id, bucket_name, force) {
    return Q.fcall(
        function() {
            var item = buckets_lru.find_or_add_item(account_id + ':' + bucket_name);
            // use cached bucket if not expired
            if (item.bucket && force !== 'force') {
                return item.bucket;
            }
            // fetch account from the database
            var info = {
                account: account_id,
                name: bucket_name,
            };
            console.log('BUCKET MISS', info);
            return Q.fcall(
                function() {
                    return db.Bucket.findOne(info).exec();
                }
            ).then(
                function(bucket) {
                    if (!bucket) {
                        throw new Error('NO BUCKET ' + bucket_name);
                    }
                    item.bucket = bucket;
                    return bucket;
                }
            );
        }
    );
}

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
