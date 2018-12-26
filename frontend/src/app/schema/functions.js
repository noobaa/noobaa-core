/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'version',
            'description',
            'handler',
            'runtime',
            'timeout',
            'memorySize',
            'codeSize',
            'lastModified',
            'executor'
        ],
        properties: {
            name: {
                type: 'string'
            },
            version: {
                type: 'string'
            },
            handler: {
                type: 'string'
            },
            description: {
                type: 'string'
            },
            runtime: {
                type: 'string'
            },
            timeout: {
                type: 'integer'
            },
            memorySize: {
                type: 'integer'
            },
            codeSize: {
                $ref: '#/def/common/size'
            },
            lastModified: {
                type: 'integer'
            },
            executor: {
                type: 'string'
            }
        }
    }
};
