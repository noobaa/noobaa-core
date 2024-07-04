/* Copyright (C) 2016 NooBaa */
'use strict';

const nsfs_node_config_schema = {
    $id: 'nsfs_node_config_schema',
    type: 'object',
    properties: {
        ENDPOINT_FORKS: {
            type: 'number',
            doc: 'number of concurrent endpoint forks allowed, suggested values are 2-64, service restart required'
        },
        ENDPOINT_PORT: {
            type: 'number',
            doc: 'http port number designated for s3 incoming requests, service restart required'
        },
        ENDPOINT_SSL_PORT: {
            type: 'number',
            doc: 'https port number designated for s3 incoming requests, service restart required'
        },
        ENDPOINT_SSL_STS_PORT: {
            type: 'number',
            doc: 'https port number designated for sts incoming requests, service restart required'
        },
        EP_METRICS_SERVER_PORT: {
            type: 'number',
            doc: 'http port number designated for metrics incoming requests, service restart required'
        },
        ALLOW_HTTP: {
            type: 'boolean',
            doc: 'indicate whether s3 http requests are allowed, service restart required'
        },
        NSFS_CALCULATE_MD5: {
            type: 'boolean',
            doc: 'indicate whether MD5 will be calculated, hot reload'
        },
        NOOBAA_LOG_LEVEL: {
            type: 'string',
            enum: ['warn', 'default', 'nsfs', 'all', 'off'],
            doc: 'logging verbosity level for the NooBaa system, service restart required'
        },
        NOOBAA_DEBUG_LEVEL: {
            type: 'string',
            enum: ['warn', 'default', 'nsfs', 'all', 'off'],
            doc: 'logging verbosity level for the NooBaa debug logs, service restart required'
        },
        UV_THREADPOOL_SIZE: {
            type: 'number',
            doc: 'number of UV_THREADPOOL, suggested values are 4-1024, service restart required'
        },
        GPFS_DL_PATH: {
            type: 'string',
            doc: 'indicates the location of the gpfs library file, service restart required, usually should be set to /usr/lib64/libgpfs.so'
        },
        GPFS_DOWN_DELAY: {
            type: 'number',
            doc: 'delay (ms) of GPFS syscalls when daemon is down, to hold client replies during failover, service restart required'
        },
        NSFS_NC_STORAGE_BACKEND: {
            $ref: 'common_api#/definitions/fs_backend',
            doc: 'indicates the global storage backend type, service restart required'
        },
        NSFS_NC_CONFIG_DIR_BACKEND: {
            $ref: 'common_api#/definitions/fs_backend',
            doc: 'indicates the backend type of the config directory, service restart required'
        },
        NSFS_BUF_POOL_MEM_LIMIT: {
            type: 'number',
            doc: 'number of nsfs buffer pool memory limit, suggested values 1-4GB, service restart required'
        },
        NSFS_BUF_SIZE: {
            type: 'number',
            doc: 'number of nsfs buffer size, service restart required'
        },
        NSFS_OPEN_READ_MODE: {
            type: 'string',
            doc: `describes the mode of open for read, use 'rd' for direct-io reads, hot reload`
        },
        NSFS_CHECK_BUCKET_BOUNDARIES: {
            type: 'boolean',
            doc: `indicate whether bucket boundaries should be checked, hot reload`
        },
        NSFS_TRIGGER_FSYNC: {
            type: 'boolean',
            doc: 'indicate whether fsync should be triggered, changing value to false is unsafe for production envs, hot reload'
        },
        S3_SERVER_IP_WHITELIST: {
            type: 'array',
            items: {
                type: 'string'
            },
            doc: 'Whitelist of server IPs for S3 access, Allow access to all the IPs if list is empty.'
        },
        NSFS_DIR_CACHE_MAX_DIR_SIZE: {
            type: 'number',
            doc: 'maximum directory size of the dir cache, suggested values 256MB, service restart required'
        },
        NSFS_DIR_CACHE_MAX_TOTAL_SIZE: {
            type: 'number',
            doc: 'maximum size of the dir cache, suggested values 768MB, service restart required'
        },
        ENABLE_DEV_RANDOM_SEED: {
            type: 'boolean',
            doc: 'This flag will enable the random seeding for the application'
        },
        NC_MASTER_KEYS_STORE_TYPE: {
            enum: ['file', 'executable'],
            type: 'string',
            doc: 'This flag will set the master keys store type'
        },
        NC_MASTER_KEYS_FILE_LOCATION: {
            type: 'string',
            doc: 'This flag will set the master keys file location'
        },
        NC_MASTER_KEYS_GET_EXECUTABLE: {
            type: 'string',
            doc: 'This flag will set the location of the executable script for reading the master keys file used by NooBa.'
        },
        NC_MASTER_KEYS_PUT_EXECUTABLE: {
            type: 'string',
            doc: 'This flag will set the location of the executable script for updating the master keys file used by NooBa.'
        },
        VIRTUAL_HOSTS: {
            type: 'string',
            doc: 'This flag will set the virtual hosts, service restart required, Set the virtual hosts as string of domains sepreated by spaces.'
        },
        NC_DISABLE_SCHEMA_CHECK: {
            type: 'boolean',
            doc: 'indicate whether account/bucket/config.json schema will be validated.'
        },
        NC_DISABLE_ACCESS_CHECK: {
            type: 'boolean',
            doc: 'indicate whether read/write access will be validated on bucket/account creation/update.'
        },
        ENDPOINT_PROCESS_TITLE: {
            type: 'string',
            doc: 'This flag will set noobaa process title for letting GPFS to identify the noobaa endpoint processes.'
        },
        LOG_TO_SYSLOG_ENABLED: {
            type: 'boolean',
            doc: 'This flag will enable syslog logging for the application.'
        },
        LOG_TO_STDERR_ENABLED: {
            type: 'boolean',
            doc: 'This flag will decide whether need to push logs to the console or not.'
        },
    }
};

module.exports = {
    $id: 'nsfs_config_schema',
    type: 'object',
    doc: 'nsfs configuration shared across all hosts and host_customization nsfs configuration',
    properties: {
        ...nsfs_node_config_schema.properties,
        host_customization: {
            type: 'object',
            additionalProperties: nsfs_node_config_schema,
            doc: 'nsfs configuration per host'
        }
    }
};
