'use strict';

/**
 *
 * REDIRECTOR API
 *
 */
module.exports = {

    id: 'redirector_api',

    methods: {

        register_to_cluster: {
            method: 'POST',
            auth: {
                system: false
            }
        },

        publish_to_cluster: {
            method: 'POST',
            params: {
                $ref: '#/definitions/redirect_params'
            },
            reply: {
                $ref: '#/definitions/redirect_reply'
            },
            auth: {
                system: false
            }
        },

        register_for_system_events: {
            method: 'POST',
            auth: {
                system: 'admin'
            }
        },

        unregister_from_system_events: {
            method: 'POST',
            auth: {
                system: 'admin'
            }
        },

        publish_current_state: {
            method: 'POST',
            auth: {
                system: 'admin'
            }
        },

        publish_alerts: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    request_params: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    },
                }
            },
            auth: {
                system: false
            }
        },



        publish_system_store_change: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    event: {
                        type: 'string'
                    },
                }
            },
            auth: {
                system: false
            }
        }

    },

    definitions: {

        redirect_params: {
            type: 'object',
            required: ['target', 'method_api', 'method_name'],
            properties: {
                target: {
                    type: 'string'
                },
                method_api: {
                    type: 'string'
                },
                method_name: {
                    type: 'string'
                },
                stop_redirect: {
                    type: 'boolean',
                },
                request_params: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                },
                redirect_buffer: {
                    buffer: true
                },
            },
        },

        redirect_reply: {
            type: 'object',
            properties: {
                redirect_reply: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                },
                redirect_buffer: {
                    buffer: true
                },
            }
        },
    }
};
