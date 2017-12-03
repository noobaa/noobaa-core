export default {
    type: 'object',
    required: [
        'version'
    ],
    properties: {
        version: {
            type: 'string'
        },
        sslCert: {
            type: 'object'
        },
        lastUpgrade: {
            type: 'integer'
        },
        releaseNotes: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                required: [
                    'fetching'
                ],
                properties: {
                    fetching: {
                        type: 'boolean'
                    },
                    error: {
                        type: 'boolean'
                    },
                    text: {
                        type: 'string'
                    }
                }
            }
        }
    }
};
