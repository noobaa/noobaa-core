export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'id',
            'mode',
            'event',
            'bucket',
            'func',
            'prefix',
            'suffix'
        ],
        properties: {
            id: {
                type: 'string'
            },
            mode: {
                type: 'string',
                enum: [
                    'OPTIMAL',
                    'MISSING_PERMISSIONS',
                    'DISABLED'
                ]
            },
            event: {
                type:' string',
                enum: [
                    'ObjectCreated',
                    'ObjectRemoved',
                    'ObjectRead'
                ]
            },
            bucket: {
                type: 'object',
                requried: [
                    'kind',
                    'name'
                ],
                properties: {
                    kind: {
                        type: 'string',
                        enum: [
                            'DATA_BUCKET',
                            'NAMESPACE_BUCKET'
                        ]
                    },
                    name: {
                        type: 'string'
                    }
                }
            },
            func: {
                type: 'object',
                required: [
                    'name',
                    'version'
                ],
                properties: {
                    name: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    }
                }
            },
            prefix: {
                type: 'string'
            },
            suffix: {
                type: 'string'
            },
            lastRun: {
                type:' integer'
            }
        }
    }
};
