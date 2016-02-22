var config = {};

// TODO take nodes min and free space reserve from system/pool config
config.NODES_MIN_COUNT = 3;
config.NODES_FREE_SPACE_RESERVE = 10 * 1024 * 1024 * 1024;

// ACTION CONCURRENCY
config.READ_CONCURRENCY = 32;
config.WRITE_CONCURRENCY = 32;
config.READ_RANGE_CONCURRENCY = 8;
config.REPLICATE_CONCURRENCY = 32;

config.write_block_timeout = 20 * 1000;
config.read_block_timeout = 10 * 1000;
config.server_finalize_build_timeout = 120 * 1000;

config.LONG_GONE_THRESHOLD = 3600000;
config.SHORT_GONE_THRESHOLD = 300000;
config.LONG_BUILD_THRESHOLD = 300000;
config.MAX_OBJECT_PART_SIZE = 16 * 1024 * 1024;

config.dbg_log_level = 0;

// TEST Mode
config.test_mode = false;

// On Premise NVA params
config.on_premise = {
    base_url: "https://s3-eu-west-1.amazonaws.com/noobaa-download/on_premise/v_",
    nva_part: "NVA_Upgrade.tgz"
};

// Central Stats Collection & Diagnostics
config.central_stats = {
    send_stats: true,
    central_listener: '127.0.0.1',
    previous_diag_packs_dir: '/tmp/prev_diags',
    previous_diag_packs_count: 3 //TODO: We might want to split between agent and server
};

module.exports = config;
