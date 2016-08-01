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

////////////////
// RPC CONFIG //
////////////////

config.RPC_CONNECT_TIMEOUT = 5000;
config.RPC_SEND_TIMEOUT = 5000;


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

config.IO_STREAM_CHUNK_SIZE = 128 * 1024 * 1024;
config.IO_OBJECT_RANGE_ALIGN = 32 * 1024 * 1024;
config.IO_HTTP_PART_ALIGN = 32 * 1024 * 1024;
config.IO_HTTP_TRUNCATE_PART_SIZE = false;

////////////////////
// REBUILD CONFIG //
////////////////////

config.REBUILD_BATCH_SIZE = 100;
config.REBUILD_BATCH_DELAY = 50;
config.REBUILD_BATCH_ERROR_DELAY = 3000;
config.REBUILD_LAST_BUILD_BACKOFF = 1 * 60000; // TODO increase?
config.REBUILD_BUILDING_MODE_BACKOFF = 5 * 60000; // TODO increase?

config.REBUILD_NODE_CONCURRENCY = 10;
config.REBUILD_NODE_OFFLINE_CLIFF = 3 * 60000;

config.SCRUBBER_RESTART_DELAY = 30000;

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
config.central_stats = {
    send_stats: 'true',
    central_listener: 'http://104.155.41.235:9090/phdata',
    send_time_cycle: 30 * 60000,
    previous_diag_packs_dir: process.env.ProgramData + '/prev_diags',
    previous_diag_packs_count: 3 //TODO: We might want to split between agent and server
};

/*
  Clustering Defaults
*/
config.MONGO_DEFAULTS = {
    CFG_DB_PATH: '/var/lib/mongo/cluster/cfg0',
    CFG_PORT: '26050',
    CFG_RSET_NAME: 'config0',
    SHARD_SRV_PORT: '27000',
    COMMON_PATH: '/var/lib/mongo/cluster',
    USER_PLACE_HOLDER: 'USER',
    DEFAULT_USER: 'nbsrv',
    DEFAULT_ADMIN_USER: 'nbadmin',
    DEFAULT_MONGO_PWD: 'roonoobaa'
};

config.CLUSTERING_PATHS = {
    SECRET_FILE: '/etc/noobaa_sec',
    DARWIN_SECRET_FILE: '/Users/Shared/noobaa_sec',
    SUPER_FILE: '/etc/noobaa_supervisor.conf',
};

config.CLUSTER_HB_INTERVAL = 1 * 60000;
config.CLUSTER_MASTER_INTERVAL = 30000;
config.BUCKET_FETCH_INTERVAL = 30000;
config.CLUSTER_NODE_MISSING_TIME = 3 * 60000;
config.SUPERVISOR_PROGRAM_SEPERATOR = '#endprogram';

config.SUPERVISOR_DEFAULTS = {
    STOPSIGNAL: 'KILL',
    DIRECTORY: '/root/node_modules/noobaa-core'
};


config.DEMO_DEFAULTS = {
    NAME: 'demo'
};
