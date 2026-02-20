/* Copyright (C) 2016 NooBaa */
'use strict';

// we populate the exports object but prefer to keep name referencing
// with config.NAME so that it will be consistent with the code that imports it
// and will make searching easier.
const config = exports;

const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const _ = require('lodash');
const util = require('util');
const nsfs_schema_utils = require('./src/manage_nsfs/nsfs_schema_utils');
const range_utils = require('./src/util/range_utils');
const { EventEmitter } = require('events');

config.event_emitter = new EventEmitter();

/////////////////////////
// CONTAINER RESOURCES //
/////////////////////////

config.ENDPOINT_FORKS = Number(process.env.ENDPOINT_FORKS) || 0;
config.OS_MEM_RESERVED = 2 * 1024 * 1024 * 1024;
config.OS_MEM_LIMIT_TOTAL = os.totalmem() - config.OS_MEM_RESERVED;
config.OS_MEM_LIMIT = config.ENDPOINT_FORKS > 0 ? config.OS_MEM_LIMIT_TOTAL / config.ENDPOINT_FORKS : config.OS_MEM_LIMIT_TOTAL;

// The REQUEST is the "minimal" or "guaranteed" amount required for the container's operation.
// The LIMIT is the "maximal" or "burst" amount that the container can use for extended operations.
// In Kubernetes for "guaranteed" QOS class REQUEST and LIMIT both have to be provided and equal.
// This means that in most cases these configs should be the same.
// However we allow a configuration of "thin" provisioning of resources, where LIMIT is higher than REQUEST.
//
// When to use LIMIT:
// - For limiting amounts of transient memory.
// - As we do with semaphores to backpressure incoming I/O requests.
// - Suitable for memory that will be garbage collected soon enough after being processed.
// -  The heap will be able to burst up and down.
//
// When to use REQUEST:
// - Less common and is currently unused
// - Might be needed when limiting pinned memory like DB caches.

config.CONTAINER_MEM_LIMIT = Number(process.env.CONTAINER_MEM_LIMIT || '') || config.OS_MEM_LIMIT;
config.CONTAINER_CPU_LIMIT = Number(process.env.CONTAINER_CPU_LIMIT || '') || os.cpus().length;
config.CONTAINER_MEM_REQUEST = Number(process.env.CONTAINER_MEM_REQUEST || '');
config.CONTAINER_CPU_REQUEST = Number(process.env.CONTAINER_CPU_REQUEST || '');

// For buffer limits we use the mem LIMIT and not REQUEST because -
// if we are in guaranteed mode then it will equal to requests anyway,
// but if limit is higher then we want to allow buffering using burst memory,
// since these buffers will get garbage collected after processing.
//
// We divide by 4 because we don't have a central buffer manager, and we need
// some fixed top limit to how much these buffers can consume from the total,
// so we just picked 4 for now.
//
// This constant is currently used for semaphores in object_io and namespace_cache.
//
// TODO we need a central buffer manager to handle all cases (other namespaces too)
config.BUFFERS_MEM_LIMIT_MIN = 32 * 1024 * 1024; // just some workable minimum size in case the container mem limit is too low.
config.BUFFERS_MEM_LIMIT_MAX = 4 * 1024 * 1024 * 1024;
config.BUFFERS_MEM_LIMIT = Math.min(
    config.BUFFERS_MEM_LIMIT_MAX,
    Math.max(Math.floor(config.CONTAINER_MEM_LIMIT / 4), config.BUFFERS_MEM_LIMIT_MIN)
);

////////////////////////
// CERTIFICATE CONFIG //
////////////////////////

config.S3_SERVICE_CERT_PATH = '/etc/s3-secret';
config.STS_SERVICE_CERT_PATH = '/etc/sts-secret';
config.IAM_SERVICE_CERT_PATH = '/etc/iam-secret';
config.MGMT_SERVICE_CERT_PATH = '/etc/mgmt-secret';
config.EXTERNAL_DB_SERVICE_CERT_PATH = '/etc/external-db-secret';

/////////////////
// LDAP CONFIG //
/////////////////
config.LDAP_CONFIG_PATH = '/etc/noobaa-server/ldap_config';

//////////////////
// NODES CONFIG //
//////////////////

// TODO take nodes min and free space reserve from system/pool config
config.NODES_MIN_COUNT = 3;
config.NODES_PER_CLOUD_POOL = 1;
// in kubernetes use reserve of 100MB instead of 10GB
config.NODES_FREE_SPACE_RESERVE = 100 * (1024 ** 2);

// don't use agents with less than reserve + 5 GB
config.MINIMUM_AGENT_TOTAL_STORAGE = config.NODES_FREE_SPACE_RESERVE + (5 * (1024 ** 3));


// by default not disconnecting nodes on error. This caused more issues than benefits
config.NODES_DISCONNECT_ON_ERROR = false;

// by default not detaining nodes on io errors. This caused more issues than benefits
config.NODE_IO_DETENTION_DISABLE = true;

config.NODE_IO_DETENTION_THRESHOLD = 60 * 1000;
config.NODE_IO_DETENTION_RECENT_ISSUES = 5;
// Picked two because minimum of nodes per pool is three
config.NODE_IO_DETENTION_TEST_NODES = 2;

config.HOSTED_AGENTS_HOST_ID = 'hosted_agents';

config.NODE_ALLOCATOR_NUM_CLUSTERS = 2;

config.AGENT_HEARTBEAT_GRACE_TIME = 10 * 60 * 1000; // grace period before an agent is considered offline
config.CLOUD_ALERT_GRACE_TIME = 3 * 60 * 1000; // grace period before dispatching alert on cloud node status
config.AGENT_RESPONSE_TIMEOUT = 1 * 60 * 1000;
config.AGENT_TEST_CONNECTION_TIMEOUT = 1 * 60 * 1000;
config.CLOUD_MAX_ALLOWED_IO_TEST_ERRORS = 3;

config.ENABLE_DEV_RANDOM_SEED = process.env.DISABLE_DEV_RANDOM_SEED === 'false' || false;

////////////////
// RPC CONFIG //
////////////////

config.AGENT_RPC_PROTOCOL = 'n2n';
config.AGENT_RPC_PORT = process.env.AGENT_PORT || '9999';

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
// Keep connection on long requests
config.S3_KEEP_ALIVE_WHITESPACE_INTERVAL = 15 * 1000;
config.S3_MD_SIZE_LIMIT = 2 * 1024;
// Semaphore monitoring execution interval
config.SEMAPHORE_MONITOR_DELAY = 10 * 1000;
// Semaphore metrics average calculation intervals in minutes, values need to be in ascending order
config.SEMAPHORE_METRICS_AVERAGE_INTERVALS = Object.freeze(['1', '5', '10']);
config.ENABLE_SEMAPHORE_MONITOR = true;
config.ENABLE_OBJECT_IO_SEMAPHORE_MONITOR = true;

config.ENDPOINT_HTTP_SERVER_REQUEST_TIMEOUT = 300 * 1000;
config.ENDPOINT_HTTP_SERVER_KEEPALIVE_TIMEOUT = 5 * 1000;
config.ENDPOINT_HTTP_MAX_REQUESTS_PER_SOCKET = 0; // 0 = no limit

