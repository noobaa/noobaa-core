'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var mongoose = require('mongoose');
var mongoose_logger = require('../../util/mongoose_logger');
var dbg = require('../../util/debug_module')(__filename);


var LRUCache = require('../../util/lru_cache');
var ObjectMD = require('./object_md');
var ObjectPart = require('./object_part');
var DataChunk = require('./data_chunk');
var DataBlock = require('./data_block');
var ActivityLog = require('./activity_log');
// var dbg = require('../util/debug_module')(__filename);
var debug_mode = (process.env.DEBUG_MODE === 'true');
var mongoose_connected = false;
var mongoose_timeout = null;

// connect to the database
if (debug_mode) {
    mongoose.set('debug', mongoose_logger(dbg.log0.bind(dbg)));
}

var MONGODB_URL =
    process.env.MONGODB_URL ||
    process.env.MONGOHQ_URL ||
    process.env.MONGOLAB_URI ||
    'mongodb://127.0.0.1/nbcore';

mongoose.connection.on('connected', function() {
    // call ensureIndexes explicitly for each model
    console.log('mongoose connection connected');
    mongoose_connected = true;
    mongoose_ensure_indexes();
});

mongoose.connection.on('error', function(err) {
    mongoose_connected = false;
    console.error('mongoose connection error:', err);
    if (!mongoose_timeout) {
        mongoose_timeout = setTimeout(mongoose_connect, 5000);
    }

});

mongoose.connection.on('disconnected', function() {
    mongoose_connected = false;
    console.error('mongoose connection disconnected');
    if (!mongoose_timeout) {
        mongoose_timeout = setTimeout(mongoose_connect, 5000);
    }
});


/**
 *
 * DB FOLDER INDEX
 *
 * fast require of all the db related functionality.
 *
 */
module.exports = {

    // this ObjectId is a function that generates mongo ObjectId.
    // notice that this is not the same as mongoose.Schema.Types.ObjectId
    // which is used in schema definitions. this mongoose duality will probably
    // be confusing and buggy...
    new_object_id: mongoose.Types.ObjectId,

    ObjectMD: ObjectMD,
    ObjectPart: ObjectPart,
    DataChunk: DataChunk,
    DataBlock: DataBlock,
    ActivityLog: ActivityLog,

    mongoose_connect: mongoose_connect,
    mongoose_ensure_indexes: mongoose_ensure_indexes,
    mongoose_wait_connected: mongoose_wait_connected,

    check_not_found: check_not_found,
    check_not_deleted: check_not_deleted,
    check_already_exists: check_already_exists,
    is_err_exists: is_err_exists,

    // short living cache for objects
    // the purpose is to reduce hitting the DB many many times per second during upload/download.
    ObjectMDCache: new LRUCache({
        name: 'ObjectMDCache',
        max_length: 1000,
        expiry_ms: 1000, // 1 second of blissfull ignorance
        make_key: function(params) {
            return params.system + ':' + params.bucket + ':' + params.key;
        },
        load: function(params) {
            console.log('ObjectMDCache: load', params.name);
            return P.when(ObjectMD.findOne({
                system: params.system,
                bucket: params.bucket,
                key: params.key,
                deleted: null,
            }).exec());
        }
    }),
};

function mongoose_connect() {
    console.log('mongoose_connect');
    clearTimeout(mongoose_timeout);
    mongoose_timeout = null;
    if (!mongoose_connected) {
        mongoose.connect(MONGODB_URL);
    }
}

function mongoose_wait_connected() {
    return new P((resolve, reject) => {
        if (mongoose_connected) {
            resolve();
        } else {
            mongoose.connection.once('connected', resolve);
            mongoose.connection.once('error', reject);
        }
    });
}

// after dropDatabase() we need to recreate the indexes
// otherwise we get "MongoError: ns doesn't exist"
// see https://github.com/LearnBoost/mongoose/issues/2671
function mongoose_ensure_indexes() {
    return P.all(_.map(mongoose.modelNames(), function(model_name) {
        return P.npost(mongoose.model(model_name), 'ensureIndexes');
    }));
}

function check_not_found(req, entity) {
    return function(doc) {
        if (!doc) {
            if (typeof(req) !== 'undefined') {
                throw req.rpc_error('NOT_FOUND', entity + ' not found');
            } else {
                throw new Error('NOT_FOUND', entity + ' not found');
            }
        }
        return doc;
    };
}

function check_not_deleted(req, entity) {
    return function(doc) {
        if (!doc || doc.deleted) {
            if (typeof(req) !== 'undefined') {
                throw req.rpc_error('NOT_FOUND', entity + ' not found');
            } else {
                throw new Error('NOT_FOUND', entity + ' not found');
            }
        }
        return doc;
    };
}

function check_already_exists(req, entity) {
    return function(err) {
        if (is_err_exists(err)) {
            if (typeof(req) !== 'undefined') {
                throw req.rpc_error('CONFLICT', entity + ' already exists');
            } else {
                throw new Error('CONFLICT', entity + ' already exists');
            }
        }
        throw err;
    };
}

function is_err_exists(err) {
    return err && err.code === 11000;
}
