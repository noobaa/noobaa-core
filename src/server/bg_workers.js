/* Copyright (C) 2016 NooBaa */
'use strict';

// load .env file before any other modules so that it will contain
// all the arguments even when the modules are loading.
console.log('loading .env file');
require('../util/dotenv').load();
require('../util/coverage_utils');
require('../util/panic');
require('../util/fips');

const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('BGWorkers');
const debug_config = require('../util/debug_config');

const url = require('url');
const http_utils = require('../util/http_utils');
const config = require('../../config.js');
const scrubber = require('./bg_services/scrubber');
const lifecycle = require('./bg_services/lifecycle');
const cluster_hb = require('./bg_services/cluster_hb');
const server_rpc = require('./server_rpc');
const db_client = require('../util/db_client');
const { BucketsReclaimer } = require('./bg_services/buckets_reclaimer');
const { ObjectsReclaimer } = require('./bg_services/objects_reclaimer');
const { MirrorWriter } = require('./bg_services/mirror_writer');
const { TieringTTFWorker } = require('./bg_services/tier_ttf_worker');
const { TieringSpillbackWorker } = require('./bg_services/tier_spillback_worker');
const cluster_master = require('./bg_services/cluster_master');
const AgentBlocksVerifier = require('./bg_services/agent_blocks_verifier').AgentBlocksVerifier;
const AgentBlocksReclaimer = require('./bg_services/agent_blocks_reclaimer').AgentBlocksReclaimer;
const stats_aggregator = require('./system_services/stats_aggregator');
const { NamespaceMonitor } = require('./bg_services/namespace_monitor');
const { ReplicationScanner } = require('./bg_services/replication_scanner');
const aws_usage_metering = require('./system_services/aws_usage_metering');
const usage_aggregator = require('./bg_services/usage_aggregator');
const md_aggregator = require('./bg_services/md_aggregator');
const background_scheduler = require('../util/background_scheduler').get_instance();
const stats_collector = require('./bg_services/stats_collector');
const dedup_indexer = require('./bg_services/dedup_indexer');
const db_cleaner = require('./bg_services/db_cleaner');
const prom_reporting = require('./analytic_services/prometheus_reporting');

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

if (process.env.NOOBAA_LOG_LEVEL) {
    let dbg_conf = debug_config.get_debug_config(process.env.NOOBAA_LOG_LEVEL);
    dbg_conf.core.map(module => dbg.set_module_level(dbg_conf.level, module));
}

db_client.instance().connect();
register_rpc();

//Set KeepAlive to all http/https agents in bg_workers
http_utils.update_http_agents({ keepAlive: true });
http_utils.update_https_agents({ keepAlive: true });

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

const register_bg_worker =
    (worker, run_batch_function) =>
    background_scheduler.register_bg_worker(worker, run_batch_function);

function remove_master_workers() {
    MASTER_BG_WORKERS.forEach(worker_name => {
        background_scheduler.remove_background_worker(worker_name);
    });

}

function run_master_workers() {
    register_bg_worker({
        name: 'system_server_stats_aggregator',
        delay: config.central_stats.partial_send_time_cycle,
        run_immediate: true
    }, stats_aggregator.background_worker);

    register_bg_worker(new NamespaceMonitor({
        name: 'namespace_monitor',
        client: server_rpc.client,
        should_monitor: nsr => !nsr.nsfs_config,
    }));

    if (config.REPLICATION_ENABLED) {
        register_bg_worker(new ReplicationScanner({
            name: 'replication_scanner',
            client: server_rpc.client,
        }));
    } else {
        dbg.warn('REPLICATION NOT ENABLED');
    }
    if (process.env.NOOBAA_DISABLE_AGGREGATOR !== "true") {
        register_bg_worker({
            name: 'md_aggregator',
            delay: config.MD_AGGREGATOR_INTERVAL
        }, md_aggregator.background_worker);
    }
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

    if (config.BUCKET_RECLAIMER_ENABLED) {
        register_bg_worker(new BucketsReclaimer({
            name: 'bucket_reclaimer',
            client: server_rpc.client
        }));
    } else {
        dbg.warn('BUCKET_RECLAIMER NOT ENABLED');
    }

    if (config.OBJECT_RECLAIMER_ENABLED) {
        register_bg_worker(new ObjectsReclaimer({
            name: 'object_reclaimer',
            client: server_rpc.client
        }));
    } else {
        dbg.warn('OBJECT_RECLAIMER NOT ENABLED');
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

async function start_bg_workers_server() {
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

    // Try to start the bg workers metrics server
    await prom_reporting.start_server(config.BG_METRICS_SERVER_PORT);

    dbg.log('BG Workers Server started');
}

start_bg_workers_server();

// EXPORTS
exports.run_master_workers = run_master_workers;
exports.remove_master_workers = remove_master_workers;
