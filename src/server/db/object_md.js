/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var size_utils = require('../../util/size_utils');


/**
 *
 * OBJECT_MD SCHEMA
 *
 * the object meta-data (aka inode).
 *
 */
var objmd_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // every object belongs to a single bucket
    bucket: {
        ref: 'Bucket',
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

    // upload_mode flag for objects that were created but not written yet,
    // and this means they cannot be read yet.
    upload_mode: {
        type: Boolean,
    },

    create_time: {
        type: Date,
        default: Date.now,
        required: true,
    },

    // on delete set deletion time
    deleted: {
        type: Date,
    },

});

// the combination (bucket,key) is unique
objmd_schema.index({
    bucket: 1,
    key: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
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
        map: function() {
            /* global emit */
            emit(['', 'size'], this.size);
            emit(['', 'count'], 1);
            emit([this.bucket, 'size'], this.size);
            emit([this.bucket, 'count'], 1);
        },
        reduce: size_utils.reduce_sum
    }).then(function(res) {
        var buckets = {};
        _.each(res, function(r) {
            var b = buckets[r._id[0]] = buckets[r._id[0]] || {};
            b[r._id[1]] = r.value;
        });
        return buckets;
    });
};


var ObjectMD = module.exports = mongoose.model('ObjectMD', objmd_schema);
