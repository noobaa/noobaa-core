/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'lastUpdate',
            'endpointCount',
            'cpuCount',
            'cpuUsage',
            'memoryUsage'
        ],
        properties: {
            name: {
                type: 'string'
            },
            lastUpdate: {
                type: 'integer'
            },
            endpointCount: {
                type: 'integer'
            },
            cpuCount: {
                type: 'integer'
            },
            cpuUsage: {
                type: 'number'
            },
            memoryUsage: {
                type: 'number'
            }
        }
    }
};
