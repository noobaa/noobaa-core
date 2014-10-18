/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var restful_api = require('../util/restful_api');
var object_api = require('../api/object_api');
var account_server = require('./account_server');
var LRU = require('noobaa-util/lru');
// db models
var Account = require('./models/account');
var Bucket = require('./models/bucket');
var ObjectMD = require('./models/object_md');
var ObjectPart = require('./models/object_part');
var DataChunk = require('./models/data_chunk');
var DataBlock = require('./models/data_block');
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
        return Bucket.findOneAndUpdate(info, updates).exec();
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
        return Bucket.findOneAndRemove(info).exec();
    }).then(function() {
        return undefined;
    });
}


function get_object_mappings(req) {
    var bucket_name = req.restful_params.bucket;
    var key = req.restful_params.key;
    var start = req.restful_params.start || 0;
    var end = typeof(req.restful_params.end) !== 'undefined' ?
        req.restful_params.end : Infinity;
    var obj, parts;
    return find_bucket(req.account.id, bucket_name).then(function(bucket) {
        var info = {
            account: req.account.id,
            bucket: bucket.id,
            key: key,
        };
        return ObjectMD.findOne(info).exec();
    }).then(function(obj_arg) {
        obj = obj_arg;
        return ObjectPart.find({
            obj: obj.id,
            // find parts intersecting the [start,end) range
            start: {
                $lt: end
            },
            end: {
                $gt: start
            },
        }).populate('chunk').exec();
    }).then(function(parts_arg) {
        parts = parts_arg;
        return DataBlock.find({
            chunk: {
                $in: _.pluck(parts, '_id')
            }
        }).populate('node').exec();
    }).then(function(blocks) {
        // TODO check and create missing parts/chunks/blocks
        // TODO TEST CODE
        blocks = _.times(10, function(i) {
            return {
                chunk: '0',
                id: '' + i,
                index: i,
                node: {
                    id: '' + i,
                    ip: '0.0.0.0',
                    port: 0
                }
            };
        });
        parts = [{
            start: start,
            end: end,
            chunk_offset: 0,
            chunk: {
                id: '0',
                kblocks: 10,
            }
        }];
        var blocks_by_chunk = _.groupBy(blocks, 'chunk');
        var reply = {
            parts: _.map(parts, function(part) {
                var p = _.pick(part, 'start', 'end', 'chunk_offset');
                p.kblocks = part.chunk.kblocks;
                p.blocks = _.map(blocks_by_chunk[part.chunk.id], function(block) {
                    return {
                        id: block.id,
                        index: block.index,
                        node: _.pick(block.node, 'id', 'ip', 'port')
                    };
                });
                return p;
            })
        };
        console.log(reply);
        return reply;
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
    return _.pick(md, 'key', 'size', 'create_time');
}
