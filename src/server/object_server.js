/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var restful_api = require('../util/restful_api');
var object_api = require('../api/object_api');
var account_server = require('./account_server');
var LRU = require('noobaa-util/lru');
var object_mapper = require('./object_mapper');
// db models
var Account = require('./models/account');
var Bucket = require('./models/bucket');
var ObjectMD = require('./models/object_md');
var EdgeNode = require('./models/edge_node');


module.exports = new object_api.Server({
    // bucket actions
    create_bucket: create_bucket,
    read_bucket: read_bucket,
    update_bucket: update_bucket,
    delete_bucket: delete_bucket,
    list_bucket_objects: list_bucket_objects,
    // object actions
    create_object: create_object,
    read_object_md: read_object_md,
    update_object_md: update_object_md,
    delete_object: delete_object,
    get_object_mappings: get_object_mappings,
    complete_upload: complete_upload,
    abort_upload: abort_upload,
}, [
    // middleware to verify the account session
    account_server.account_session
]);


function create_bucket(req) {
    var bucket_name = req.restful_params.bucket;
    return Q.fcall(function() {
        var info = {
            account: req.account.id,
            name: bucket_name,
        };
        return Bucket.create(info);
    }).then(function() {
        return undefined;
    });
}


function read_bucket(req) {
    var bucket_name = req.restful_params.bucket;
    return find_bucket(req.account.id, bucket_name, 'force').then(function(bucket) {
        return _.pick(bucket, 'name');
    });
}


function update_bucket(req) {
    var bucket_name = req.restful_params.bucket;
    return Q.fcall(function() {
        // TODO no fields can be updated for now
        var updates = _.pick(req.restful_params);
        var info = {
            account: req.account.id,
            name: bucket_name,
        };
        return Bucket.findOneAndUpdate(info, updates).exec();
    }).then(function() {
        return undefined;
    });
}


function delete_bucket(req) {
    var bucket_name = req.restful_params.bucket;
    // TODO mark deleted on objects
    return Q.fcall(function() {
        var info = {
            account: req.account.id,
            name: bucket_name,
        };
        return Bucket.findOneAndRemove(info).exec();
    }).then(function() {
        return undefined;
    });
}


function list_bucket_objects(req) {
    var bucket_name = req.restful_params.bucket;
    var key = req.restful_params.key;
    return find_bucket(req.account.id, bucket_name).then(function(bucket) {
        var info = {
            account: req.account.id,
            bucket: bucket.id,
            key: key,
        };
        return ObjectMD.find(info).exec();
    }).then(function(objects) {
        return {
            objects: _.map(objects, object_for_client),
        };
    });
}


function create_object(req) {
    var bucket_name = req.restful_params.bucket;
    var key = req.restful_params.key;
    var size = req.restful_params.size;
    return find_bucket(req.account.id, bucket_name).then(function(bucket) {
        var info = {
            account: req.account.id,
            bucket: bucket.id,
            key: key,
            size: size,
            upload_mode: true,
        };
        return ObjectMD.create(info);
    }).then(function() {
        return undefined;
    });
}


function read_object_md(req) {
    var bucket_name = req.restful_params.bucket;
    var key = req.restful_params.key;
    return find_bucket(req.account.id, bucket_name).then(function(bucket) {
        var info = {
            account: req.account.id,
            bucket: bucket.id,
            key: key,
        };
        return ObjectMD.findOne(info).exec();
    }).then(function(obj) {
        return object_for_client(obj);
    });
}


function update_object_md(req) {
    var bucket_name = req.restful_params.bucket;
    var key = req.restful_params.key;
    return find_bucket(req.account.id, bucket_name).then(function(bucket) {
        var info = {
            account: req.account.id,
            bucket: bucket.id,
            key: key,
        };
        // TODO no fields can be updated for now
        var updates = _.pick(req.restful_params);
        return ObjectMD.findOneAndUpdate(info, updates).exec();
    }).then(function() {
        return undefined;
    });
}


function delete_object(req) {
    var bucket_name = req.restful_params.bucket;
    var key = req.restful_params.key;
    return find_bucket(req.account.id, bucket_name).then(function(bucket) {
        var info = {
            account: req.account.id,
            bucket: bucket.id,
            key: key,
        };
        return ObjectMD.findOneAndRemove(info).exec();
    }).then(function() {
        return undefined;
    });
}


function get_object_mappings(req) {
    var bucket_name = req.restful_params.bucket;
    var key = req.restful_params.key;
    var start = Number(req.restful_params.start);
    var end = Number(req.restful_params.end);
    var obj, parts, blocks;
    return find_bucket(req.account.id, bucket_name).then(function(bucket) {
        var info = {
            account: req.account.id,
            bucket: bucket.id,
            key: key,
        };
        return ObjectMD.findOne(info).exec();
    }).then(function(obj_arg) {
        obj = obj_arg;
        return object_mapper.get_object_mappings(obj, start, end);
    });
}

function complete_upload(req) {
    var bucket_name = req.restful_params.bucket;
    var key = req.restful_params.key;
    return find_bucket(req.account.id, bucket_name).then(function(bucket) {
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
        return ObjectMD.findOneAndUpdate(info, updates).exec();
    }).then(function() {
        return undefined;
    });
}

function abort_upload(req) {
    var bucket_name = req.restful_params.bucket;
    var key = req.restful_params.key;
    return find_bucket(req.account.id, bucket_name).then(function(bucket) {
        var info = {
            account: req.account.id,
            bucket: bucket.id,
            key: key,
        };
        var updates = {
            upload_mode: true
        };
        return ObjectMD.findOneAndUpdate(info, updates).exec();
    }).then(function() {
        return undefined;
    });
}


// 10 minutes expiry
var buckets_lru = new LRU({
    max_length: 200,
    expiry_ms: 600000,
    name: 'buckets_lru'
});

function find_bucket(account_id, bucket_name, force) {
    return Q.fcall(function() {
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
        return Q.fcall(function() {
            return Bucket.findOne(info).exec();
        }).then(function(bucket) {
            if (!bucket) {
                throw new Error('NO BUCKET ' + bucket_name);
            }
            item.bucket = bucket;
            return bucket;
        });
    });
}

function object_for_client(md) {
    var o = _.pick(md, 'key', 'size', 'create_time', 'upload_mode');
    if (o.create_time) {
        o.create_time = o.create_time.toString();
    }
    return o;
}
