'use strict';
// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('dotenv').load();

//If test mode, use Istanbuk for coverage
for (var i = 0; i < process.argv.length; ++i) {
    if (process.argv[i] === '--TESTRUN') {
        process.env.TESTRUN = true;
    }
}
if (process.env.TESTRUN === 'true') {
    var ist = require('../test/framework/istanbul_coverage');
    ist.start_istanbul_coverage();
}

require('../util/panic');

var _ = require('lodash');
var url = require('url');
var promise_utils = require('../util/promise_utils');
var cloud_sync = require('./cloud_sync');
var system_store = require('../server/stores/system_store');
var account_server = require('../server/account_server');
var scrubber = require('./scrubber');
var server_rpc = require('../server/server_rpc');
var dbg = require('../util/debug_module')(__filename);
var db = require('../server/db');
var mongo_client = require('../server/utils/mongo_client');


dbg.set_process_name('BGWorkers');
db.mongoose_connect();
mongo_client.connect();
system_store.on('load', account_server.ensure_support_account);
register_rpc();


function register_rpc() {
    server_rpc.register_bg_servers();
    server_rpc.register_common_servers();
    let http_port = url.parse(server_rpc.rpc.router.bg).port;
    return server_rpc.rpc.start_http_server({
        port: http_port,
        ws: true,
        logging: true,
        secure: false,
    });
}


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

if (process.env.SCRUBBER_DISABLED !== 'true') {
    register_bg_worker({
        name: 'scrubber',
        batch_size: 1000,
        time_since_last_build: 60000, // TODO increase?
        building_timeout: 300000, // TODO increase?
    }, scrubber.background_worker);
}

dbg.log('BG Workers Server started');
