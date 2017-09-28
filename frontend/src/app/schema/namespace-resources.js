export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'mode',
            'service',
            'target'
        ],
        properties: {
            name: {
                type: 'string'
            },
            mode: {
                type: 'string',
                enum: [
                    'OPTIMAL'
                ]
            },
            service: {
                type: 'string',
                enum: [
                    'AWS',
                    'AZURE',
                    'S3_COMPATIBLE'
                ]
            },
            target: {
                type: 'string'
            },
            undeletable: {
                type: 'string',
                enum: [
                    'IN_USE'
                ]
            }
        }
    }
};
