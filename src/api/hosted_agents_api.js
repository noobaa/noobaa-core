/* Copyright (C) 2016 NooBaa */
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
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    demo: {
                        type: 'boolean'
                    },
                    access_keys: {
                        type: 'object',
                        required: ['access_key', 'secret_key'],
                        properties: {
                            access_key: {
                                type: 'string'
                            },
                            secret_key: {
                                type: 'string'
                            }
                        }
                    },
                    scale: {
                        type: 'integer'
                    },
                    storage_limit: {
                        type: 'integer',
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
                                type: 'object',
                                required: ['access_key', 'secret_key', 'account_id'],
                                properties: {
                                    access_key: {
                                        type: 'string'
                                    },
                                    secret_key: {
                                        type: 'string'
                                    },
                                    account_id: {
                                        type: 'string'
                                    }
                                }
                            },
                            endpoint_type: {
                                $ref: 'common_api#/definitions/endpoint_type'
                            }
                        },
                    },

                    mongo_info: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    }
                }
            },
            auth: {
                system: false
            }

        },

        create_pool_agent: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['pool_name'],
                properties: {
                    pool_name: {
                        type: 'string',
                    }
                }
            },
            auth: {
                system: 'admin'
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
                system: false
            }
        },


        remove_pool_agent: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    node_name: {
                        type: 'string',
                    },
                    pool_name: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: false
            }
        },

        start: {
            method: 'POST',
            auth: {
                system: false
            }
        },

        stop: {
            method: 'POST',
            auth: {
                system: false
            }
        },
    },

};
