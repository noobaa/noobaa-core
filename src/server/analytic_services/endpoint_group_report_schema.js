/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'endpoint_group_report_schema',
    type: 'object',
    properties: {
        _id: { objectid: true },
        start_time: { idate: true },
        end_time: { idate: true },
        system: { objectid: true },
        group_name: { type: 'string' },
        endpoints: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    hostname: { type: 'string' },
                    cpu: {
                        type: 'object',
                        properties: {
                            count: { type: 'integer' },
                            usage: { type: 'number' }
                        }
                    },
                    memory: {
                        type: 'object',
                        properties: {
                            total: { type: 'integer' },
                            used: { type: 'integer' }
                        }
                    }
                }
            }
        }
    }
};
