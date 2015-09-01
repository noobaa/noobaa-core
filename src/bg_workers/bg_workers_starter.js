'use strict';
require('../util/panic');

var dotenv = require('dotenv');
var _ = require('lodash');
var P = require('../util/promise');
var mongoose = require('mongoose');
var http = require('http');
var promise_utils = require('../util/promise_utils');
var cloud_sync = require('./cloud_sync');
var build_chunks = require('./build_chunks_worker');
var dbg = require('../util/debug_module')(__filename);
var mongoose_logger = require('../util/mongoose_logger');

//Global Configuration and Initialization
console.log('loading .env file ( no foreman ;)');
dotenv.load();


//TODO:: move all this to db index (function and direct call)
var debug_mode = (process.env.DEBUG_MODE === 'true');
var mongoose_connected = false;
var mongoose_timeout = null;

// connect to the database
if (debug_mode) {
    mongoose.set('debug', mongoose_logger(dbg.log0.bind(dbg)));
}

mongoose.connection.once('open', function() {
    // call ensureIndexes explicitly for each model
    mongoose_connected = true;
    return P.all(_.map(mongoose.modelNames(), function(model_name) {
        return P.npost(mongoose.model(model_name), 'ensureIndexes');
    }));
});

mongoose.connection.on('error', function(err) {
    mongoose_connected = false;
    console.error('mongoose connection error:', err);
    if (!mongoose_timeout) {
        mongoose_timeout = setTimeout(mongoose_conenct, 5000);
    }

});

function mongoose_conenct() {
    clearTimeout(mongoose_timeout);
    mongoose_timeout = null;
    if (!mongoose_connected) {
        mongoose.connect(
            process.env.MONGOHQ_URL ||
            process.env.MONGOLAB_URI ||
            'mongodb://localhost/nbcore');
    }
}

mongoose_conenct();

var server_rpc;
var http_server;

function register_rpc() {
    server_rpc = require('./bg_workers_rpc');

    http_server = http.createServer();
    P.fcall(function() {
            return P.ninvoke(http_server, 'listen', 5002);
        })
        .then(function() {
            server_rpc.register_ws_transport(http_server);
        });
}

register_rpc();

function register_bg_worker(options, run_batch_function) {
    if (!options.name || !_.isFunction(run_batch_function)) {
        console.error('Name and run function must be supplied for registering bg worker', options.name);
        throw new Error('Name and run function must be supplied for registering bg worker ' + options.name);
    }

    dbg.log0('Registering', options.name, 'bg worker');
    options.run_batch = run_batch_function;
    promise_utils.run_background_worker(options);
}

register_bg_worker({
    name: 'cloud_sync_refresher'
}, cloud_sync.background_worker);

if (process.env.BUILD_WORKER_DISABLED !== 'true') {
    register_bg_worker({
        name: 'build_chunks_worker',
        batch_size: 50,
        time_since_last_build: 60000 /* TODO increase...*/ ,
        building_timeout: 300000 /* TODO increase...*/ ,
    }, build_chunks.background_worker);
}