// For now we enable fixed CORS only for sts
// for S3 per bucket is configurabl with the s3 put-bucket-cors api.
// note that browsers do not really allow origin=* with credentials,
// but we just allow both from our side for simplicity.
config.S3_CORS_ENABLED = true;
config.S3_CORS_DEFAULTS_ENABLED = true;
config.S3_CORS_ALLOW_ORIGIN = ['*'];
config.S3_CORS_ALLOW_CREDENTIAL = 'true';
config.S3_CORS_ALLOW_METHODS = [
    'GET',
    'POST',
    'PUT',
    'DELETE',
];
config.S3_CORS_ALLOW_HEADERS = [
    'Content-Type',
    'Content-MD5',
    'Authorization',
    'X-Amz-User-Agent',
    'X-Amz-Date',
    'ETag',
    'X-Amz-Content-Sha256',
    'amz-sdk-invocation-id',
    'amz-sdk-request',
];
config.S3_CORS_EXPOSE_HEADERS = [
    'ETag',
    'X-Amz-Version-Id'
];
config.STS_CORS_EXPOSE_HEADERS = 'ETag';

/**
 * Whether to return x-amz-expiration header based on the bucket lifecycle rules.
 * Currently the bucket rules are not cached so this can cause a performance hit on object head/get/put,
 * so we want to be able to disable this feature if needed.
 */
config.S3_LIFECYCLE_EXPIRATION_HEADER_ENABLED = true;

config.DENY_UPLOAD_TO_STORAGE_CLASS_STANDARD = false;

/**
 * NSFS_GLACIER_FORCE_STORAGE_CLASS controls which storage
 * class to be used if no storage class or `STANDARD` storage
 * class is provided.
 * @type {nb.StorageClass}
 */
config.NSFS_GLACIER_FORCE_STORAGE_CLASS = undefined;

// S3_RESTORE_MAX_DAYS controls that for how many maximum number
// of days an object can be restored using `restore-object` call.
config.S3_RESTORE_REQUEST_MAX_DAYS = 30;

/**
 * S3_RESTORE_MAX_DAYS_BEHAVIOUR controls whether to truncate the
 * requested number of days in restore request or whether to deny the request.
 * @type {'DENY' | 'TRUNCATE'}
 */
config.S3_RESTORE_REQUEST_MAX_DAYS_BEHAVIOUR = 'TRUNCATE';

/**
 * S3_MAX_KEY_LENGTH controls the maximum key length that will be accepted
 * by NooBaa endpoints.
 *
 * This value is 1024 bytes for S3 but the default is `Infinity`
 */
config.S3_MAX_KEY_LENGTH = Infinity;

/**
 * S3_MAX_BUCKET_NAME_LENGTH controls the maximum bucket name length that
 * will be accepted by NooBaa endpoints.
 *
 * This value is 63 bytes for S3 but the default is `Infinity`
 */
config.S3_MAX_BUCKET_NAME_LENGTH = Infinity;

/////////////////////
// SECRETS CONFIG  //
/////////////////////
if (process.env.CONTAINER_PLATFORM || process.env.LOCAL_MD_SERVER) {
    config.JWT_SECRET = process.env.JWT_SECRET || _get_data_from_file(`/etc/noobaa-server/jwt`);
    config.SERVER_SECRET = process.env.SERVER_SECRET || _get_data_from_file(`/etc/noobaa-server/server_secret`);
    config.NOOBAA_AUTH_TOKEN = process.env.NOOBAA_AUTH_TOKEN || _get_data_from_file(`/etc/noobaa-auth-token/auth_token`);
}

config.ROOT_KEY_MOUNT = '/etc/noobaa-server/root_keys';

///////////////
// DB CONFIG //
///////////////

config.DB_TYPE = /** @type {nb.DBType} */ (process.env.DB_TYPE || 'postgres');

config.POSTGRES_DEFAULT_MAX_CLIENTS = 10;
config.POSTGRES_MD_MAX_CLIENTS = (process.env.LOCAL_MD_SERVER === 'true') ? 70 : 10;

//whether to use read-only postgres replica cluster
//ro host is set by operator in process.env.POSTGRES_HOST_RO
config.POSTGRES_USE_READ_ONLY = true;

///////////////////
// SYSTEM CONFIG //
///////////////////

config.DEFAULT_POOL_TYPE = 'HOSTS'; // use 'HOSTS' for setting up a pool of FS backingstores instead
config.DEFAULT_POOL_NAME = 'backingstores'; // only used when config.DEFAULT_POOL_TYPE = 'HOSTS'
config.DEFAULT_BUCKET_NAME = 'first.bucket';
config.INTERNAL_STORAGE_POOL_NAME = 'system-internal-storage-pool';
// config.SPILLOVER_TIER_NAME = 'bucket-spillover-tier';
config.ALLOW_BUCKET_CREATE_ON_INTERNAL = true;
config.BUCKET_AUTOCONF_TIER2_ENABLED = false;
config.SYSTEM_STORE_LOAD_CONCURRENCY = parseInt(process.env.SYSTEM_STORE_LOAD_CONCURRENCY, 10) || 5;
// SYSTEM_STORE_SOURCE determines the preffered source for loading system_store data
// This can be either "DB" to load from the DB or "CORE" to load from the system_server in noobaa-core
config.SYSTEM_STORE_SOURCE = process.env.SYSTEM_STORE_SOURCE?.toUpperCase() || "DB";
//////////////////////////
// MD AGGREGATOR CONFIG //
//////////////////////////

config.MD_AGGREGATOR_ENABLED = true;
config.MD_AGGREGATOR_INTERVAL = 30000;
// the max cycles limits how many intervals the aggregator will split the gap
// the higher this value the higher the time intervals it will scan when trying to close time gaps
config.MD_AGGREGATOR_MAX_CYCLES = 2880; // 1 day / 30 seconds
// Currently the grace is 3 cycles of md_aggregator
// This grace is used since we can hold up an ObjectID and not push it inside the DB
// Which will mean that it will be pushed later on with a previous date
config.MD_GRACE_IN_MILLISECONDS = config.MD_AGGREGATOR_INTERVAL * 3;
config.MD_AGGREGATOR_BATCH = 100;
// Date was chosen as default NooBaa epoch date 2015
config.NOOBAA_EPOCH = 1430006400000;

///////////////
// IO CONFIG //
///////////////

config.MAX_OBJECT_PART_SIZE = 64 * 1024 * 1024;

config.IO_CHUNK_READ_CACHE_SIZE = 256 * 1024 * 1024;

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
config.IO_STREAM_SEMAPHORE_TIMEOUT = 120 * 1000;
config.VIDEO_READ_STREAM_PRE_FETCH_LOAD_CAP = 5 * 1000;
config.IO_SEMAPHORE_CAP = Math.max(
    config.BUFFERS_MEM_LIMIT, // upper limit
    config.IO_STREAM_SEMAPHORE_SIZE_CAP, // minimal size needed to complete jobs in object_io
);

config.DEDUP_ENABLED = true;
config.IO_CALC_MD5_ENABLED = true;
config.IO_CALC_SHA256_ENABLED = true;

config.ERROR_INJECTON_ON_WRITE = 0;
config.ERROR_INJECTON_ON_READ = 0;

///////////////////////////
// AGENT BLOCKS VERIFIER //
///////////////////////////

