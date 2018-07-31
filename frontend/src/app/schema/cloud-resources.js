export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'mode',
            'storage',
            'target',
            'type',
            'usedBy'
        ],
        properties: {
            name: {
                type: 'string'
            },
            mode: {
                type: 'string',
                enum: [
                    'OPTIMAL',
                    'INITIALIZING',
                    'IO_ERRORS',
                    'ALL_NODES_OFFLINE',
                    'STORAGE_NOT_EXIST',
                    'AUTH_FAILED'
                ]
            },
            storage: {
                $ref: '#/def/common/storage'
            },
            target: {
                type: 'string'
            },
            type: {
                type: 'string',
                enum: [
                    'AWS',
                    'AZURE',
                    'S3_COMPATIBLE',
                    'GOOGLE',
                    'FLASHBLADE'
                ]
            },
            undeletable: {
                type: 'string',
                enum: [
                    'NOT_EMPTY',
                    'IN_USE'
                ]
            },
            usedBy: {
                type: 'array',
                items: {
                    type: 'string'
                }
            }
        }
    }
};
