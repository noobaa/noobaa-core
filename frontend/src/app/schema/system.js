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
        }
    }
};
