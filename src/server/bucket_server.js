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
 * BUCKET SERVER (REST)
 *
 */
module.exports = new api.bucket_api.Server({
    create_bucket: create_bucket,
    read_bucket: read_bucket,
    update_bucket: update_bucket,
    delete_bucket: delete_bucket,
    list_buckets: list_buckets,
});



/**
 *
 * CREATE_BUCKET
 *
 */
function create_bucket(req) {
    var name = req.rest_params.name;

    return Q.fcall(function() {
        var info = _.pick(req.rest_params, 'name');
        info.system = req.system.id;
        return db.Bucket.create(info);
    }).thenResolve();
}



/**
 *
 * READ_BUCKET
 *
 */
function read_bucket(req) {
    return Q.when(db.Bucket.findOne(get_bucket_query(req)).exec())
        .then(function(bucket) {
            return _.pick(bucket, 'name');
        });
}



/**
 *
 * UPDATE_BUCKET
 *
 */
function update_bucket(req) {
    return Q.fcall(function() {
        // TODO no fields can be updated for now
        var updates = _.pick(req.rest_params);
        return db.Bucket.findOneAndUpdate(get_bucket_query(req), updates).exec();
    }).thenResolve();
}



/**
 *
 * DELETE_BUCKET
 *
 */
function delete_bucket(req) {
    return Q.fcall(function() {
        var updates = {
            deleted: new Date()
        };
        return db.Bucket.findOneAndUpdate(get_bucket_query(req), updates).exec();
    }).thenResolve();
}



/**
*
* LIST_BUCKETS
*
*/
function list_buckets(req) {
    return Q.when(db.Bucket.find({
        system: req.system.id,
        deleted: null,
    }).exec()).then(function(buckets) {
        return {
            buckets: _.map(buckets, function(bucket) {
                return _.pick(bucket, 'name');
            })
        };
    });
}



// UTILS //////////////////////////////////////////////////////////


function get_bucket_query(req) {
    return {
        system: req.system.id,
        name: req.rest_params.name,
        deleted: null,
    };
}
