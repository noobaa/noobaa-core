/* Copyright (C) 2016 NooBaa */
'use strict';

// we populate the exports object but prefer to keep name referencing
// with config.NAME so that it will be consistent with the code that imports it
// and will make searching easier.
var config = exports;
const os = require('os');

//////////////////
// NODES CONFIG //
//////////////////

// TODO take nodes min and free space reserve from system/pool config
config.NODES_MIN_COUNT = 3;
config.NODES_PER_CLOUD_POOL = 1;
config.NODES_PER_MONGO_POOL = 1;
// in kubernetes use reserve of 100MB instead of 10GB
config.NODES_FREE_SPACE_RESERVE = 100 * (1024 ** 2);

// don't use agents with less than reserve + 5 GB
config.MINIMUM_AGENT_TOTAL_STORAGE = config.NODES_FREE_SPACE_RESERVE + (5 * (1024 ** 3));

config.LONG_GONE_THRESHOLD = 3600000;
config.SHORT_GONE_THRESHOLD = 300000;
config.LONG_BUILD_THRESHOLD = 300000;
config.MAX_OBJECT_PART_SIZE = 64 * 1024 * 1024;
config.NODE_IO_DETENTION_THRESHOLD = 60000;
config.NODE_IO_DETENTION_RECENT_ISSUES = 5;
// Picked two because minimum of nodes per pool is three
config.NODE_IO_DETENTION_TEST_NODES = 2;

config.HOSTED_AGENTS_HOST_ID = 'hosted_agents';

config.NODE_ALLOCATOR_NUM_CLUSTERS = 2;

////////////////
// RPC CONFIG //
////////////////

config.RPC_CONNECT_TIMEOUT = 120 * 1000;
config.RPC_SEND_TIMEOUT = 120 * 1000;

config.RPC_PING_INTERVAL_MS = 20000;
// setting number of pings above the time it takes to get connect timeout
config.RPC_PING_EXHAUSTED_COUNT = (config.RPC_CONNECT_TIMEOUT / config.RPC_PING_INTERVAL_MS) + 2;

config.RECONN_BACKOFF_BASE = 250;
config.RECONN_BACKOFF_MAX = 5000;
config.RECONN_BACKOFF_FACTOR = 1.2;

config.CLOUD_AGENTS_N2N_PORT = 60100;
// TODO: Should check what PORT we are interested in taking
config.MONGO_AGENTS_N2N_PORT = 60100;

config.N2N_OFFER_INTERNAL = false;

/////////////////////
// ENDPOINT CONFIG //
/////////////////////

config.AMZ_DATE_MAX_TIME_SKEW_MILLIS = 15 * 60 * 1000;
config.ENDPOINT_MONITOR_INTERVAL = 10 * 60 * 1000; // 10min

///////////////
// MD CONFIG //
///////////////

config.DEDUP_ENABLED = true;

// Date was chosen as default NooBaa epoch date 2015
config.NOOBAA_EPOCH = 1430006400000;
config.NEW_SYSTEM_POOL_NAME = 'first-pool';
config.INTERNAL_STORAGE_POOL_NAME = 'system-internal-storage-pool';
// config.SPILLOVER_TIER_NAME = 'bucket-spillover-tier';

config.MD_AGGREGATOR_INTERVAL = 30000;
// the max cycles limits how many intervals the aggregator will split the gap
// the higher this value the higher the time intervals it will scan when trying to close time gaps
config.MD_AGGREGATOR_MAX_CYCLES = 2880; // 1 day / 30 seconds
// Currently the grace is 3 cycles of md_aggregator
// This grace is used since we can hold up an ObjectID and not push it inside the DB
// Which will mean that it will be pushed later on with a previous date
config.MD_GRACE_IN_MILLISECONDS = config.MD_AGGREGATOR_INTERVAL * 3;
config.MD_AGGREGATOR_BATCH = 100;

///////////////
// IO CONFIG //
///////////////

config.ALLOCATE_RETRY_DELAY_MS = 500;

