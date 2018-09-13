/* Copyright (C) 2016 NooBaa */
'use strict';

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('../util/dotenv').load();

require('../util/coverage_utils');
require('../util/panic');

var _ = require('lodash');
var url = require('url');
var http = require('http');
var https = require('https');
var dbg = require('../util/debug_module')(__filename);
var config = require('../../config.js');
var scrubber = require('./bg_services/scrubber');
var lifecycle = require('./bg_services/lifecycle');
var cluster_hb = require('./bg_services/cluster_hb');
var server_rpc = require('./server_rpc');
var mongo_client = require('../util/mongo_client');
var { MirrorWriter } = require('./bg_services/mirror_writer');
var { TieringTTFWorker } = require('./bg_services/tier_ttf_worker');
var { TieringSpillbackWorker } = require('./bg_services/tier_spillback_worker');
var cluster_master = require('./bg_services/cluster_master');
var AgentBlocksVerifier = require('./bg_services/agent_blocks_verifier').AgentBlocksVerifier;
var AgentBlocksReclaimer = require('./bg_services/agent_blocks_reclaimer').AgentBlocksReclaimer;
var stats_aggregator = require('./system_services/stats_aggregator');
var aws_usage_metering = require('./system_services/aws_usage_metering');
var usage_aggregator = require('./bg_services/usage_aggregator');
var md_aggregator = require('./bg_services/md_aggregator');
var background_scheduler = require('../util/background_scheduler').get_instance();
var stats_collector = require('./bg_services/stats_collector');
var dedup_indexer = require('./bg_services/dedup_indexer');
var db_cleaner = require('./bg_services/db_cleaner');

const MASTER_BG_WORKERS = [
    'scrubber',
    'mirror_writer',
    'tier_mover',
    'system_server_stats_aggregator',
    'md_aggregator',
    'usage_aggregator',
    'dedup_indexer',
    'db_cleaner',
    'aws_usage_metering',
    'agent_blocks_verifier',
    'agent_blocks_reclaimer'
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


function register_bg_worker(worker, run_batch_function) {
    dbg.log0('Registering', worker.name, 'bg worker');
    if (run_batch_function) {
        worker.run_batch = run_batch_function;
    }
    if (!worker.name || !_.isFunction(worker.run_batch)) {
        console.error('Name and run function must be supplied for registering bg worker', worker.name);
        throw new Error('Name and run function must be supplied for registering bg worker ' + worker.name);
    }
    background_scheduler.run_background_worker(worker);
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

    if (config.MIRROR_WRITER_ENABLED) {
        register_bg_worker(new MirrorWriter({
            name: 'mirror_writer',
            client: server_rpc.client
        }));
    } else {
        dbg.warn('MIRROR_WRITER NOT ENABLED');
    }

    if (config.TIER_TTF_WORKER_ENABLED) {
        register_bg_worker(new TieringTTFWorker({
            name: 'tier_ttf_worker',
            client: server_rpc.client
        }));
    } else {
        dbg.warn('TTF_WORKER NOT ENABLED');
    }

    if (config.TIER_SPILLBACK_WORKER_ENABLED) {
        register_bg_worker(new TieringSpillbackWorker({
            name: 'tier_spillover_worker',
            client: server_rpc.client
        }));
    } else {
        dbg.warn('SPILLBACK_WORKER NOT ENABLED');
    }

    if (config.DEDUP_INDEXER_ENABLED) {
        register_bg_worker({
            name: 'dedup_indexer',
        }, dedup_indexer.background_worker);
    } else {
        dbg.warn('DEDUP INDEXER NOT ENABLED');
    }

    if (config.DB_CLEANER.ENABLED) {
        register_bg_worker({
            name: 'db_cleaner',
        }, db_cleaner.background_worker);
    } else {
        dbg.warn('DB CLEANER NOT ENABLED');
    }

    if (config.AGENT_BLOCKS_VERIFIER_ENABLED) {
        register_bg_worker(new AgentBlocksVerifier('agent_blocks_verifier'));
    } else {
        dbg.warn('AGENT BLOCKS VERIFIER NOT ENABLED');
    }

    if (config.AGENT_BLOCKS_RECLAIMER_ENABLED) {
        register_bg_worker(new AgentBlocksReclaimer('agent_blocks_reclaimer'));
    } else {
        dbg.warn('AGENT BLOCKS RECLAIMER NOT ENABLED');
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

    if (config.AWS_METERING_ENABLED && process.env.PLATFORM === 'aws') {
        register_bg_worker({
            name: 'aws_usage_metering',
            delay: config.AWS_METERING_INTERVAL
        }, aws_usage_metering.background_worker);
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
