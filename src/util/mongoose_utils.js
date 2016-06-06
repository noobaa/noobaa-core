'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var P = require('./promise');
var dbg = require('./debug_module')(__filename);
var mongoose_logger = require('./mongoose_logger');

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

var MONGO_REPLICA_SET =
    process.env.MONGO_REPLICA_SET ||
    '';

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

function mongoose_connect() {
    console.log('mongoose_connect');
    clearTimeout(mongoose_timeout);
    mongoose_timeout = null;
    var url = MONGODB_URL;
    if (MONGO_REPLICA_SET !== '') {
        url += '?replicaSet=' + MONGO_REPLICA_SET;
    }
    if (!mongoose_connected) {
        dbg.log0('connecting mongoose to', url);
        mongoose.connect(url);
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


//Update connections string according to configured RS
function mongoose_update_connection_string() {
    var rs = process.env.MONGO_REPLICA_SET || '';
    dbg.log0('in mongoose_update_connection_string. rs =', rs, ' MONGO_REPLICA_SET =', MONGO_REPLICA_SET);
    if (rs !== MONGO_REPLICA_SET) {
        dbg.log0('different rs and MONGO_REPLICA_SET. rs =', rs, ' MONGO_REPLICA_SET =', MONGO_REPLICA_SET);
        //disconenct
        mongoose.disconnect(function() {
            mongoose_connected = false;
            mongoose_timeout = null;
            MONGO_REPLICA_SET = rs;
            dbg.log0('disconnected mongoose. now going to connect with new connection string:', MONGO_REPLICA_SET);
            //now connect
            mongoose_connect();
        });
    }
}


// this ObjectId is a function that generates mongo ObjectId.
// notice that this is not the same as mongoose.Schema.Types.ObjectId
// which is used in schema definitions. this mongoose duality will probably
// be confusing and buggy...
exports.new_object_id = mongoose.Types.ObjectId;
exports.mongoose_connect = mongoose_connect;
exports.mongoose_ensure_indexes = mongoose_ensure_indexes;
exports.mongoose_wait_connected = mongoose_wait_connected;
exports.mongoose_update_connection_string = mongoose_update_connection_string;