config.IO_WRITE_BLOCK_RETRIES = 5;
config.IO_WRITE_BLOCK_TIMEOUT = 120 * 1000;
config.IO_WRITE_RETRY_DELAY_MS = 100;
config.IO_REPLICATE_BLOCK_RETRIES = 3;
config.IO_REPLICATE_BLOCK_TIMEOUT = 120 * 1000;
config.IO_REPLICATE_RETRY_DELAY_MS = 100;
config.IO_READ_BLOCK_TIMEOUT = 120 * 1000;
config.IO_DELETE_BLOCK_TIMEOUT = 120 * 1000;
config.IO_WRITE_PART_ATTEMPTS_EXHAUSTED = 120 * 1000;

config.IO_WRITE_CONCURRENCY_GLOBAL = 256;
config.IO_REPLICATE_CONCURRENCY_GLOBAL = 256;
config.IO_READ_CONCURRENCY_GLOBAL = 256;
config.IO_WRITE_CONCURRENCY_AGENT = 16;
config.IO_WRITE_CONCURRENCY_AGENT_CLOUD = 128;
config.IO_REPLICATE_CONCURRENCY_AGENT = 16;
config.IO_READ_CONCURRENCY_AGENT = 16;
config.IO_READ_RANGE_CONCURRENCY = 32;

config.IO_STREAM_SPLIT_SIZE = 32 * 1024 * 1024;
// This is the maximum IO memory usage cap inside single semaphore job
config.IO_STREAM_SEMAPHORE_SIZE_CAP = config.IO_STREAM_SPLIT_SIZE * 8;
config.IO_STREAM_MINIMAL_SIZE_LOCK = 1 * 1024 * 1024;
config.IO_OBJECT_RANGE_ALIGN = 32 * 1024 * 1024;

config.IO_MEM_SEMAPHORE = 4;
config.IO_STREAM_SEMAPHORE_TIMEOUT = 120 * 1000;
config.VIDEO_READ_STREAM_PRE_FETCH_LOAD_CAP = 5 * 1000;
config.IO_SEMAPHORE_CAP = Math.floor(
    Math.max(config.IO_STREAM_SEMAPHORE_SIZE_CAP,
        Number(process.env.CONTAINER_MEM_REQUEST ? process.env.CONTAINER_MEM_REQUEST : os.totalmem()) /
        config.IO_MEM_SEMAPHORE)
);

config.ERROR_INJECTON_ON_WRITE = 0;
config.ERROR_INJECTON_ON_READ = 0;

/////////////////////
//NODES MONITORING //
/////////////////////

config.CLOUD_MAX_ALLOWED_IO_TEST_ERRORS = 3;

///////////////////////////
// AGENT BLOCKS VERIFIER //
///////////////////////////

config.AGENT_BLOCKS_VERIFIER_ENABLED = true;
// TODO: Should check what is the optiomal amount of batch
config.AGENT_BLOCKS_VERIFIER_BATCH_SIZE = 1000;
config.AGENT_BLOCKS_VERIFIER_BATCH_DELAY = 50;
config.AGENT_BLOCKS_VERIFIER_ERROR_DELAY = 3000;
config.AGENT_BLOCKS_VERIFIER_RESTART_DELAY = 30000;
config.AGENT_BLOCKS_VERIFIER_TIMEOUT = 120 * 1000;

////////////////////////////
// AGENT BLOCKS RECLAIMER //
////////////////////////////

config.AGENT_BLOCKS_RECLAIMER_ENABLED = true;
// TODO: Should check what is the optiomal amount of batch
config.AGENT_BLOCKS_RECLAIMER_BATCH_SIZE = 1000;
config.AGENT_BLOCKS_RECLAIMER_BATCH_DELAY = 50;
config.AGENT_BLOCKS_RECLAIMER_ERROR_DELAY = 3000;
config.AGENT_BLOCKS_RECLAIMER_RESTART_DELAY = 30000;

////////////////////
// REBUILD CONFIG //
////////////////////

config.REBUILD_NODE_ENABLED = true;
config.REBUILD_NODE_CONCURRENCY = 3;
config.REBUILD_NODE_OFFLINE_GRACE = 5 * 60000;
config.REBUILD_NODE_BATCH_SIZE = 10;
config.REBUILD_NODE_BATCH_DELAY = 50;

