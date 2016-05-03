'use strict';

/**
 *
 * HOSTED_AGENTS API
 *
 *
 */
module.exports = {

    id: 'hosted_agents_api',

    methods: {
        create_agent: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'scale'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    scale: {
                        type: 'integer'
                    },
                    cloud_info: {
                        type: 'object',
                        required: ['endpoint', 'target_bucket', 'access_keys'],
                        properties: {
                            endpoint: {
                                type: 'string',
                            },
                            target_bucket: {
                                type: 'string',
                            },
                            access_keys: {
                                $ref: 'system_api#/definitions/access_keys',
                            }
                        }
                    }
                }
            },
            auth: {
                system: false
            }

        },

        remove_agent: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },
    },

};