/* Copyright (C) 2016 NooBaa */
'use strict';

const nsfs = {
    level: 5,
    core: [
        'core.server.system_services.bucket_server',
        'core.server.system_services.pool_server'
    ],
    endpoint: [
        'core.endpoint.s3',
        'core.util.http_utils',
        'core.util.semaphore',
        'core.util.buffer_utils',
        'core.sdk.object_sdk',
        'core.sdk.namespace_fs',
        'core.sdk.bucketspace_nb'
    ],
};

const all = {
    level: 5,
    core: ['core'],
    endpoint: ['core'],
};

const warn = {
    level: -1,
    core: ['core'],
    endpoint: ['core'],
};

const default_level = {
    level: 0,
    core: ['core'],
    endpoint: ['core'],
};

function get_debug_config(conf) {
    if (conf === 'all') {
        return all;
    } else if (conf === 'nsfs') {
        return nsfs;
    } else if (conf === 'warn') {
        return warn;
    } else {
        return default_level;
    }
}

exports.get_debug_config = get_debug_config;
