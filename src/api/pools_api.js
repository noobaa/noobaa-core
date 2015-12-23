'use strict';

/**
 *
 * POOLS API
 *
 *
 */
module.exports = {
    name: 'pools_api',

    methods: {
        create_pool: {
            doc: 'Create Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['pool'],
                properties: {
                    pool: {
                        $ref: '/pools_api/definitions/pool_definition'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_pool: {
            doc: 'Update Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['pool'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    new_name: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_pool: {
            doc: 'Get Pool',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            reply: {
                $ref: '/pools_api/definitions/pool_definition'
            },
            auth: {
                system: 'admin'
            }
        },

        delete_pool: {
            doc: 'Delete Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        add_nodes_to_pool: {
            doc: 'Add nodes to Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'string',
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        remove_nodes_from_pool: {
            doc: 'Remove nodes to Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'string',
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        }
    },

    definitions: {
        pool_definition: {
            type: 'object',
            required: ['name', 'nodes'],
            properties: {
                name: {
                    type: 'string',
                },
                nodes: {
                    type: 'array',
                    properties: [{
                        node: {
                            type: 'string',
                            required: true,
                        },
                    }]
                }
            }
        },

        pools_info: {
            type: 'object',
            required: ['pools'],
            properties: {
                pools: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                required: true,
                            },
                            nodes_count: {
                                type: 'integer',
                                required: true,
                            },
                        }
                    }
                }
            }
        },
    }
};
