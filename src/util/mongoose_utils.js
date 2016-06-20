'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var P = require('./promise');
var dbg = require('./debug_module')(__filename);
var mongoose_logger = require('./mongoose_logger');

var debug_mode = (process.env.DEBUG_MODE === 'true');
var mongoose_connected = false;
var mongoose_disconnected = false;
var mongoose_timeout = null;

mongoose.Promise = P; // see http://mongoosejs.com/docs/promises.html

// connect to the database
if (debug_mode) {
    dbg.log0('setting debug logger for mongoose to dbg.log1');
    mongoose.set('debug', mongoose_logger(dbg.log1.bind(dbg)));
}

var MONGODB_URL =
    process.env.MONGO_RS_URL ||
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
    if (!mongoose_timeout && !mongoose_disconnected) {
        mongoose_timeout = setTimeout(mongoose_connect, 5000);
    }

});

mongoose.connection.on('disconnected', function() {
    mongoose_connected = false;
    console.error('mongoose connection disconnected t/o', mongoose_timeout,
        'mongoose_disconnected', mongoose_disconnected);
    if (!mongoose_timeout && !mongoose_disconnected) {
        mongoose_timeout = setTimeout(mongoose_connect, 5000);
    }
});

function mongoose_connect() {
    console.log('called mongoose_connect');
    clearTimeout(mongoose_timeout);
    mongoose_timeout = null;
    mongoose_disconnected = false;
    var new_url = MONGODB_URL;
    if (!mongoose_connected) {
        dbg.log0('connecting mongoose to', new_url);
        mongoose.connect(new_url);
    }
}

function mongoose_disconnect() {
    console.log('called mongoose_disconnect');
    mongoose_disconnected = true;
    mongoose_connected = false;
    mongoose_timeout = null;
    return mongoose.disconnect();
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
        return mongoose.model(model_name).ensureIndexes(); // returns promise
    }));
}


//Update connections string according to configured RS
function mongoose_update_connection_string() {
    dbg.log0('updating mongoose connection string from', MONGODB_URL, 'to', process.env.MONGO_RS_URL);
    MONGODB_URL = process.env.MONGO_RS_URL;
}


// this ObjectId is a function that generates mongo ObjectId.
// notice that this is not the same as mongoose.Schema.Types.ObjectId
// which is used in schema definitions. this mongoose duality will probably
// be confusing and buggy...
exports.new_object_id = mongoose.Types.ObjectId;
exports.mongoose_connect = mongoose_connect;
exports.mongoose_disconnect = mongoose_disconnect;
exports.mongoose_ensure_indexes = mongoose_ensure_indexes;
exports.mongoose_wait_connected = mongoose_wait_connected;
exports.mongoose_update_connection_string = mongoose_update_connection_string;
