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


module.exports = new api.bucket_api.Server({
    // bucket actions
    list_buckets: list_buckets,
    create_bucket: create_bucket,
    read_bucket: read_bucket,
    update_bucket: update_bucket,
    delete_bucket: delete_bucket,
    list_bucket_objects: list_bucket_objects,
}, {
    before: before
});


function before(req) {
    return req.load_system(['admin']);
}


function list_buckets(req) {
    return Q.when(db.Bucket.find({
            account: req.account.id
        }).exec())
        .then(function(buckets) {
            return {
                buckets: _.map(buckets, function(bucket) {
                    return _.pick(bucket, 'name');
                })
            };
        });
}


function create_bucket(req) {
    var bucket_name = req.rest_params.bucket;

    return Q.fcall(function() {
        var info = {
            account: req.account.id,
            name: bucket_name,
        };
        return db.Bucket.create(info);
    }).thenResolve();
}


function read_bucket(req) {
    var bucket_name = req.rest_params.bucket;

    return db.BucketCache.get({
            system: req.system.id,
            name: bucket_name,
        }, 'force_miss')
        .then(function(bucket) {
            return _.pick(bucket, 'name');
        });
}


function update_bucket(req) {
    var bucket_name = req.rest_params.bucket;

    return Q.fcall(function() {
        // TODO no fields can be updated for now
        var updates = _.pick(req.rest_params);
        var info = {
            account: req.account.id,
            name: bucket_name,
        };
        return db.Bucket.findOneAndUpdate(info, updates).exec();
    }).thenResolve();
}


function delete_bucket(req) {
    var bucket_name = req.rest_params.bucket;
    // TODO mark deleted on objects and reclaim data blocks

    return Q.fcall(function() {
        var info = {
            account: req.account.id,
            name: bucket_name,
        };
        return db.Bucket.findOneAndRemove(info).exec();
    }).thenResolve();
}


function list_bucket_objects(req) {
    var bucket_name = req.rest_params.bucket;
    var key = req.rest_params.key;

    return db.BucketCache.get({
        system: req.system.id,
        name: bucket_name,
    }).then(function(bucket) {
        var info = {
            account: req.account.id,
            bucket: bucket.id,
        };
        if (key) {
            info.key = new RegExp(key);
        }
        return db.ObjectMD.find(info).exec();
    }).then(function(objects) {
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
