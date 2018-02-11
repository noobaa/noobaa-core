export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'mode',
            'storage'
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
                    'LOW_CAPACITY',
                    'NO_CAPACITY'
                ]
            },
            storage: {
                $ref: '#/def/common/storage'
            }
        }
    }
};
