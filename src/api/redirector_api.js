'use strict';

/**
 *
 * REDIRECTOR API
 *
 */
module.exports = {

    name: 'redirector_api',

    methods: {
        redirect: {
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
                $ref: '/redirector_api/definitions/basic_registration_info'
            },
            auth: {
                system: 'admin'
            }
        },

        unregister_agent: {
            method: 'POST',
            params: {
                $ref: '/redirector_api/definitions/basic_registration_info'
            },
            auth: {
                system: 'admin'
            }
        },

        resync_agents: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    server: {
                        type: 'string',
                    },
                    timestamp: {
                        type: 'integer',
                        format: 'idate',
                    },
                    agents: {
                        type: 'array',
                        items: {
                            type: 'string'
                        },
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },
    },

    definitions: {
        basic_registration_info: {
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