// TODO: Temporary using the same number but later on they will be different cellings
config.MIN_TIER_FREE_THRESHOLD = 100 * 1024 * 1024;
config.MAX_TIER_FREE_THRESHOLD = 100 * 1024 * 1024;
config.ENOUGH_ROOM_IN_TIER_THRESHOLD = 200 * 1024 * 1024;

config.CHUNK_MOVE_LIMIT = 10;

config.SCRUBBER_ENABLED = true;
config.SCRUBBER_BATCH_SIZE = 10;
config.SCRUBBER_BATCH_DELAY = 50;
config.SCRUBBER_ERROR_DELAY = 3000;
config.SCRUBBER_RESTART_DELAY = 30000;

config.MIRROR_WRITER_ENABLED = true;
config.MIRROR_WRITER_BATCH_SIZE = 10;
config.MIRROR_WRITER_BATCH_DELAY = 50;
config.MIRROR_WRITER_ERROR_DELAY = 3000;
config.MIRROR_WRITER_EMPTY_DELAY = 30000;
config.MIRROR_WRITER_MARKER_STORE_PERIOD = 10 * 60000; // store markers every 10 min

config.TIER_TTF_WORKER_ENABLED = true;
config.TIER_TTF_WORKER_BATCH_DELAY = 500;
config.TIER_TTF_WORKER_EMPTY_DELAY = 30000;

config.TIER_SPILLBACK_WORKER_ENABLED = true;
config.TIER_SPILLBACK_BATCH_SIZE = 50;
config.TIER_SPILLBACK_BATCH_DELAY = 50;
config.TIER_SPILLBACK_EMPTY_DELAY = 30000;
config.TIER_SPILLBACK_MIN_FREE = config.MIN_TIER_FREE_THRESHOLD * 2;

config.BUCKET_RECLAIMER_ENABLED = true;
config.BUCKET_RECLAIMER_EMPTY_DELAY = 30000;
config.BUCKET_RECLAIMER_BATCH_SIZE = 1000;
config.BUCKET_RECLAIMER_BATCH_DELAY = 100;
config.BUCKET_RECLAIMER_ERROR_DELAY = 3000;

config.OBJECT_RECLAIMER_ENABLED = true;
config.OBJECT_RECLAIMER_EMPTY_DELAY = 30000;
config.OBJECT_RECLAIMER_BATCH_SIZE = 100;
config.OBJECT_RECLAIMER_BATCH_DELAY = 100;
config.OBJECT_RECLAIMER_ERROR_DELAY = 3000;


//////////////////
// CHUNK CONFIG //
//////////////////

// SPLIT
config.CHUNK_SPLIT_AVG_CHUNK = 4 * 1024 * 1024;
config.CHUNK_SPLIT_DELTA_CHUNK = config.CHUNK_SPLIT_AVG_CHUNK / 4;

// CODER
config.CHUNK_CODER_DIGEST_TYPE = 'sha384';
config.CHUNK_CODER_FRAG_DIGEST_TYPE = 'sha1';
config.CHUNK_CODER_COMPRESS_TYPE = process.env.NOOBAA_DISABLE_COMPRESSION === 'true' ? undefined : 'snappy';
config.CHUNK_CODER_CIPHER_TYPE = 'aes-256-gcm';

// ERASURE CODES
config.CHUNK_CODER_EC_DATA_FRAGS = 4;
config.CHUNK_CODER_REPLICAS = 1;
config.CHUNK_CODER_EC_PARITY_FRAGS = 2;
config.CHUNK_CODER_EC_PARITY_TYPE = 'cm256';
config.CHUNK_CODER_EC_TOLERANCE_THRESHOLD = 2;

//////////////////////////
// DEDUP INDEXER CONFIG //
//////////////////////////
config.DEDUP_INDEXER_ENABLED = true;
config.DEDUP_INDEXER_BATCH_SIZE = 200;
config.DEDUP_INDEXER_BATCH_DELAY = 1000;
config.DEDUP_INDEXER_ERROR_DELAY = 10 * 1000;
config.DEDUP_INDEXER_RESTART_DELAY = 12 * 60 * 60 * 1000; //12h
config.DEDUP_INDEXER_IGNORE_BACK_TIME = 7 * 24 * 60 * 60 * 1000; // dedup indexer will ignore dedup keys from the last week
config.DEDUP_INDEXER_LOW_KEYS_NUMBER = 8 * 1000000; // 8M keys max in index ~ 1.5GB
config.DEDUP_INDEXER_CHECK_INDEX_CYCLE = 60000;