config.AGENT_BLOCKS_VERIFIER_ENABLED = false;
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
config.OBJECT_RECLAIMER_EMPTY_DELAY = 60 * 60 * 1000; // 1 hour delay
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
config.CHUNK_CODER_REPLICAS = 1;
config.CHUNK_CODER_EC_DATA_FRAGS = 4;
config.CHUNK_CODER_EC_PARITY_FRAGS = 2;
config.CHUNK_CODER_EC_PARITY_TYPE = 'cm256';
config.CHUNK_CODER_EC_TOLERANCE_THRESHOLD = 2;
config.CHUNK_CODER_EC_IS_DEFAULT = false;

// DEDUP
config.MIN_CHUNK_AGE_FOR_DEDUP = 60 * 60 * 1000; // 1 hour

//////////////////////////
// DEDUP INDEXER CONFIG //
//////////////////////////
config.DEDUP_INDEXER_ENABLED = false;
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
config.DB_CLEANER_ENABLED = true;
config.DB_CLEANER_CYCLE = 2 * 60 * 60 * 1000; // 2 hours
config.DB_CLEANER_BACK_TIME = 3 * 30 * 24 * 60 * 60 * 1000; // 3 months
config.DB_CLEANER_DOCS_LIMIT = 1000;
config.DB_CLEANER_MAX_TOTAL_DOCS = 10000;

/////////////////////
// CLOUD RESOURCES //
/////////////////////
// This parameter is used to toggle pool deletion checks that enforce that only the pool and system owners can delete the pool
config.RESTRICT_RESOURCE_DELETION = process.env.RESTRICT_RESOURCE_DELETION === 'true';
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

config.LIFECYCLE_INTERVAL = 8 * 60 * 60 * 1000; // 8h
config.LIFECYCLE_BATCH_SIZE = 1000;
config.LIFECYCLE_SCHEDULE_MIN = 5 * 1000 * 60; // run every 5 minutes
config.LIFECYCLE_ENABLED = true;

//////////////////////////
// STATISTICS_COLLECTOR //
/////////////////////////

config.STATISTICS_COLLECTOR_ENABLED = true;
config.STATISTICS_COLLECTOR_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
config.STATISTICS_COLLECTOR_EXPIRATION = 31 * 24 * 60 * 60 * 1000; // 1 month

///////////////////
// USAGE REPORTS //
///////////////////
config.SERVICES_TYPES = Object.freeze(['AWS', 'AWSSTS', 'AZURE', 'S3_COMPATIBLE', 'GOOGLE', 'FLASHBLADE', 'IBM_COS']);
config.USAGE_AGGREGATOR_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

config.BLOCK_STORE_USAGE_INTERVAL = 1 * 60 * 1000; // 1 minute


//////////////////
// DEBUG CONFIG //
//////////////////

config.DEBUG_MODE_PERIOD = 10 * 60 * 1000; // 10 minutes for increased debug level

config.dbg_log_level = 0;
config.DEBUG_FACILITY = 'LOG_LOCAL0';
config.EVENT_FACILITY = 'LOG_LOCAL2';
config.EVENT_LOGGING_ENABLED = false; // should be changed in NC NSFS configuration
config.EVENT_LEVEL = 5;

config.LOG_TO_STDERR_ENABLED = true;
config.LOG_TO_SYSLOG_ENABLED = false;

config.LOG_COLOR_ENABLED = process.env.NOOBAA_LOG_COLOR ? process.env.NOOBAA_LOG_COLOR === 'true' : true;

// TEST Mode
config.test_mode = false;
config.allow_anonymous_access_in_test = false; // used for emulating ACL='public-read' for ceph-s3 tests

// On Premise NVA params
config.on_premise = {
    base_url: "https://s3-eu-west-1.amazonaws.com/noobaa-download/on_premise/v_",
    nva_part: "NVA_Upgrade.tgz"
};

// the threshold in ms for logging long running queries
config.LONG_DB_QUERY_THRESHOLD = parseInt(process.env.LONG_DB_QUERY_THRESHOLD, 10) || 5000;
config.INVALID_SCHEMA_DB_INSPECT_ENABLED = true;

/*
  Central Stats Collection & Diagnostics
*/

const is_windows = (process.platform === 'win32');

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
config.PROMETHEUS_SERVER_RETRY_COUNT = Infinity;
config.PROMETHEUS_SERVER_RETRY_DELAY = 5 * 60 * 1000; // 5 min
config.PROMETHEUS_PREFIX = 'NooBaa_';

// Ports where prometheus metrics are served
config.WS_METRICS_SERVER_PORT = 7001;
config.BG_METRICS_SERVER_PORT = 7002;
config.HA_METRICS_SERVER_PORT = 7003;
config.EP_METRICS_SERVER_PORT = 7004;
config.EP_METRICS_SERVER_SSL_PORT = 9443;

//////////////////////////////
// OAUTH RELATES            //
//////////////////////////////

