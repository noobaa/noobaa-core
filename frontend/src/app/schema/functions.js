/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    additionalProperties: {
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
            },
            description: {
                type: 'string'
            },
            size: {
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
