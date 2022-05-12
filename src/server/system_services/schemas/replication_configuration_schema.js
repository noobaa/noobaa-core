/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'replication_configuration_schema',
    type: 'object',
    required: [
        '_id',
        'rules',
    ],
    properties: {

        _id: { objectid: true },
        rules: {
            type: 'array',
            items: {
                type: 'object',
                required: ['destination_bucket', 'rule_id'],
                properties: {
                    rule_id: { type: 'string' },
                    destination_bucket: {
                        objectid: true // bucket id
                    },
                    filter: {
                        type: 'object',
                        properties: {
                            prefix: { type: 'string' },
                            // s3 support also tag or and operator of 2 tags/ tag and prefix 
                        }
                    },
                    rule_status: {
                        type: 'object',
                        required: ['src_cont_token', 'dst_cont_token', 'last_cycle_start', 'last_cycle_end'],
                        properties: {
                            src_cont_token: { type: 'string' },
                            dst_cont_token: { type: 'string' },
                            last_cycle_start: { idate: true },
                            last_cycle_end: { idate: true }
                        }
                    }
                }
            },
        },
        aws_log_replication_info: {
            type: 'object',
            required: ['logs_location'],
            properties: {
                logs_location: {
                    type: 'object',
                    required: ['logs_bucket'],
                    properties: {
                        logs_bucket: { type: 'string' },
                        prefix: { type: 'string' }
                    }
                },
                log_marker: {
                    type: 'object',
                    required: ['continuation_token'],
                    properties: {
                        continuation_token: { type: 'string' }
                    }
                }
            }
        },
    }
};
