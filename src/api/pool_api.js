'use strict';

/**
 *
 * POOLS API
 *
 *
 */
module.exports = {
    name: 'pool_api',

    methods: {
        create_pool: {
            doc: 'Create Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['pool'],
                properties: {
                    pool: {
                        $ref: '/pool_api/definitions/pool_definition'
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

        list_pool_nodes: {
            doc: 'List Pool Nodes',
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
                $ref: '/pool_api/definitions/pool_definition'
            },
            auth: {
                system: 'admin'
            }
        },

        read_pool: {
            doc: 'Read Pool Information',
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
                $ref: '/pool_api/definitions/pool_extended_info'
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
        },

        get_associated_buckets: {
            doc: 'Return list of buckets which are using this pool',
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
                type: 'array',
                items: {
                    type: 'string'
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
                    items: {
                        type: 'object',
                        required: ['node'],
                        properties: {
                            node: {
                                type: 'string',
                            },
                        }
                    }
                }
            }
        },

        pool_extended_info: {
            type: 'object',
            required: ['name', 'nodes', 'storage'],
            properties: {
                name: {
                    type: 'string'
                },
                nodes: {
                    $ref: '/system_api/definitions/nodes_info'
                },
                storage: {
                    $ref: '/common_api/definitions/storage_info'
                },
            },
        },

        pools_info: {
            type: 'object',
            required: ['pools'],
            properties: {
                pools: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['name', 'nodes_count'],
                        properties: {
                            name: {
                                type: 'string',
                            },
                            nodes_count: {
                                type: 'integer',
                            },
                        }
                    }
                }
            }
        },
    }
};
