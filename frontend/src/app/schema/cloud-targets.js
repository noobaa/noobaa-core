export default {
    type: 'object',
    properties: {
        connection: {
            type: 'string'
        },
        list: {
            type: 'array',
            items: {
                type: 'object',
                required : [
                    'name'
                ],
                properties: {
                    name: {
                        type: 'string'
                    },
                    usedBy: {
                        type: 'object',
                        required :[
                            'kind',
                            'name'
                        ],
                        properties: {
                            kind: {
                                type: 'string',
                                enum: [
                                    'CLOUD_RESOURCE',
                                    'NAMESPACE_RESOURCE'
                                ]
                            },
                            name: {
                                type: 'string'
                            }
                        }
                    }
                }
            }
        },
        fetching: {
            type: 'boolean'
        },
        error: {
            type: 'boolean'
        }
    }
};