config.OAUTH_REDIRECT_ENDPOINT = 'fe/oauth/callback';
config.OAUTH_REQUIRED_SCOPE = 'user:info';
config.OAUTH_REQUIRED_GROUPS = [
    'system:cluster-admins',
    'cluster-admins'
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

///////////////////////////////
// FILES RELATED             //
///////////////////////////////
config.INLINE_MAX_SIZE = 4096;

///////////////////////////////
// CACHE (ACCOUNT, BUCKET)   //
///////////////////////////////

// Object SDK bucket cache expiration time
config.OBJECT_SDK_BUCKET_CACHE_EXPIRY_MS = 60000;
// Object SDK account cache expiration time
config.OBJECT_SDK_ACCOUNT_CACHE_EXPIRY_MS = Number(process.env.ACCOUNTS_CACHE_EXPIRY) || 10 * 60 * 1000; // TODO: Decide on a time that we want to invalidate
// Accountspace_fs account id cache expiration time
config.ACCOUNTS_ID_CACHE_EXPIRY = 3 * 60 * 1000; // TODO: Decide on a time that we want to invalidate


// Object SDK bucket_namespace_cache allow stat of the config file
config.NC_ENABLE_BUCKET_NS_CACHE_STAT_VALIDATION = true;
// Object SDK account_cache allow stat of the config file
config.NC_ENABLE_ACCOUNT_CACHE_STAT_VALIDATION = true;
// accountspace_fs allow stat of the config file
config.NC_ENABLE_ACCOUNT_ID_CACHE_STAT_VALIDATION = true;

//////////////////////////////
// OPERATOR RELATED         //
//////////////////////////////

config.OPERATOR_ACCOUNT_EMAIL = 'operator@noobaa.io';

///////////////////////////////
//        WORM RELATED       //
///////////////////////////////

config.WORM_ENABLED = false;

////////////////////////////////
//      NAMESPACE MONITOR     //
////////////////////////////////

config.NAMESPACE_MONITOR_ENABLED = true;
config.NAMESPACE_MONITOR_DELAY = 3 * 60 * 1000;

//////////////////////////////////
//      NAMESPACE MODE CALC     //
//////////////////////////////////

config.NS_MAX_ALLOWED_IO_ERRORS = 9;

////////////////////////////////
//      BUCKET REPLICATOR     //
////////////////////////////////

config.BUCKET_REPLICATOR_DELAY = 5 * 60 * 1000;
config.BUCKET_REPLICATOR_LIST_LIMIT = 1000;
config.BUCKET_REPLICATION_MAX_RULES = 1000;
config.BUCKET_REPLICATION_MAX_DST_BUCKETS = 100;
config.REPLICATION_SEMAPHORE_CAP = 5000;
config.REPLICATION_SEMAPHORE_TIMEOUT = 300 * 1000;
config.REPLICATION_ENABLED = true;
config.LOG_REPLICATION_ENABLED = true;
config.AWS_LOG_CANDIDATES_LIMIT = 10;
config.BUCKET_LOG_REPLICATOR_DELAY = 5 * 60 * 1000;
config.AZURE_QUERY_TRUNCATION_MAX_SIZE_IN_BITS = 10 * 1024 * 1024;
config.BUCKET_DIFF_FOR_REPLICATION = true;

////////////////////////////////
//      BUCKET LOGGING        //
////////////////////////////////

config.BUCKET_LOG_UPLOAD_ENABLED = true;
config.BUCKET_LOG_UPLOADER_DELAY = 5 * 60 * 1000;
config.BUCKET_LOG_TYPE = process.env.GUARANTEED_LOGS_PATH ? 'PERSISTENT' : 'BEST_EFFORT';
config.PERSISTENT_BUCKET_LOG_DIR = process.env.GUARANTEED_LOGS_PATH;
config.PERSISTENT_BUCKET_LOG_NS = 'bucket_logging';
config.BUCKET_LOG_CONCURRENCY = 10;

////////////////////////////////
//      NOTIFICATIONS         //
////////////////////////////////
config.NOTIFICATION_CONNECT_DIR = process.env.NOTIFICATION_CONNECT_DIR || '/etc/notif_connect/';
config.NOTIFICATION_LOG_NS = 'notification_logging';
config.NOTIFICATION_LOG_DIR = process.env.NOTIFICATION_LOG_DIR;
config.NOTIFICATION_BATCH = process.env.BATCH || 10;
config.NOTIFICATION_REQ_PER_SPACE_CHECK = process.env.NOTIFICATION_REQ_PER_SPACE_CHECK || 0;
config.NOTIFICATION_SPACE_CHECK_THRESHOLD = parseFloat(process.env.NOTIFICATION_SPACE_CHECK_THRESHOLD) || 0.2;

///////////////////////////
//      KEY ROTATOR      //
///////////////////////////

config.KEY_ROTATOR_ENABLED = true;
config.KEY_ROTATOR_RUN_INTERVAL = 24 * 60 * 60 * 1000; // Once a day,
config.KEY_ROTATOR_ERROR_DELAY = 10 * 60 * 1000; // Run again in 10 minutes

///////////////////////
// NAMESPACE CACHING //
///////////////////////

config.NAMESPACE_CACHING = {
    DEFAULT_CACHE_TTL_MS: 0,
    DEFAULT_BLOCK_SIZE: 64 * 1024,
    DEFAULT_MAX_CACHE_OBJECT_SIZE: 4 * 1024 * 1024 * 1024 * 1024,
    DISABLE_BUCKET_FREE_SPACE_CHECK: false,
    CACHE_USAGE_PERCENTAGE_HIGH_THRESHOLD: 80,
    PART_COUNT_HIGH_THRESHOLD: 5,
    CACHED_PERCENTAGE_LOW_THRESHOLD: 40,
    CACHED_PERCENTAGE_HIGH_THRESHOLD: 80,
    UPLOAD_SEMAPHORE_TIMEOUT: 30 * 1000,
    MIN_OBJECT_AGE_FOR_GC: 1000 * 60 * 60 * 24,
    UPLOAD_SEMAPHORE_CAP: config.BUFFERS_MEM_LIMIT,
    ACL_HANDLING: /** @type { 'reject' | 'pass-through' | '' } */ (''),
};

assert(config.NAMESPACE_CACHING.DEFAULT_BLOCK_SIZE <= config.NAMESPACE_CACHING.DEFAULT_MAX_CACHE_OBJECT_SIZE);
assert(config.NAMESPACE_CACHING.DEFAULT_BLOCK_SIZE <= config.MAX_OBJECT_PART_SIZE);
assert(config.NAMESPACE_CACHING.DEFAULT_BLOCK_SIZE > config.INLINE_MAX_SIZE);

//////////////////
// NAMESPACE FS //
//////////////////

config.NSFS_BUF_SIZE_XS = 4 * 1024;
config.NSFS_BUF_SIZE_S = 64 * 1024;
config.NSFS_BUF_SIZE_M = 1 * 1024 * 1024;
config.NSFS_BUF_SIZE_L = 8 * 1024 * 1024;
config.NSFS_BUF_SIZE_XL = 64 * 1024 * 1024;

// This configs help calculate the number of small and XS buffers that will be created
// The top number of buffers we want of the small and extra small sizes - 512 seems to be enough
config.NSFS_WANTED_BUFFERS_NUMBER = 512;
// XS and S are small enough so we always allocate the max number of wanted buffers (overall ~34MB)
config.NSFS_BUF_POOL_MEM_LIMIT_XS = config.NSFS_BUF_SIZE_XS * config.NSFS_WANTED_BUFFERS_NUMBER;
config.NSFS_BUF_POOL_MEM_LIMIT_S = config.NSFS_BUF_SIZE_S * config.NSFS_WANTED_BUFFERS_NUMBER;
const remaining_mem = config.BUFFERS_MEM_LIMIT - config.NSFS_BUF_POOL_MEM_LIMIT_S - config.NSFS_BUF_POOL_MEM_LIMIT_XS;
// M buffers get 10% of remaining memory, with 4GB mem and M size of 1MB this gives ~400 M buffers
config.NSFS_BUF_POOL_MEM_LIMIT_M = range_utils.align_down(remaining_mem * 0.1, config.NSFS_BUF_SIZE_M);
// L buffers share 90% of remaining memory, with 4GB mem and L size of 8MB this gives ~450 L buffers
config.NSFS_BUF_POOL_MEM_LIMIT_L = range_utils.align_down(remaining_mem * 0.9, config.NSFS_BUF_SIZE_L);
// XL buffers are treated as extension to the memory and will be allocated on top as needed,
// however we will periodically release unused XL buffers back to the system
config.NSFS_BUF_POOL_MEM_LIMIT_XL = config.NSFS_WANTED_BUFFERS_NUMBER * config.NSFS_BUF_SIZE_XL;
// XL buffers not used in the last interval will be released back to the system (0 means disable)
config.NSFS_BUF_POOL_XL_RELEASE_UNUSED_INTERVAL = 0;

config.NSFS_BUF_WARMUP_SPARSE_FILE_READS = true;

config.NSFS_DEFAULT_IOV_MAX = 1024; // see IOV_MAX in https://man7.org/linux/man-pages/man0/limits.h.0p.html

// the temporary path for uploads and other internal files
config.NSFS_TEMP_DIR_NAME = '.noobaa-nsfs';

config.NSFS_FOLDER_OBJECT_NAME = '.folder';

config.NSFS_DIR_CACHE_MAX_DIR_SIZE = 64 * 1024 * 1024;
config.NSFS_DIR_CACHE_MIN_DIR_SIZE = 64;
config.NSFS_DIR_CACHE_MAX_TOTAL_SIZE = 4 * config.NSFS_DIR_CACHE_MAX_DIR_SIZE;

config.NSFS_OPEN_READ_MODE = 'r'; // use 'rd' for direct io

config.BASE_MODE_FILE = 0o666;
config.BASE_MODE_DIR = 0o777;
// umask that will be used for creation of directories and files with no permissions for 'others'
config.NSFS_UMASK = 0o007;

// The threshold in milliseconds for prompting a warning
config.NSFS_WARN_THRESHOLD_MS = 100;

config.NSFS_CALCULATE_MD5 = false;
config.NSFS_TRIGGER_FSYNC = true;
config.NSFS_CHECK_BUCKET_BOUNDARIES = true;
config.NSFS_CHECK_BUCKET_PATH_EXISTS = true;
config.NSFS_REMOVE_PARTS_ON_COMPLETE = true;

config.NSFS_BUF_POOL_WARNING_TIMEOUT = 2 * 60 * 1000;
config.NSFS_SEM_WARNING_TIMEOUT = 10 * 60 * 1000;
// number of rename retries in case of deleted destination directory
config.NSFS_RENAME_RETRIES = 10;
config.NSFS_MKDIR_PATH_RETRIES = 3;
config.NSFS_RANDOM_DELAY_BASE = 70;

config.NSFS_VERSIONING_ENABLED = true;
config.NSFS_UPDATE_ISSUES_REPORT_ENABLED = true;

config.NSFS_EXIT_EVENTS_TIME_FRAME_MIN = 24 * 60; // per day
config.NSFS_MAX_EXIT_EVENTS_PER_TIME_FRAME = 10; // allow max 10 failed forks per day

config.GPFS_DL_PATH = '/usr/lpp/mmfs/lib/libgpfs.so';
config.NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS = 'true';

config.NSFS_GLACIER_LOGS_DIR = '/var/run/noobaa-nsfs/wal';
config.NSFS_GLACIER_LOGS_POLL_INTERVAL = 10 * 1000;

// NSFS_GLACIER_ENABLED can override internal autodetection and will force
// the use of restore for all objects.
config.NSFS_GLACIER_ENABLED = false;
config.NSFS_GLACIER_LOGS_ENABLED = false;
config.NSFS_GLACIER_BACKEND = 'TAPECLOUD';

// TAPECLOUD Glacier backend specific configs
config.NSFS_GLACIER_TAPECLOUD_BIN_DIR = '/opt/ibm/tapecloud/bin';

// If set to true will disable cleanup of the task show output
// Should be used only for debugging or else will keep filling
// up the disk space.
config.NSFS_GLACIER_TAPECLOUD_PRESERVE_TASK_SHOW_OUTPUT = false;

// NSFS_GLACIER_MIGRATE_INTERVAL indicates the interval between runs
// of `manage_nsfs glacier migrate`
config.NSFS_GLACIER_MIGRATE_INTERVAL = 15 * 60 * 1000;

// NSFS_GLACIER_RESTORE_INTERVAL indicates the interval between runs
// of `manage_nsfs glacier restore`
config.NSFS_GLACIER_RESTORE_INTERVAL = 15 * 60 * 1000;

// NSFS_GLACIER_EXPIRY_RUN_TIME must be of the format hh:mm which specifies
// when NooBaa should allow running glacier expiry process
// NOTE: This will also be in the same timezone as specified in
// NSFS_GLACIER_EXPIRY_TZ
config.NSFS_GLACIER_EXPIRY_RUN_TIME = '03:00';

// NSFS_GLACIER_EXPIRY_RUN_TIME_TOLERANCE_MINS configures the delay
// tolerance in minutes.
//
// eg. If the expiry run time is set to 03:00 and the tolerance is
// set to be 2 mins then the expiry can trigger till 03:02 (unless
// already triggered between 03:00 - 03:02
config.NSFS_GLACIER_EXPIRY_RUN_DELAY_LIMIT_MINS = 2 * 60;

/** @type {'UTC' | 'LOCAL'} */
config.NSFS_GLACIER_EXPIRY_TZ = 'LOCAL';

// Format must be HH:MM:SS
//
// if set to empty string then time of processing
// the request will be used
config.NSFS_GLACIER_EXPIRY_TIME_OF_DAY = '';

// If set to to true, NooBaa will attempt to read DMAPI
// xattrs
config.NSFS_GLACIER_DMAPI_ENABLE = false;

// NSFS_GLACIER_DMAPI_IMPLICIT_RESTORE_STATUS if enabled then
// NooBaa will derive restore status of the files based on DMAPI
// xattr IF there are no explicit restore status attributes on
// the file.
config.NSFS_GLACIER_DMAPI_IMPLICIT_RESTORE_STATUS = false;

// If set to true then NooBaa will consider DMAPI extended attributes
// in conjuction with NooBaa's `user.storage_class` extended attribute
// to determine state of an object.
//
// NOTE:NSFS_GLACIER_DMAPI_ENABLE should be enabled to use this.
config.NSFS_GLACIER_DMAPI_IMPLICIT_SC = false;

// NSFS_GLACIER_DMAPI_ALLOW_NOOBAA_TAKEOVER allows NooBaa to take over lifecycle
// management of an object which was originally NOT managed by NooBaa.
//
// NOTE:NSFS_GLACIER_DMAPI_ENABLE and NSFS_GLACIER_USE_DMAPI should be enabled to use this.
config.NSFS_GLACIER_DMAPI_ALLOW_NOOBAA_TAKEOVER = false;

// NSFS_GLACIER_DMAPI_TPS_HTTP_HEADER_ENABLE if true will add additional HTTP headers
// `config.NSFS_GLACIER_DMAPI_TPS_HTTP_HEADER` based on `dmapi.IBMTPS` EA.
//
// NOTE:NSFS_GLACIER_DMAPI_ENABLE should be enabled to use this.
config.NSFS_GLACIER_DMAPI_TPS_HTTP_HEADER_ENABLE = false;
config.NSFS_GLACIER_DMAPI_TPS_HTTP_HEADER = 'x-tape-meta-copy';

// NSFS_GLACIER_DMAPI_PMIG_DAYS controls the "virtual"/fake expiry
// days that will be shown if we detect a glacier object whose life-
// cycle NSFS doesn't controls
//
// This is initialized to be the same as S3_RESTORE_REQUEST_MAX_DAYS
// but can be overridden to any numberical value
config.NSFS_GLACIER_DMAPI_PMIG_DAYS = config.S3_RESTORE_REQUEST_MAX_DAYS;

// NSFS_GLACIER_DMAPI_FINALIZE_RESTORE_ENABLE if enabled will force NooBaa to
// examine the DMAPI xattr of the file before finalizing the restore to prevent
// accidental blocking reads from happening.
config.NSFS_GLACIER_DMAPI_FINALIZE_RESTORE_ENABLE = false;

config.NSFS_STATFS_CACHE_SIZE = 10000;
config.NSFS_STATFS_CACHE_EXPIRY_MS = 1 * 1000;

// NSFS_LOW_FREE_SPACE_CHECK_ENABLED if set to true will use the below mentioned
// thresholds to determine if the writes should be denied even
// before we hit ENOSPC more filesystem.
config.NSFS_LOW_FREE_SPACE_CHECK_ENABLED = false;

// NSFS_LOW_FREE_SPACE_MB controls that how much space in
// bytes does NooBaa consider to be too low to perform `PUT` operations
// safely.
config.NSFS_LOW_FREE_SPACE_MB = 8 * 1024;

// NSFS_LOW_FREE_SPACE_PERCENT controls how much space in terms of
// percentage does NooBaa consider to be too low to perform `PUT`
// operations safely.
config.NSFS_LOW_FREE_SPACE_PERCENT = 0.08;

// NSFS_LOW_FREE_SPACE_MB_UNLEASH controls how much much space in bytes
// does NooBaa consider to be enough to perform `PUT` operations
// safely.
config.NSFS_LOW_FREE_SPACE_MB_UNLEASH = 10 * 1024;

// NSFS_LOW_FREE_SPACE_PERCENT_UNLEASH controls how much much space in of
// percentage does NooBaa consider to be enough to perform `PUT`
// operations safely.
config.NSFS_LOW_FREE_SPACE_PERCENT_UNLEASH = 0.10;

// NSFS_GLACIER_GET_FORCE_EXPIRE if set to true then any restored item in the GLACIER
// storage class will expire as soon as first GET request is received for it or
// if the previous restore time has exceed, whichever is the earlier.
config.NSFS_GLACIER_FORCE_EXPIRE_ON_GET = false;

// NSFS_GLACIER_MIGRATE_LOG_THRESHOLD controls that how big the migration log file should be
// Once this size is exceeded, migrate calls are supposed to kick in regardless of configured
// interval
config.NSFS_GLACIER_MIGRATE_LOG_THRESHOLD = 50 * 1024;

// NSFS_GLACIER_METRICS_STAT_PATHS if set NooBaa will start reporting the statfs info of that
// path as part of its metrics report
config.NSFS_GLACIER_METRICS_STATFS_PATHS = [];
config.NSFS_GLACIER_METRICS_STATFS_INTERVAL = 60 * 1000; // Refresh statfs value every minute

/** 
 * NSFS_GLACIER_RESERVED_BUCKET_TAGS defines an object of bucket tags which will be reserved
 * by the system and PUT operations for them via S3 API would be limited - as in they would be
 * mutable only if specified and only under certain conditions.
 *
 * @type {Record<string, {
 *  schema: Record<any, any> & { $id: string },
 *  immutable: true | false | 'if-data',
 *  default: any,
 *  event: boolean
 * }>}
 * 
 * @example
 * {
    'deep-archive-copies': {
        schema: {
            $id: 'deep-archive-copies-schema-v0',
            enum: ['1', '2']
        }, // JSON Schema
        immutable: 'if-data',
        default: '1',
        event: true
    }
 * }
 */
config.NSFS_GLACIER_RESERVED_BUCKET_TAGS = {};

config.NSFS_LOGGER_LOCK_CHECK_INTERVAL = process.env.NODE_ENV === 'test' ? 10 : 1000;

// anonymous account name
config.ANONYMOUS_ACCOUNT_NAME = 'anonymous';

config.NSFS_UPLOAD_STREAM_MEM_THRESHOLD = 8 * 1024 * 1024;
config.NSFS_DOWNLOAD_STREAM_MEM_THRESHOLD = 8 * 1024 * 1024;

// we want to change our handling related to EACCESS error
config.NSFS_LIST_IGNORE_ENTRY_ON_EACCES = true;
// we will for now handle the same way also EINVAL error - for gpfs stat issues on list (.snapshots)
config.NSFS_LIST_IGNORE_ENTRY_ON_EINVAL = true;

config.NSFS_CUSTOM_BUCKET_PATH_HTTP_HEADER = 'x-noobaa-custom-bucket-path';
config.NSFS_CUSTOM_BUCKET_PATH_ALLOWED_LIST = ''; // colon separated list of paths prefixes

config.NSFS_SPEEDOMETER_ENABLED = false;

////////////////////////////
// NSFS NON CONTAINERIZED //
////////////////////////////

config.ENDPOINT_PROCESS_TITLE = 'noobaa';
config.NC_RELOAD_CONFIG_INTERVAL = 10 * 1000;
config.NSFS_NC_CONF_DIR_REDIRECT_FILE = 'config_dir_redirect';
config.NSFS_NC_DEFAULT_CONF_DIR = '/etc/noobaa.conf.d';
config.NSFS_NC_CONF_DIR = process.env.NSFS_NC_CONF_DIR || '';
config.NSFS_TEMP_CONF_DIR_NAME = '.noobaa-config-nsfs';
config.NSFS_NC_CONFIG_DIR_BACKEND = '';
config.NSFS_NC_STORAGE_BACKEND = '';
config.ENDPOINT_PORT = Number(process.env.ENDPOINT_PORT) || 6001;
config.ENDPOINT_SSL_PORT = Number(process.env.ENDPOINT_SSL_PORT) || 6443;
// Remove the NSFS condition when NSFS starts to support STS.
config.ENDPOINT_SSL_STS_PORT = Number(process.env.ENDPOINT_SSL_STS_PORT) || (process.env.NC_NSFS_NO_DB_ENV === 'true' ? -1 : 7443);
// Remove the NC NSFS condition when NC NSFS starts to support IAM.
config.ENDPOINT_SSL_IAM_PORT = Number(process.env.ENDPOINT_SSL_IAM_PORT) || (process.env.NC_NSFS_NO_DB_ENV === 'true' ? -1 : 13443);
// each fork will get port in range [ENDPOINT_FORK_PORT_BASE, ENDPOINT_FORK_PORT_BASE + number of forks - 1)]
config.ENDPOINT_FORK_PORT_BASE = Number(process.env.ENDPOINT_FORK_PORT_BASE) || 6002;
config.ALLOW_HTTP = false;
config.ALLOW_HTTP_METRICS = true;
config.ALLOW_HTTPS_METRICS = true;
// config files should allow access to the owner of the files
config.BASE_MODE_CONFIG_FILE = 0o600;
config.BASE_MODE_CONFIG_DIR = 0o700;

config.S3_SERVER_IP_WHITELIST = [];
config.VIRTUAL_HOSTS = process.env.VIRTUAL_HOSTS || '';

config.NC_HEALTH_ENDPOINT_RETRY_COUNT = 3;
config.NC_HEALTH_ENDPOINT_RETRY_DELAY = 10;
config.NC_FORK_SERVER_TIMEOUT = 5; // 5 minutes
config.NC_FORK_SERVER_RETRIES = 10;


/** @type {'file' | 'executable'} */
config.NC_MASTER_KEYS_STORE_TYPE = 'file';
// unless override in config.json, the default will be the config_dir/master_keys.json
config.NC_MASTER_KEYS_FILE_LOCATION = '';
config.NC_MASTER_KEYS_GET_EXECUTABLE = '';
config.NC_MASTER_KEYS_PUT_EXECUTABLE = '';
config.NC_MASTER_KEYS_MANAGER_REFRESH_THRESHOLD = -1; // currently we want to disable automatic refresh
config.MASTER_KEYS_EXEC_MAX_RETRIES = 3;

config.NC_DISABLE_ACCESS_CHECK = false;
config.NC_DISABLE_HEALTH_ACCESS_CHECK = false;
config.NC_DISABLE_POSIX_MODE_ACCESS_CHECK = true;
config.NC_DISABLE_SCHEMA_CHECK = false;

config.ENTROPY_DISK_SIZE_THRESHOLD = 100 * 1024 * 1024;
config.ENTROPY_MIN_THRESHOLD = 512;

config.NC_HEALTH_BUCKETS_COUNT_LIMIT_WARNING = 5000;
config.NC_HEALTH_ACCOUNTS_COUNT_LIMIT_WARNING = 5000;

////////// NC LIFECYLE  //////////

config.NC_LIFECYCLE_LOGS_DIR = '/var/log/noobaa/lifecycle';
config.NC_LIFECYCLE_CONFIG_DIR_NAME = 'lifecycle';
config.NC_LIFECYCLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

// NC_LIFECYCLE_RUN_TIME must be of the format hh:mm which specifies
// when NooBaa should allow running nc lifecycle process
// NOTE: This will also be in the same timezone as specified in
// NC_LIFECYCLE_TZ
config.NC_LIFECYCLE_RUN_TIME = '00:00';

// NC_LIFECYCLE_RUN_DELAY_LIMIT_MINS configures the delay
// tolerance in minutes.
//
// eg. If the expiry run time is set to 00:00 and the tolerance is
// set to be 2 mins then the expiry can trigger till 00:02 (unless
// already triggered between 00:00 - 00:02
config.NC_LIFECYCLE_RUN_DELAY_LIMIT_MINS = 2;

/** @type {'UTC' | 'LOCAL'} */
config.NC_LIFECYCLE_TZ = 'LOCAL';

config.NC_LIFECYCLE_LIST_BATCH_SIZE = 1000;
config.NC_LIFECYCLE_BUCKET_BATCH_SIZE = 10000;

config.NC_LIFECYCLE_GPFS_ILM_ENABLED = true;
config.NC_LIFECYCLE_GPFS_ALLOW_SCAN_ON_REMOTE = true;
config.NC_GPFS_BIN_DIR = '/usr/lpp/mmfs/bin/';
config.NC_LIFECYCLE_GPFS_MMAPPLY_ILM_POLICY_CONCURRENCY = 1;

////////// GPFS //////////
config.GPFS_DOWN_DELAY = 1000;


//Quota
config.QUOTA_LOW_THRESHOLD = 80;
config.QUOTA_MAX_OBJECTS = Number.MAX_SAFE_INTEGER;

//////////////////////////
//      STS CONFIG      //
//////////////////////////

config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
config.STS_MIN_DURATION_SECONDS = 15 * 60; // 15 minutes
config.STS_MAX_DURATION_SECONDS = 12 * 60 * 60; // 12 hours

/////////////////////////
// BLOCK STORE FS      //
/////////////////////////

config.BLOCK_STORE_CACHE_SIZE = 256 * 1024 * 1024;

config.BLOCK_STORE_FS_CACHED_DF_MAX_TIME = 30 * 1000; // 30 seconds
config.BLOCK_STORE_FS_CACHED_DF_MIN_TIME = 1 * 1000; // 1 seconds
config.BLOCK_STORE_FS_CACHED_DF_MIN_SPACE = 1 * 1024 * 1024 * 1024; // 1 GB

config.BLOCK_STORE_FS_TMFS_ENABLED = false;
config.BLOCK_STORE_FS_MAPPING_INFO_ENABLED = false;
config.BLOCK_STORE_FS_TMFS_ALLOW_MIGRATED_READS = true;

config.BLOCK_STORE_FS_XATTR_BLOCK_MD = 'user.noobaa.block_md';
config.BLOCK_STORE_FS_XATTR_QUERY_MIGSTAT = 'user._query.migstat';
config.BLOCK_STORE_FS_XATTR_TRIGGER_RECALL = 'user._trigger.recall';
config.BLOCK_STORE_FS_XATTR_TRIGGER_MIGRATE = 'user._trigger.migrate';
config.BLOCK_STORE_FS_XATTR_TRIGGER_PREMIGRATE = 'user._trigger.premigrate';

config.TIERING_TTL_WORKER_ENABLED = false;
config.TIERING_TTL_WORKER_BATCH_SIZE = 1000;
config.TIERING_TTL_WORKER_BATCH_DELAY = 1 * 60 * 1000; // 1 minutes
config.TIERING_TTL_MS = 30 * 60 * 1000; // 30 minutes

/////////////////////////
// AWS SDK VERSION     //
/////////////////////////

config.AWS_SDK_VERSION_3_ENABLED = true;
config.DEFAULT_REGION = 'us-east-1';

/////////////////////////
///  VACCUM ANALYZER  ///
/////////////////////////

config.VACCUM_ANALYZER_INTERVAL = 86400000;

config.NOOBAA_METRICS_AUTH_ENABLED = process.env.NOOBAA_METRICS_AUTH_ENABLED === 'true';
config.NOOBAA_VERSION_AUTH_ENABLED = process.env.NOOBAA_VERSION_AUTH_ENABLED === 'true';

//////////////
///  RDMA  ///
//////////////

// rdma is not enabled by default
config.S3_RDMA_ENABLED = false;
// enable direct path of client RDMA to GPFS for zero copy,
// requires RDMA to be enabled and GPFS library with zero copy support (auto-detected)
config.S3_RDMA_GPFS_ZERO_COPY_ENABLED = false;

/** @type {string[]} */
config.S3_RDMA_SERVER_IPS = [];

/** @type {'ERROR' | 'INFO' | 'DEBUG'} */
config.S3_RDMA_LOG_LEVEL = 'INFO';
config.S3_RDMA_USE_TELEMETRY = true;

// Dynamic Connection key value used for RDMA secure communication. Default: 0xffeeddcc. Must match between client and server.
config.S3_RDMA_DC_KEY = 0xffeeddcc;
// Number of Dynamic Connection Interfaces (DCIs) - controls max concurrent connections. Default: 128
config.S3_RDMA_NUM_DCIS = 128; // increase for higher concurrency
// async events are false by default because thread pool provides better performance
config.S3_RDMA_USE_ASYNC_EVENTS = false;

// client request header that identifies the RDMA token type and the library used
config.S3_RDMA_AGENT_HDR = 'x-amz-rdma-agent';
config.S3_RDMA_AGENT_CUOBJ = 'cuobj';
// client request header for the RDMA token
config.S3_RDMA_TOKEN_HDR = 'x-amz-rdma-token';
config.S3_RDMA_VALIDATE_TOKEN_HDR = true;
// server response header for reply code (e.g. 200, 204, 206, 501) 
config.S3_RDMA_REPLY_HDR = 'x-amz-rdma-reply';
// server response header for number of bytes transferred
config.S3_RDMA_BYTES_HDR = 'x-amz-rdma-bytes';

/////////////////////
//                 //
//    OVERRIDES    //
//                 //
//  KEEP ME LAST!  //
//                 //
/////////////////////

// load a local config file that overwrites some of the config
function load_config_local() {
    try {
        // looking up config-local module using process.cwd() to allow pkg to find it
        // outside the binary package - see https://github.com/vercel/pkg#snapshot-filesystem
        // @ts-ignore
        // eslint-disable-next-line global-require
        const local_config = require(path.join(process.cwd(), 'config-local'));
        if (!local_config) return;
        console.warn('load_config_local: LOADED', local_config);
        if (typeof local_config === 'function') {
            const local_config_func = /** @type {function} */ (local_config);
            local_config_func(config);
        } else if (typeof local_config === 'object') {
            const local_config_obj = /** @type {object} */ (local_config);
            Object.assign(config, local_config_obj);
        } else {
            throw new Error(`Expected object or function to be exported from config-local - ${typeof local_config}`);
        }
    } catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
}

// load env variables to override if exists (should start with CONFIG_JS_)
function load_config_env_overrides() {
    const ENV_PREFIX = 'CONFIG_JS_';
    for (const [key, val] of Object.entries(process.env)) {
        if (!key.startsWith(ENV_PREFIX)) continue;
        try {
            const conf_name = key.substring(ENV_PREFIX.length).replace(/__/g, '.');
            const prev_val = config[conf_name];
            const type = typeof prev_val;

            if (type === 'number') {
                const n = Number(val);
                if (isNaN(n)) throw new Error(`${val} should be a number`);
                console.warn(`Overriding config.js from ENV with ${conf_name}=${n} (number)`);
                config[conf_name] = n;

            } else if (type === 'boolean') {
                if (val === 'true') {
                    console.warn(`Overriding config.js from ENV with ${conf_name}=true (bool)`);
                    config[conf_name] = true;
                } else if (val === 'false') {
                    console.warn(`Overriding config.js from ENV with ${conf_name}=false (bool)`);
                    config[conf_name] = false;
                } else {
                    throw new Error(`${val} should be true|false`);
                }

            } else if (type === 'string' || type === 'undefined') {
                console.warn(`Overriding config.js from ENV with ${conf_name}=${val} (string)`);
                config[conf_name] = val;

            } else if (type === 'object') {
                // TODO: Validation checks, more complex type casting for values if needed
                config[conf_name] = Array.isArray(prev_val) ? val.split(',') : JSON.parse(val);
                console.warn(`Overriding config.js from ENV with ${conf_name}=${val} (object of type ${Array.isArray(prev_val) ? 'array' : 'json'})`);
            } else {
                console.warn(`Unknown type or mismatch between existing ${type} and provided type for ${conf_name}, skipping ...`);
            }

        } catch (err) {
            console.warn(`load_config_env_overrides: failed to load ${key}`, err);
        }
    }
}

function _get_data_from_file(file_name) {
    let data;
    try {
        data = fs.readFileSync(file_name).toString();
    } catch (e) {
        console.warn(`Error accrued while getting the data from ${file_name}: ${e}`);
        return;
    }
    return data;
}

/**
 * @returns {string}
 */
function _get_config_root() {
    let config_root = config.NSFS_NC_DEFAULT_CONF_DIR;
    try {
        const redirect_path = path.join(config.NSFS_NC_DEFAULT_CONF_DIR, config.NSFS_NC_CONF_DIR_REDIRECT_FILE);
        const data = _get_data_from_file(redirect_path);
        config_root = data.toString().trim();
    } catch (err) {
        console.warn('config.get_config_root - could not find custom config_root, will use the default config_root ', config_root);
    }
    return config_root;
}

/**
 * go over the config object and set the relevant configurations as environment variables
 */
function _set_nc_config_to_env() {
    const config_to_env = ['NOOBAA_LOG_LEVEL', 'UV_THREADPOOL_SIZE', 'GPFS_DL_PATH', 'NSFS_ENABLE_DYNAMIC_SUPPLEMENTAL_GROUPS'];
    for (const configuration_key of config_to_env) {
        if (config && Object.keys(config).includes(configuration_key) && config[configuration_key] !== undefined) {
            console.warn('setting configuration_key as env var', configuration_key, config[configuration_key]);
            process.env[configuration_key] = config[configuration_key];
        }
    }
}

/**
 * validate_nc_master_keys_config validates the following -
 * 1. if type is file -
 *    1.1. no GET/PUT executables provided
 * 2. if type is executable -
 *    2.1. no file location provided
 *    2.2. GET & PUT executables exist and executables
 */
function validate_nc_master_keys_config(config_data) {
    if (config_data.NC_MASTER_KEYS_STORE_TYPE === 'file') {
        if (config_data.NC_MASTER_KEYS_GET_EXECUTABLE ||
            config_data.NC_MASTER_KEYS_PUT_EXECUTABLE) {
            throw new Error('Invalid master keys config, can not specify executables when store type is file');
        }
    } else if (config_data.NC_MASTER_KEYS_STORE_TYPE === 'executable') {
        if (config_data.NC_MASTER_KEYS_FILE_LOCATION) {
            throw new Error('Invalid master keys config, can not specify executables when store type is executable');
        }
        if (!config_data.NC_MASTER_KEYS_GET_EXECUTABLE ||
            !config_data.NC_MASTER_KEYS_PUT_EXECUTABLE) {
            throw new Error('Invalid master keys config, must specify GET & PUT executables when store type is executable');
        }
        _validate_executable(config_data.NC_MASTER_KEYS_GET_EXECUTABLE);
        _validate_executable(config_data.NC_MASTER_KEYS_PUT_EXECUTABLE);
    } else {
        throw new Error(`Invalid master keys config, invalid master keys store type ${config_data.NC_MASTER_KEYS_STORE_TYPE}`);
    }
}

/**
 * load_nsfs_nc_config loads on non containerized env the config.json file and sets the configurations
 */
function load_nsfs_nc_config() {
    if (process.env.CONTAINER_PLATFORM) return;
    try {
        if (!config.NSFS_NC_CONF_DIR) {
            config.NSFS_NC_CONF_DIR = _get_config_root();
            console.warn('load_nsfs_nc_config.setting config.NSFS_NC_CONF_DIR', config.NSFS_NC_CONF_DIR);
        }
        const config_path = path.join(config.NSFS_NC_CONF_DIR, 'config.json');
        const config_data = require(config_path);
        nsfs_schema_utils.validate_nsfs_config_schema(config_data);

        const shared_config = _.omit(config_data, 'host_customization');
        const node_name = os.hostname();
        const node_config = config_data.host_customization?.[node_name];
        const merged_config = _.merge(shared_config, node_config || {});

        Object.keys(merged_config).forEach(function(key) {
            config[key] = merged_config[key];
        });
        console.warn(`nsfs: config_dir_path=${config.NSFS_NC_CONF_DIR}`);
        console.warn(`nsfs: config.json= ${util.inspect(config_data)}`);
        console.warn(`nsfs: merged config.json= ${util.inspect(merged_config)}`);
        validate_nc_master_keys_config(config);
        config.event_emitter.emit('config_updated');
    } catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND' && err.code !== 'ENOENT') throw err;
        console.warn('config.load_nsfs_nc_config could not find config.json... skipping');
    }
    _set_nc_config_to_env();
}
/**
 * reload_nsfs_nc_config reloads on non containerized env the config.json file every 10 seconfs
 */
