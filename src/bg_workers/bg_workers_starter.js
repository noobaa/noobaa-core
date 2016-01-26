'use strict';
require('../util/panic');

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('dotenv').load();

var _ = require('lodash');
var P = require('../util/promise');
var http = require('http');
var promise_utils = require('../util/promise_utils');
var cloud_sync = require('./cloud_sync');
var build_chunks = require('./build_chunks_worker');
var dbg = require('../util/debug_module')(__filename);
var db = require('../server/db');
var mongo_client = require('../server/stores/mongo_client');


dbg.set_process_name('BGWorkers');

db.mongoose_connect();
mongo_client.connect();

var bg_workers_rpc;
var http_server;

function register_rpc() {
    require('./bg_workers_rpc').register_servers();
    bg_workers_rpc = require('./bg_workers_rpc').bg_workers_rpc;

    http_server = http.createServer();
    P.fcall(function() {
            return P.ninvoke(http_server, 'listen', bg_workers_rpc.get_default_base_port('background'));
        })
        .then(function() {
            bg_workers_rpc.register_ws_transport(http_server);
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

dbg.log('BG Workers Server started');
