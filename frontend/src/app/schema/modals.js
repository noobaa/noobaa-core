export default {
    type: 'array',
    items: {
        type: 'object',
        required: [
            'backdropClose',
            'closeButton',
            'component',
            'severity',
            'size',
            'title'
        ],
        properties: {
            backdropClose: {
                type: 'boolean'
            },
            closeButton: {
                type: 'string',
                enum: [
                    'hidden',
                    'visible',
                    'disabled'
                ]
            },
            component: {
                type: 'object',
                required: [
                    'name',
                    'params'
                ],
                properties: {
                    name: {
                        type: 'string'
                    },
                    params: {
                        type: 'object',
                        additionalProperties: true
                    }
                }
            },
            severity: {
                type: 'string',
                enum: [
                    'info',
                    'success',
                    'warning',
                    'error',
                    ''
                ]
            },
            size: {
                type: 'string',
                enum: [
                    'xsmall',
                    'small',
                    'medium',
                    'large',
                    'xlarge',
                    'auto-height'
                ]
            },
            title: {
                type: 'string'
            }
        }
    }
};
