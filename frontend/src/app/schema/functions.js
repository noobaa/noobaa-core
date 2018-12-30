/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'version',
            'description',
            'execFile',
            'execFunc',
            'runtime',
            'timeout',
            'memorySize',
            'lastModified',
            'lastModifier',
            'executor',
            'codeSize',
            'codeHash',
            'codeBuffer'
        ],
        properties: {
            name: {
                type: 'string'
            },
            version: {
                type: 'string'
            },
            execFile: {
                type: 'string'
            },
            execFunc: {
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
            lastModified: {
                type: 'integer'
            },
            lastModifier: {
                type: 'string'
            },
            executor: {
                type: 'string'
            },
            codeHash: {
                type: 'string'
            },
            codeSize: {
                $ref: '#/def/common/size'
            },
            codeBuffer: {
                type: 'object',
                required: [
                    'loading',
                    'error',
                    'handle'
                ],
                properties: {
                    loading: {
                        type: 'boolean'
                    },
                    error : {
                        type: 'boolean'
                    },
                    handle: {
                        $ref: '#/def/common/bufferKey'
                    }
                }
            }
        }
    }
};
