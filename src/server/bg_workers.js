/* Copyright (C) 2016 NooBaa */
'use strict';

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('../util/dotenv').load();

//If test mode, use Istanbuk for coverage
for (var i = 0; i < process.argv.length; ++i) {
    if (process.argv[i] === '--TESTRUN') {
        process.env.TESTRUN = 'true'; // must be string
    }
}
if (process.env.TESTRUN === 'true') {
    // eslint-disable-next-line global-require
    var ist = require('../test/framework/istanbul_coverage');
    ist.start_istanbul_coverage();
}

require('../util/panic');

var _ = require('lodash');
var url = require('url');
var http = require('http');
var https = require('https');
var dbg = require('../util/debug_module')(__filename);
var config = require('../../config.js');
var scrubber = require('./bg_services/scrubber');
var lifecycle = require('./bg_services/lifecycle');
var cloud_sync = require('./bg_services/cloud_sync');
var cluster_hb = require('./bg_services/cluster_hb');
var server_rpc = require('./server_rpc');
var mongo_client = require('../util/mongo_client');
var cluster_master = require('./bg_services/cluster_master');
var stats_aggregator = require('./system_services/stats_aggregator');
var usage_aggregator = require('./bg_services/usage_aggregator');
var md_aggregator = require('./bg_services/md_aggregator');
var background_scheduler = require('../util/background_scheduler').get_instance();
var stats_collector = require('./bg_services/stats_collector');
var dedup_indexer = require('./bg_services/dedup_indexer');

const MASTER_BG_WORKERS = [
    'scrubber',
    'cloud_sync_refresher',
    'system_server_stats_aggregator',
    'md_aggregator',
    'usage_aggregator',
    'dedup_indexer'
];

dbg.set_process_name('BGWorkers');
mongo_client.instance().connect();
register_rpc();

//Set KeepAlive to all http/https agents in bg_workers
http.globalAgent.keepAlive = true;
https.globalAgent.keepAlive = true;


function register_rpc() {
    server_rpc.register_bg_services();
    server_rpc.register_common_services();
    const u = url.parse(server_rpc.rpc.router.bg);
    return server_rpc.rpc.start_http_server({
        port: u.port,
        protocol: u.protocol,
        logging: true,
    });
}


function register_bg_worker(options, run_batch_function) {
    if (!options.name || !_.isFunction(run_batch_function)) {
        console.error('Name and run function must be supplied for registering bg worker', options.name);
        throw new Error('Name and run function must be supplied for registering bg worker ' + options.name);
    }

    dbg.log0('Registering', options.name, 'bg worker');
    options.run_batch = run_batch_function;
    background_scheduler.run_background_worker(options);
}

function remove_master_workers() {
    MASTER_BG_WORKERS.forEach(worker_name => {
        background_scheduler.remove_background_worker(worker_name);
    });

}

function run_master_workers() {
    if (config.central_stats.send_stats === 'true' && config.PHONE_HOME_BASE_URL) {
        register_bg_worker({
            name: 'system_server_stats_aggregator',
            delay: config.central_stats.send_time_cycle,
        }, stats_aggregator.background_worker);
    }

    register_bg_worker({
        name: 'cloud_sync_refresher'
    }, cloud_sync.background_worker);

    register_bg_worker({
        name: 'md_aggregator',
        delay: config.MD_AGGREGATOR_INTERVAL
    }, md_aggregator.background_worker);

    register_bg_worker({
        name: 'usage_aggregator',
        delay: config.USAGE_AGGREGATOR_INTERVAL
    }, usage_aggregator.background_worker);

    if (config.SCRUBBER_ENABLED) {
        register_bg_worker({
            name: 'scrubber',
        }, scrubber.background_worker);
    } else {
        dbg.warn('SCRUBBER NOT ENABLED');
    }

    if (config.DEDUP_INDEXER_ENABLED) {
        register_bg_worker({
            name: 'dedup_indexer',
        }, dedup_indexer.background_worker);
    } else {
        dbg.warn('DEDUP INDEXER NOT ENABLED');
    }

    if (config.LIFECYCLE_DISABLED !== 'true') {
        register_bg_worker({
            name: 'lifecycle',
            delay: config.LIFECYCLE_INTERVAL,
        }, lifecycle.background_worker);
    }

    if (config.STATISTICS_COLLECTOR_ENABLED) {
        register_bg_worker({
            name: 'statistics_collector',
            delay: config.STATISTICS_COLLECTOR_INTERVAL
        }, stats_collector.collect_all_stats);
    }
}

register_bg_worker({
    name: 'cluster_master_publish',
    delay: config.CLUSTER_MASTER_INTERVAL,
    run_immediate: true
}, cluster_master.background_worker);

register_bg_worker({
    name: 'cluster_heartbeat_writer',
    delay: config.CLUSTER_HB_INTERVAL,
    run_immediate: true
}, cluster_hb.do_heartbeat);

dbg.log('BG Workers Server started');

// EXPORTS
exports.run_master_workers = run_master_workers;
exports.remove_master_workers = remove_master_workers;
