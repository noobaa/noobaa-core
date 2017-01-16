/* Copyright (C) 2016 NooBaa */
'use strict';

// we populate the exports object but prefer to keep name referencing
// with config.NAME so that it will be consistent with the code that imports it
// and will make searching easier.
var config = exports;

//////////////////
// NODES CONFIG //
//////////////////

// TODO take nodes min and free space reserve from system/pool config
config.NODES_MIN_COUNT = 3;
config.NODES_PER_CLOUD_POOL = 1;
config.NODES_FREE_SPACE_RESERVE = 10 * 1024 * 1024 * 1024;

config.LONG_GONE_THRESHOLD = 3600000;
config.SHORT_GONE_THRESHOLD = 300000;
config.LONG_BUILD_THRESHOLD = 300000;
config.MAX_OBJECT_PART_SIZE = 64 * 1024 * 1024;
config.DEMO_NODES_STORAGE_LIMIT = 500 * 1024 * 1024;
config.NUM_DEMO_NODES = 3;
config.NODE_IO_DETENTION_THRESHOLD = 60000;
config.NODE_IO_DETENTION_RECENT_ISSUES = 5;
// Picked two because minimum of nodes per pool is three
config.NODE_IO_DETENTION_TEST_NODES = 2;

////////////////
// RPC CONFIG //
////////////////

config.RPC_CONNECT_TIMEOUT = 5000;
config.RPC_SEND_TIMEOUT = 5000;
config.CLOUD_AGENTS_N2N_PORT = 60100;

///////////////
// S3 CONFIG //
///////////////

config.S3_FORKS_ENABLED = true;
config.TIME_SKEW_MAX_SECONDS = 15 * 60;

///////////////
// MD CONFIG //
///////////////

// TODO DEDUP is temporarily disabled for capacity. Will enable once resolving the issues.
config.DEDUP_ENABLED = false;

///////////////
// IO CONFIG //
///////////////

config.IO_WRITE_BLOCK_RETRIES = 5;
config.IO_WRITE_BLOCK_TIMEOUT = 20000;
config.IO_WRITE_RETRY_DELAY_MS = 100;
config.IO_REPLICATE_BLOCK_RETRIES = 3;
config.IO_REPLICATE_BLOCK_TIMEOUT = 20000;
config.IO_REPLICATE_RETRY_DELAY_MS = 100;
config.IO_READ_BLOCK_TIMEOUT = 10000;
config.IO_DELETE_BLOCK_TIMEOUT = 30000;

config.IO_WRITE_CONCURRENCY = 256;
config.IO_REPLICATE_CONCURRENCY = 256;
config.IO_READ_CONCURRENCY = 256;
config.IO_READ_RANGE_CONCURRENCY = 32;

config.IO_STREAM_SPLIT_SIZE = 32 * 1024 * 1024;
config.IO_OBJECT_RANGE_ALIGN = 32 * 1024 * 1024;
config.IO_HTTP_PART_ALIGN = 32 * 1024 * 1024;
config.IO_HTTP_TRUNCATE_PART_SIZE = false;

////////////////////
// REBUILD CONFIG //
////////////////////

config.REBUILD_BATCH_SIZE = 20;
config.REBUILD_BATCH_DELAY = 75;
config.REBUILD_BATCH_ERROR_DELAY = 3000;

config.REBUILD_NODE_CONCURRENCY = 3;
config.REBUILD_NODE_OFFLINE_GRACE = 5 * 60000;

config.SCRUBBER_ENABLED = true;
config.SCRUBBER_RESTART_DELAY = 30000;

//////////////////////
// LIFECYCLE CONFIG //
//////////////////////
config.LIFECYCLE_INTERVAL = 15 * 60 * 1000;

//////////////////////////
// STATISTICS_COLLECTOR //
/////////////////////////

config.STATISTICS_COLLECTOR_ENABLED = true;
config.STATISTICS_COLLECTOR_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
config.STATISTICS_COLLECTOR_EXPIRATION = 31 * 24 * 60 * 60 * 1000; // 1 month

//////////////////
// DEBUG CONFIG //
//////////////////

config.DEBUG_MODE_PERIOD = 10 * 60 * 1000; // 10 minutes for increased debug level

config.dbg_log_level = 0;

// TEST Mode
config.test_mode = false;

// On Premise NVA params
config.on_premise = {
    base_url: "https://s3-eu-west-1.amazonaws.com/noobaa-download/on_premise/v_",
    nva_part: "NVA_Upgrade.tgz"
};

/*
  Central Stats Collection & Diagnostics
*/

var is_windows = (process.platform === "win32");

if (!is_windows) {
    process.env.ProgramData = '/tmp';
}
config.PHONE_HOME_BASE_URL = 'https://phonehome.noobaa.com';
config.central_stats = {
    send_stats: 'true',
    send_time_cycle: 30 * 60 * 1000, //30 min
    previous_diag_packs_dir: process.env.ProgramData + '/prev_diags',
    previous_diag_packs_count: 3 //TODO: We might want to split between agent and server
};
config.central_stats.send_time = 14 * 24 * 60 * 60 * 1000; //14 days

/*
  Clustering Defaults
*/
config.MONGO_DEFAULTS = {
    CFG_DB_PATH: '/var/lib/mongo/cluster/cfg0',
    CFG_PORT: '26050',
    CFG_RSET_NAME: 'config0',
    SHARD_SRV_PORT: '27000',
    COMMON_PATH: '/var/lib/mongo/cluster',
    CONNECT_RETRY_INTERVAL: 3 * 1000,
    CONNECT_MAX_WAIT: 5 * 60 * 1000
};

config.CLUSTERING_PATHS = {
    SECRET_FILE: '/etc/noobaa_sec',
    DARWIN_SECRET_FILE: '/Users/Shared/noobaa_sec',
    SUPER_FILE: '/etc/noobaa_supervisor.conf',
};

config.CLUSTER_HB_INTERVAL = 1 * 60000;
config.CLUSTER_MASTER_INTERVAL = 10000;
config.BUCKET_FETCH_INTERVAL = 30000;
config.CLUSTER_NODE_MISSING_TIME = 3 * 60000;
config.SUPERVISOR_PROGRAM_SEPERATOR = '#endprogram';

config.SUPERVISOR_DEFAULTS = {
    STOPSIGNAL: 'KILL',
    DIRECTORY: '/root/node_modules/noobaa-core'
};


config.DEMO_DEFAULTS = {
    POOL_NAME: 'demo-pool',
    BUCKET_NAME: 'demo-bucket'
};

//////////////////////////////
// ALERTING & EVENTS CONFIG //
//////////////////////////////

config.SEND_EVENTS_REMOTESYS = true;


// load a local config file that overwrites some of the config
try {
    // eslint-disable-next-line global-require
    require('./config-local');
} catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    console.log('NO LOCAL CONFIG');
}
