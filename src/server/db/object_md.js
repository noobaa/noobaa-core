/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var mongo_functions = require('../../util/mongo_functions');


/**
 *
 * OBJECT_MD SCHEMA
 *
 * the object meta-data (aka inode).
 *
 */
var objmd_schema = new Schema({

    system: {
        // ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // every object belongs to a single bucket
    bucket: {
        // ref: 'Bucket',
        type: types.ObjectId,
        required: true,
    },

    // the object key is sort of a path in the bucket namespace
    key: {
        type: String,
        required: true,
    },

    // size in bytes
    size: {
        type: Number,
    },

    // MIME
    content_type: {
        type: String,
        required: true,
    },

    // upload_size is filled for objects while uploading,
    // and ultimatly removed once the write is done
    upload_size: {
        type: Number,
    },

    create_time: {
        type: Date,
        default: Date.now,
        required: true,
    },

    etag: {
        type: String,
    },

    // is the object synced with the cloud
    cloud_synced: {
        type: Boolean,
    },

    // xattr saved as free form object
    xattr: {},

    // Statistics
    stats: {
        reads: {
            type: Number,
        }
    },

    // on delete set deletion time
    //see relation to cloud_synced, if deleted will ever be actually
    //remove from the DB, need to wait until its cloud_synced === true
    deleted: {
        type: Date,
    },

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

// the combination (bucket,key) is unique
objmd_schema.index({
    bucket: 1,
    key: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
});

// Index according to cloud_sync
objmd_schema.index({
    bucket: 1,
    cloud_synced: 1,
    deleted: 1,
}, {
    unique: false
});

/**
 *
 * aggregate_objects
 *
 * counts the number of objects and sum of sizes, both for the entire query, and per bucket.
 *
 * @return <Object> buckets - the '' key represents the entire query and others are bucket ids.
 *      each bucket value is an object with properties: size, count.
 *
 */
objmd_schema.statics.aggregate_objects = function(query) {
    return this.mapReduce({
        query: query,
        map: mongo_functions.map_aggregate_objects,
        reduce: mongo_functions.reduce_sum
    }).then(function(res) {
        var buckets = {};
        _.each(res, function(r) {
            var b = buckets[r._id[0]] = buckets[r._id[0]] || {};
            b[r._id[1]] = r.value;
        });
        return buckets;
    });
};


module.exports = mongoose.model('ObjectMD', objmd_schema);