///////////////////////
// DB CLEANER CONFIG //
///////////////////////
config.DB_CLEANER = {
    ENABLED: true,
    CYCLE: 2 * 60 * 60 * 1000, // 2 hours
    BACK_TIME: 3 * 30 * 24 * 60 * 60 * 1000, // 3 months
    DOCS_LIMIT: 1000,
    MAX_TOTAL_DOCS: 10000
};

///////////////////////
// NAMESPACE CACHING //
///////////////////////
config.NAMESPACE_CACHING = {
    DEFAULT_CACHE_TTL_MS: 60000,
};

/////////////////////
// CLOUD RESOURCES //
/////////////////////
// EXPERIMENTAL!! switch to turn off the use of signed urls to delegate cloud read\writes to object_io (s3 compatible only)
// when this is set to true, block_store_s3 will return s3 credentials to the block_store_client so it can
// connect directly to the cloud target (and not via a signed url)
config.EXPERIMENTAL_DISABLE_S3_COMPATIBLE_DELEGATION = {
    DEFAULT: false,
    FLASHBLADE: true,
    IBM_COS: true,
};
config.EXPERIMENTAL_DISABLE_S3_COMPATIBLE_METADATA = {
    DEFAULT: false,
    FLASHBLADE: true,
    S3_COMPATIBLE: true,
    IBM_COS: true,
};

config.DEFAULT_S3_AUTH_METHOD = {
    AWS: 'AWS_V4',
    FLASHBLADE: 'AWS_V4',
    IBM_COS: 'AWS_V2',
};

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

///////////////////
// USAGE REPORTS //
///////////////////
config.SERVICES_TYPES = Object.freeze(['AWS', 'AZURE', 'S3_COMPATIBLE', 'GOOGLE', 'FLASHBLADE', 'IBM_COS']);
config.USAGE_AGGREGATOR_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

config.BLOCK_STORE_USAGE_INTERVAL = 1 * 60 * 1000; // 1 minute

///////////////////
// AWS REPORTING //
///////////////////
config.AWS_METERING_ENABLED = true;
config.AWS_METERING_INTERVAL = 60 * 60 * 1000; // 1 hour
config.AWS_METERING_USAGE_DIMENSION = 'noobaa_usage';


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
    send_stats: false,
    partial_send_time_cycle: 5 * 60 * 1000, //5 min
    full_cycle_ratio: 6, // One full cycle per 5 partial cycles
    previous_diag_packs_dir: process.env.ProgramData + '/prev_diags',
    previous_diag_packs_count: 2 //TODO: We might want to split between agent and server
};

/*
  Clustering Defaults
*/
config.MONGO_DEFAULTS = {
    CFG_DB_PATH: '/data/mongo/cluster/cfg0',
    CFG_PORT: '26050',
    CFG_RSET_NAME: 'config0',
    SHARD_SRV_PORT: '27000',
    COMMON_PATH: '/data/mongo/cluster',
    CONNECT_RETRY_INTERVAL: 3 * 1000,
    CONNECT_MAX_WAIT: 5 * 60 * 1000,
    ROOT_CA_PATH: '/data/mongo/ssl/root-ca.pem',
    SERVER_CERT_PATH: '/data/mongo/ssl/server.pem',
    CLIENT_CERT_PATH: '/data/mongo/ssl/client.pem',
};

config.CLUSTERING_PATHS = {
    SUPER_FILE: '/data/noobaa_supervisor.conf',
};

config.NAMED_DEFAULTS = {
    FORWARDERS_OPTION_FILE: '/etc/noobaa_configured_dns.conf'
};

config.CLUSTER_HB_INTERVAL = 1 * 60000;
config.CLUSTER_MASTER_INTERVAL = 10000;
config.CLUSTER_NODE_MISSING_TIME = 3 * 60000;
config.SUPERVISOR_PROGRAM_SEPERATOR = '#endprogram';