function reload_nsfs_nc_config() {
    if (process.env.CONTAINER_PLATFORM) return;
    try {
        const config_path = path.join(config.NSFS_NC_CONF_DIR, 'config.json');
        fs.watchFile(config_path, {
            interval: config.NC_RELOAD_CONFIG_INTERVAL
        }, () => {
            delete require.cache[config_path];
            try {
                load_nsfs_nc_config();
            } catch (err) {
                // we cannot rethrow, next watch event will try to load again
            }
        }).unref();
    } catch (e) {
        if (e.code === 'ENOENT') {
            console.warn('config.load_nsfs_nc_config could not find config.json... skipping');
            return;
        }
        console.warn('config.load_nsfs_nc_config failed to set config.json to config.js ', e);
        throw e;
    }
}


/**
 * _validate_executable validates executable file exist and executables
 */
/* eslint-disable no-bitwise */
function _validate_executable(file_name) {
    let stat;
    try {
        stat = fs.statSync(file_name);
    } catch (e) {
        throw new Error(`Invalid master keys config, executable file was not found ${file_name}`, { cause: e });
    }
    if (!(stat.mode & fs.constants.S_IXUSR)) {
        throw new Error(`Invalid master keys config, executable file can not be executed ${file_name}`);
    }
}

module.exports.load_nsfs_nc_config = load_nsfs_nc_config;
module.exports.reload_nsfs_nc_config = reload_nsfs_nc_config;

load_nsfs_nc_config();
reload_nsfs_nc_config();
load_config_local();
load_config_env_overrides();
