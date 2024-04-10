/* Copyright (C) 2016 NooBaa */
'use strict';

const nsfs_node_config_schema = {
    $id: 'nsfs_node_config_schema',
    type: 'object',
    properties: {
        ENDPOINT_FORKS: {
            type: 'number',
            default: 0,
            description: 'number of concurrent endpoint forks allowed, suggested values are 2-64, service restart required'
        },
        ENDPOINT_PORT: {
            type: 'number',
            default: 6001,
            description: 'http port number designated for s3 incoming requests, service restart required'
        },
        ENDPOINT_SSL_PORT: {
            type: 'number',
            default: 6443,
            description: 'https port number designated for s3 incoming requests, service restart required'
        },
        ENDPOINT_SSL_STS_PORT: {
            type: 'number',
            default: 7443,
            description: 'https port number designated for sts incoming requests, service restart required'
        },
        EP_METRICS_SERVER_PORT: {
            type: 'number',
            default: 7004,
            description: 'http port number designated for metrics incoming requests, service restart required'
        },
        ALLOW_HTTP: {
            type: 'boolean',
            default: false,
            description: 'indicate whether s3 http requests are allowed, service restart required'
        },
        NSFS_CALCULATE_MD5: {
            type: 'boolean',
            default: false,
            description: 'indicate whether MD5 will be calculated, hot reload'
        },
        NOOBAA_LOG_LEVEL: {
            type: 'string',
            enum: ['warn', 'default', 'nsfs', 'all'],
            default: 'default',
            description: 'logging verbosity level for the NooBaa system, service restart required'
        },
        UV_THREADPOOL_SIZE: {
            type: 'number',
            default: 4,
            description: 'number of UV_THREADPOOL, suggested values are 4-1024, service restart required'
        },
        GPFS_DL_PATH: {
            type: 'string',
            default: '',
            description: 'indicates the location of the gpfs library file, service restart required, usually should be set to /usr/lib64/libgpfs.so'
        },
        NSFS_NC_STORAGE_BACKEND: {
            $ref: 'common_api#/definitions/fs_backend',
            default: undefined,
            description: 'indicates the global storage backend type, service restart required'
        },
        NSFS_NC_CONFIG_DIR_BACKEND: {
            $ref: 'common_api#/definitions/fs_backend',
            default: undefined,
            description: 'indicates the backend type of the config directory, service restart required'
        },
        NSFS_BUF_POOL_MEM_LIMIT: {
            type: 'number',
            default: 32 * 1024 * 1024,
            description: 'number of nsfs buffer pool memory limit, suggested values 1-4GB, service restart required'
        },
        NSFS_BUF_SIZE: {
            type: 'number',
            default: 8 * 1024 * 1024,
            description: 'number of nsfs buffer size, service restart required'
        },
        NSFS_OPEN_READ_MODE: {
            type: 'string',
            default: 'r',
            description: `describes the mode of open for read, use 'rd' for direct-io reads, hot reload`
        },
        NSFS_CHECK_BUCKET_BOUNDARIES: {
            type: 'boolean',
            default: true,
            description: `indicate whether bucket boundaries should be checked, hot reload`
        },
        NSFS_TRIGGER_FSYNC: {
            type: 'boolean',
            default: true,
            description: 'indicate whether fsync should be triggered, changing value to false is unsafe for production envs, hot reload'
        },
        NSFS_WHITELIST: {
            type: 'array',
            default: [],
            description: 'List of whitelisted IPs for S3 access, Allow access from all the IPs if list is empty.'
        },
        NSFS_DIR_CACHE_MAX_DIR_SIZE: {
            type: 'number',
            default: 64 * 1024 * 1024,
            description: 'maximum directory size of the dir cache, suggested values 256MB, service restart required'
        },
        NSFS_DIR_CACHE_MAX_TOTAL_SIZE: {
            type: 'number',
            default: 4 * 64 * 1024 * 1024,
            description: 'maximum size of the dir cache, suggested values 768MB, service restart required'
        },
        ENABLE_DEV_RANDOM_SEED: {
            type: 'boolean',
            default: false,
            description: 'This flag will enable the random seeding for the application'
        },
        NC_MASTER_KEYS_STORE_TYPE: {
            enum: ['file', 'executable'],
            description: 'This flag will set the master keys store type'
        },
        NC_MASTER_KEYS_FILE_LOCATION: {
            type: 'string',
            description: 'This flag will set the master keys file location'
        },
        NC_MASTER_KEYS_GET_EXECUTABLE: {
            type: 'string',
            description: 'This flag will set the location of the executable script for reading the master keys file used by NooBa.'
        },
        NC_MASTER_KEYS_PUT_EXECUTABLE: {
            type: 'string',
            description: 'This flag will set the location of the executable script for updating the master keys file used by NooBa.'
        }
    }
};

module.exports = {
    $id: 'nsfs_config_schema',
    type: 'object',
    description: 'nsfs configuration shared across all hosts and host_customization nsfs configuration',
    properties: {
        ...nsfs_node_config_schema.properties,
        host_customization: {
            type: 'object',
            patternProperties: {
                '^[a-zA-Z0-9]$': { $ref: '#/definitions/nsfs_node_config_schema' }
            },
            description: 'nsfs configuration per host'
        }
    },
    definitions: {
        nsfs_node_config_schema: nsfs_node_config_schema
    }
};
