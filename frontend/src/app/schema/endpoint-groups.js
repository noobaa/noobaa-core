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
            isRemote: {
                type: 'boolean'
            },
            region: {
                type: 'string'
            },
            endpointCount: {
                type: 'integer'
            },
            endpointRange: {
                type: 'object',
                required: [
                    'min',
                    'max'
                ],
                properties: {
                    min: {
                        type: 'integer',
                        minimum: 1
                    },
                    max: {
                        type: 'integer',
                        minimum: 1
                    }
                }
            },
            cpuCount: {
                type: 'integer'
            },
            cpuUsage: {
                type: 'number'
            },
            memoryUsage: {
                type: 'number'
            },
            lastUpdate: {
                type: 'integer'
            }
        }
    }
};
