'use strict';

/**
 *
 * SIGNALLER API
 *
 */
module.exports = {

    name: 'signaller_api',

    methods: {
        signal: {
            method: 'POST',
            params: {
                $ref: '/node_api/definitions/signal_request'
            },
            reply: {
                $ref: '/node_api/definitions/signal_response'
            },
            auth: {
                system: false
            }
        },

        register_agent: {
            method: 'POST',
            params: {
                $ref: '/signaller_api/definitions/basic_signal_info'
            },
            auth: {
                system: 'admin'
            }
        },

        subscribe: {
            method: 'POST',
            params: {
                $ref: '/signaller_api/definitions/basic_signal_info'
            },
            auth: {
                system: 'admin'
            }
        },

        unsubscribe: {
            method: 'POST',
            params: {
                $ref: '/signaller_api/definitions/basic_signal_info'
            },
            auth: {
                system: 'admin'
            }
        },

        unsubscribe_all: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['server', 'port'],
                properties: {
                    server: {
                        type: 'string',
                    },
                    port: {
                        type: 'integer',
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },
    },

    definitions: {
        basic_signal_info: {
            type: 'object',
            required: ['agent', 'server', 'port'],
            properties: {
                agent: {
                    type: 'string',
                },
                server: {
                    type: 'string',
                },
                port: {
                    type: 'integer',
                }
            }
        }
    }
};
