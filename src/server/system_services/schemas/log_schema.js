/* Copyright (C) 2016 NooBaa */
'use strict';

// This Schema is not a DB schema - it is used only for verifying bucket logging entries!
/* Example for bucket logging entry:
{ 
     noobaa_bucket_logging: 'true', 
     op: 'GET', 
     bucket_owner: 'account1', 
     source_bucket: 'bucket3', 
     object_key: '/bucket3/?encoding-type=url&max-keys=1000&prefix=&delimiter=%2F', 
     log_bucket: 'logs1', 
     log_prefix: 'bucket3._logs/', 
     remote_ip: '::ffff:127.0.0.1', 
     request_uri: '/bucket3/?encoding-type=url&max-keys=1000&prefix=&delimiter=%2F', 
     http_status: 102, 
     request_id: 'lxirvmtw-dnck9b-uz7' 
} */

module.exports = {
    $id: 'log_schema',
    type: 'object',
    required: ['op', 'bucket_owner', 'source_bucket', 'object_key', 'log_bucket',
        'log_prefix', 'remote_ip', 'http_status', 'request_id'
    ],
    properties: {
        op: { type: 'string' },
        bucket_owner: { type: 'string' },
        source_bucket: { type: 'string' },
        object_key: { type: 'string' },
        log_bucket: { type: 'string' },
        log_prefix: { type: 'string' },
        remote_ip: { type: 'string' },
        request_uri: { type: 'string' },
        http_status: { type: 'integer' },
        request_id: { type: 'string' },
    },
};
