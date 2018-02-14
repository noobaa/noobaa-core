export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'fields',
            'warnings',
            'syncErrors',
            'asyncErrors',
            'submitErrors',
            'validatingAsync',
            'validated',
            'submitting',
            'submitted'
        ],
        properties: {
            fields: {
                type: 'object',
                additionalProperties: {
                    type: 'object',
                    required: [
                        'touched',
                        'validity'
                    ],
                    properties: {
                        initial: {},
                        touched: {
                            type: 'boolean'
                        },
                        validity: {
                            type: 'string',
                            enum: [
                                'INVALID',
                                'UNKNOWN',
                                'VALID'
                            ]
                        },
                        value: {}
                    }
                }
            },
            warnings: {
                type: 'object',
                additionalProperties: {
                    type: 'string'
                }
            },
            syncErrors: {
                type: 'object',
                additionalProperties: {
                    type: 'string'
                }
            },
            asyncErrors: {
                type: 'object',
                additionalProperties: {
                    type: 'string'
                }
            },
            submitErrors: {
                type: 'object',
                additionalProperties: {
                    type: 'string'
                }
            },
            validatingAsync: {
                oneOf: [
                    {
                        type: 'null'
                    },
                    {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }
                ]
            },
            validated: {
                type: 'boolean'
            },
            submitting: {
                type: 'boolean'
            },
            submitted: {
                type: 'boolean'
            }
        }
    }
};
