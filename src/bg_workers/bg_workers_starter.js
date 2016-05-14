'use strict';
// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('dotenv').load();

//If test mode, use Istanbuk for coverage
for (var i = 0; i < process.argv.length; ++i) {
    if (process.argv[i] === '--TESTRUN') {
        process.env.TESTRUN = 'true'; // must be string
    }
}
if (process.env.TESTRUN === 'true') {
    var ist = require('../test/framework/istanbul_coverage');
    ist.start_istanbul_coverage();
}

require('../util/panic');

var _ = require('lodash');
var url = require('url');
var dbg = require('../util/debug_module')(__filename);
var scrubber = require('../server/bg_services/scrubber');
var cloud_sync = require('../server/bg_services/cloud_sync');
var server_rpc = require('../server/server_rpc');
var mongo_client = require('../util/mongo_client').get_instance();
var mongoose_utils = require('../util/mongoose_utils');
var promise_utils = require('../util/promise_utils');


dbg.set_process_name('BGWorkers');
mongoose_utils.mongoose_connect();
mongo_client.connect();
register_rpc();


function register_rpc() {
    server_rpc.register_bg_services();
    server_rpc.register_common_services();
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
