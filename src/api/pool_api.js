'use strict';

/**
 *
 * POOLS API
 *
 *
 */
module.exports = {

    id: 'pool_api',

    methods: {

        create_pool: {
            doc: 'Create Pool',
            method: 'POST',
            params: {
                $ref: '#/definitions/pool_definition'
            },
            auth: {
                system: 'admin'
            }
        },

        create_cloud_pool: {
            doc: 'Create Cloud Pool',
            method: 'POST',
            params: {
                $ref: '#/definitions/cloud_pool_definition'
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
                required: ['name'],
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
                $ref: '#/definitions/pool_definition'
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
                $ref: '#/definitions/pool_extended_info'
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

        delete_cloud_pool: {
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

        assign_nodes_to_pool: {
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
                            $ref: 'node_api#/definitions/node_identity'
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
                        $ref: 'node_api#/definitions/node_identity'
                    }
                }
            }
        },

        cloud_pool_definition: {
            type: 'object',
            required: ['name', 'cloud_info'],
            properties: {
                name: {
                    type: 'string',
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


        pool_extended_info: {
            type: 'object',
            required: ['name', 'nodes', 'storage'],
            properties: {
                name: {
                    type: 'string'
                },
                nodes: {
                    $ref: 'node_api#/definitions/nodes_aggregate_info'
                },
                storage: {
                    $ref: 'common_api#/definitions/storage_info'
                },
                undeletable: {
                    $ref: 'common_api#/definitions/undeletable_enum'
                }
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
