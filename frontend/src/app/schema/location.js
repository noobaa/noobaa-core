export default {
    type: 'object',
    required: [
        'pathname',
        'protocol',
        'query',
    ],
    properties: {
        pathname: {
            type: 'string',

        },
        protocol: {
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
                type: 'string'
            }
        }
    }
};
