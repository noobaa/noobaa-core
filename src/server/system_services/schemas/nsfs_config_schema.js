/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'nsfs_config_schema',
    type: 'object',
    doc: 'nsfs configuration shared across all hosts and host_customization nsfs configuration',
    properties: {
        ENDPOINT_FORKS: {
            type: 'number',
            default: 0,
            doc: 'number of concurrent endpoint forks allowed, suggested values are 2-64, service restart required'
        },
        ENDPOINT_PORT: {
            type: 'number',
            default: 6001,
            doc: 'http port number designated for s3 incoming requests, service restart required'
        },
        ENDPOINT_SSL_PORT: {
            type: 'number',
            default: 6443,
            doc: 'https port number designated for s3 incoming requests, service restart required'
        },
        ENDPOINT_SSL_STS_PORT: {
            type: 'number',
            default: 7443,
            doc: 'https port number designated for sts incoming requests, service restart required'
        },
        EP_METRICS_SERVER_PORT: {
            type: 'number',
            default: 7004,
            doc: 'http port number designated for metrics incoming requests, service restart required'
        },
        ALLOW_HTTP: {
            type: 'boolean',
            default: false,
            doc: 'indicate whether s3 http requests are allowed, service restart required'
        },
        NSFS_CALCULATE_MD5: {
            type: 'boolean',
            default: false,
            doc: 'indicate whether MD5 will be calculated, hot reload'
        },
        NOOBAA_LOG_LEVEL: {
            type: 'string',
            enum: ['warn', 'default', 'nsfs', 'all'],
            default: 'default',
            doc: 'logging verbosity level for the NooBaa system, service restart required'
        },
        UV_THREADPOOL_SIZE: {
            type: 'number',
            default: 4,
            doc: 'number of UV_THREADPOOL, suggested values are 4-1024, service restart required'
        },
        GPFS_DL_PATH: {
            type: 'string',
            default: '',
            doc: 'indicates the location of the gpfs library file, service restart required, usually should be set to /usr/lib64/libgpfs.so'
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
            default: 32 * 1024 * 1024,
            doc: 'number of nsfs buffer pool memory limit, suggested values 1-4GB, service restart required'
        },
        NSFS_BUF_SIZE: {
            type: 'number',
            default: 8 * 1024 * 1024,
            doc: 'number of nsfs buffer size, service restart required'
        },
        NSFS_OPEN_READ_MODE: {
            type: 'string',
            default: 'r',
            doc: `describes the mode of open for read, use 'rd' for direct-io reads, hot reload`
        },
        NSFS_CHECK_BUCKET_BOUNDARIES: {
            type: 'boolean',
            default: true,
            doc: `indicate whether bucket boundaries should be checked, hot reload`
        },
        NSFS_TRIGGER_FSYNC: {
            type: 'boolean',
            default: true,
            doc: 'indicate whether fsync should be triggered, changing value to false is unsafe for production envs, hot reload'
        },
        NSFS_WHITELIST: {
            type: 'array',
            items: {
                type: 'string'
            },
            default: [],
            doc: 'List of whitelisted IPs for S3 access, Allow access from all the IPs if list is empty.'
        },
        NSFS_DIR_CACHE_MAX_DIR_SIZE: {
            type: 'number',
            default: 64 * 1024 * 1024,
            doc: 'maximum directory size of the dir cache, suggested values 256MB, service restart required'
        },
        NSFS_DIR_CACHE_MAX_TOTAL_SIZE: {
            type: 'number',
            default: 4 * 64 * 1024 * 1024,
            doc: 'maximum size of the dir cache, suggested values 768MB, service restart required'
        },
        ENABLE_DEV_RANDOM_SEED: {
            type: 'boolean',
            default: false,
            doc: 'This flag will enable the random seeding for the application'
        },
        host_customization: {
            type: "array",
            default: [],
            doc: 'nsfs configuration per host',
            items: {
                type: "object",
                properties: {
                    node_name: {
                        type: 'string',
                        doc: 'The name of the node'
                    },
                    ENDPOINT_FORKS: {
                        $ref: "#/properties/ENDPOINT_FORKS"
                    },
                    ENDPOINT_PORT: {
                        $ref: "#/properties/ENDPOINT_PORT"
                    },
                    ENDPOINT_SSL_PORT: {
                        $ref: "#/properties/ENDPOINT_SSL_PORT"
                    },
                    ENDPOINT_SSL_STS_PORT: {
                        $ref: "#/properties/ENDPOINT_SSL_STS_PORT"
                    },
                    EP_METRICS_SERVER_PORT: {
                        $ref: "#/properties/EP_METRICS_SERVER_PORT"
                    },
                    ALLOW_HTTP: {
                        $ref: "#/properties/ALLOW_HTTP"
                    },
                    NSFS_CALCULATE_MD5: {
                        $ref: "#/properties/NSFS_CALCULATE_MD5"
                    },
                    NOOBAA_LOG_LEVEL: {
                        $ref: "#/properties/NOOBAA_LOG_LEVEL"
                    },
                    UV_THREADPOOL_SIZE: {
                        $ref: "#/properties/UV_THREADPOOL_SIZE"
                    },
                    GPFS_DL_PATH: {
                        $ref: "#/properties/GPFS_DL_PATH"
                    },
                    NSFS_NC_STORAGE_BACKEND: {
                        $ref: "#/properties/NSFS_NC_STORAGE_BACKEND"
                    },
                    NSFS_NC_CONFIG_DIR_BACKEND: {
                        $ref: "#/properties/NSFS_NC_CONFIG_DIR_BACKEND"
                    },
                    NSFS_BUF_POOL_MEM_LIMIT: {
                        $ref: "#/properties/NSFS_BUF_POOL_MEM_LIMIT"
                    },
                    NSFS_BUF_SIZE: {
                        $ref: "#/properties/NSFS_BUF_SIZE"
                    },
                    NSFS_OPEN_READ_MODE: {
                        $ref: "#/properties/NSFS_OPEN_READ_MODE"
                    },
                    NSFS_CHECK_BUCKET_BOUNDARIES: {
                        $ref: "#/properties/NSFS_CHECK_BUCKET_BOUNDARIES"
                    },
                    NSFS_TRIGGER_FSYNC: {
                        $ref: "#/properties/NSFS_TRIGGER_FSYNC"
                    },
                    NSFS_WHITELIST: {
                        $ref: "#/properties/NSFS_WHITELIST"
                    },
                    NSFS_DIR_CACHE_MAX_DIR_SIZE: {
                        $ref: "#/properties/NSFS_DIR_CACHE_MAX_DIR_SIZE"
                    },
                    NSFS_DIR_CACHE_MAX_TOTAL_SIZE: {
                        $ref: "#/properties/NSFS_DIR_CACHE_MAX_TOTAL_SIZE"
                    },
                    ENABLE_DEV_RANDOM_SEED: {
                        $ref: "#/properties/ENABLE_DEV_RANDOM_SEED"
                    }
                }
            }
        }
    },
};
