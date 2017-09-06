export default {
    type: 'object',
    required: [
        'token',
        'user',
        'system',
        'persistent',
        'passwordExpired'
    ],
    properties: {
        token: {
            type: 'string'
        },
        user: {
            type: 'string'
        },
        system: {
            type: 'string'
        },
        persistent: {
            type: 'boolean'
        },
        passwordExpired: {
            type: 'boolean'
        }
    }
};