config.SUPERVISOR_DEFAULTS = {
    STOPSIGNAL: 'KILL',
    DIRECTORY: '/root/node_modules/noobaa-core'
};


config.SERVER_MIN_REQUIREMENTS = {
    // Should be synced with the container requirements
    RAM_GB: 2,
    STORAGE_GB: 50,
    CPU_COUNT: 1
};

// we currently use ~600MB during the upgrade process. use twice as much as a limit
config.MIN_MEMORY_FOR_UPGRADE = 1200 * 1024 * 1024;

//////////////////////////////
// ALERTING & EVENTS CONFIG //
//////////////////////////////

config.SEND_EVENTS_REMOTESYS = true;
config.PROMETHEUS_ENABLED = true;
config.PROMETHEUS_PREFIX = 'NooBaa_';

//////////////////////////////
// OAUTH RELATES            //
//////////////////////////////

config.OAUTH_REDIRECT_ENDPOINT = 'fe/oauth/callback';
config.OAUTH_REQUIRED_SCOPE = 'user:info';
config.OAUTH_REQUIRED_GROUPS = [
    'system:cluster-admins'
];

//////////////////////////////
// KUBERNETES RELATES       //
//////////////////////////////

config.KUBE_APP_LABEL = 'noobaa';
config.KUBE_SA_TOKEN_FILE = '/var/run/secrets/kubernetes.io/serviceaccount/token';
config.KUBE_NAMESPACE_FILE = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';
config.KUBE_API_ENDPOINTS = {
    TOKEN_REVIEW: '/apis/authentication.k8s.io/v1/tokenreviews'
};

//////////////////////////////
// ACCOUNT PREFERENCES      //
//////////////////////////////

config.DEFAULT_ACCOUNT_PREFERENCES = {
    ui_theme: 'DARK'
};

///////////////////////////////////
// REMOTE NOOBAA DEPLOYMENT INFO //
///////////////////////////////////
config.REMOTE_NOOAA_NAMESPACE = `remote-${config.KUBE_APP_LABEL}`;

//Load overrides if exist
try {
    // load a local config file that overwrites some of the config
    // eslint-disable-next-line global-require
    const local_config = require('./config-local');
    Object.assign(config, local_config);

    //load env variables to override if exists (should start with CONFIG_JS_)
    const ENV_PREFIX = 'CONFIG_JS_';
    for (const key of Object.keys(process.env)) {
        if (key.startsWith(ENV_PREFIX)) {
            const conf_name = key.substring(ENV_PREFIX.length);
            let new_val;

            //value exists, verify same type
            const type = typeof config[conf_name];
            if (type === 'number' && !isNaN(parseInt(process.env[key], 10))) {
                new_val = parseInt(process.env[key], 10);
                console.log(`Overriding config.js from ENV with ${conf_name}=${new_val} (Int)`);
                config[conf_name] = new_val;
            } else if (type === 'boolean' && process.env[key] === 'true') {
                new_val = true;
                console.log(`Overriding config.js from ENV with ${conf_name}=${new_val} (bool)`);
                config[conf_name] = new_val;
            } else if (type === 'boolean' && process.env[key] === 'false') {
                new_val = false;
                console.log(`Overriding config.js from ENV with ${conf_name}=${new_val} (bool)`);
                config[conf_name] = new_val;
            } else if (type === 'string' || type === 'undefined') {
                new_val = process.env[key];
                console.log(`Overriding config.js from ENV with ${conf_name}=${new_val} (string)`);
                config[conf_name] = new_val;
            } else {
                console.log(`Unknown type or mismatch between existing ${type} and provided type for ${conf_name}, skipping ...`);
            }
        }
    }
} catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    console.log('NO LOCAL CONFIG');
}

//////////////////////////////
// OPERATOR RELATED         //
//////////////////////////////

config.OPERATOR_ACCOUNT_EMAIL = 'operator@noobaa.io';

///////////////////////////////
// FILES RELATED             //
///////////////////////////////

config.INLINE_MAX_SIZE = 4096;


///////////////////////////////
//        WORM RELATED       //
///////////////////////////////

config.WORM_ENABLED = false;

// Should we allow the creation of buckets on internal storage
config.ALLOW_BUCKET_CREATE_ON_INTERNAL = true;
