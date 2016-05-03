'use strict';

// we populate the exports object but prefer to keep name referencing
// with config.NAME so that it will be consistent with the code that imports it
// and will make searching easier.
var config = exports;

// TODO take nodes min and free space reserve from system/pool config
config.NODES_MIN_COUNT = 3;
config.NODES_PER_CLOUD_POOL = 1;
config.NODES_FREE_SPACE_RESERVE = 10 * 1024 * 1024 * 1024;

// WRITE CONCURRENCY
config.WRITE_CONCURRENCY = 256;
config.REPLICATE_CONCURRENCY = 256;
// READ CONCURRENCY
config.READ_CONCURRENCY = 256;
config.READ_RANGE_CONCURRENCY = 32;

config.write_block_timeout = 20 * 1000;
config.read_block_timeout = 10 * 1000;

config.LONG_GONE_THRESHOLD = 3600000;
config.SHORT_GONE_THRESHOLD = 300000;
config.LONG_BUILD_THRESHOLD = 300000;
config.MAX_OBJECT_PART_SIZE = 64 * 1024 * 1024;

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
config.central_stats = {
    send_stats: true,
    central_listener: '127.0.0.1',
    previous_diag_packs_dir: '/tmp/prev_diags',
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
};

config.CLUSTERING_PATHS = {
    TOPOLOGY_FILE: '/etc/noobaa_cluster',
    SECRET_FILE: 'noobaa_sec',
    SUPER_FILE: '/etc/noobaa_supervisor.conf',
};

config.SUPERVISOR_PROGRAM_SEPERATOR = '#endprogram';

config.SUPERVISOR_DEFAULTS = {
    STOPSIGNAL: 'KILL',
    DIRECTORY: '/root/node_modules/noobaa-core'
};
