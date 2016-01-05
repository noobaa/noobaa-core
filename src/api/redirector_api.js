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
                $ref: '/node_api/definitions/signal_params'
            },
            reply: {
                $ref: '/node_api/definitions/signal_reply'
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

        print_registered_agents: {
            method: 'GET',
            reply: {
                type: 'string',
            },
            auth: {
                system: 'admin'
            }
        }
    },

    definitions: {
        basic_registration_info: {
            type: 'object',
            required: ['agent', 'server', 'port'],
            properties: {
                peer_id: {
                    type: 'string',
                },
            }
        }
    }
};
