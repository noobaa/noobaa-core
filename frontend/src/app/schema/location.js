export default {
    type: 'object',
    required: [
        'pathname',
        'protocol',
        'query',
        'hostname',
        'refreshCount'
    ],
    properties: {
        pathname: {
            type: 'string'

        },
        protocol: {
            type: 'string'
        },
        hostname: {
            type: 'string'

        },
        route: {
            type: 'string'
        },
        params: {
            type: 'object',
            additionalProperties: {
                type: 'string'
            }
        },
        query: {
            type: 'object',
            additionalProperties: {
                oneOf: [
                    {
                        type: 'string'
                    },
                    {
                        type: 'boolean'
                    }
                ]
            }
        },
        refreshCount: {
            type: 'number'
        }
    }
};
