/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 *
 * OBJECT_STATS SCHEMA
 *
 * Collected counters to know S3 Usage
 *
 */
var object_stats_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    time: {
        type: Date,
        default: Date.now,
        required: true,
    },

    s3_usage_info: {
        prepare_request: Number,
        list_buckets: Number,
        head_bucket: Number,
        get_bucket: Number,
        get_bucket_versions: Number,
        get_bucket_uploads: Number,
        put_bucket: Number,
        delete_bucket: Number,
        post_bucket_delete: Number,
        get_bucket_acl: Number,
        put_bucket_acl: Number,
        get_bucket_location: Number,
        head_object: Number,
        get_object: Number,
        put_object: Number,
        copy_object: Number,
        delete_object: Number,
        get_object_acl: Number,
        put_object_acl: Number,
        post_object_uploads: Number,
        post_object_uploadId: Number,
        delete_object_uploadId: Number,
        get_object_uploadId: Number,
        put_object_uploadId: Number,
    },

    // level: {
    //     type: String,
    //     enum: ['info', 'warning', 'alert'],
    //     required: true,
    // },
    //
    // event: {
    //     type: String,
    //     required: true,
    // },
    //
    // desc: {
    //     type: String,
    // },
    //
    // tier: {
    //     // ref: 'Tier',
    //     type: types.ObjectId,
    // },
    // node: {
    //     ref: 'Node',
    //     type: types.ObjectId,
    // },
    // bucket: {
    //     // ref: 'Bucket',
    //     type: types.ObjectId,
    // },
    // obj: {
    //     ref: 'ObjectMD',
    //     type: types.ObjectId,
    // },
    // account: {
    //     // ref: 'Account',
    //     type: types.ObjectId,
    // },
    // pool: {
    //     //ref: 'Pool',
    //     type: types.ObjectId,
    // },
    // //The User that performed the action
    // actor: {
    //     // ref: 'Account',
    //     type: types.ObjectId
    // }
}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

object_stats_schema.index({
    system: 1,
    time: 1,
}, {
    unique: false
});


module.exports = mongoose.model('ObjectStats', object_stats_schema);
