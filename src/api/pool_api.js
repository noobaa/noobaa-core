/* Copyright (C) 2016 NooBaa */
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
        create_nodes_pool: {
            doc: 'Create Pool',
            method: 'POST',
            params: {
                $ref: '#/definitions/pool_definition'
            },
            auth: {
                system: 'admin'
            }
        },

        create_hosts_pool: {
            doc: 'Create Hosts Pool',
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string'
                    },
                    hosts: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }
                }

            },
            auth: {
                system: 'admin'
            }
        },

        create_cloud_pool: {
            doc: 'Create Cloud Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'connection', 'target_bucket'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    connection: {
                        type: 'string',
                    },
                    target_bucket: {
                        type: 'string',
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        create_namespace_resource: {
            doc: 'Create Namespace Resource',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'connection', 'target_bucket'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    connection: {
                        type: 'string',
                    },
                    target_bucket: {
                        type: 'string',
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        create_mongo_pool: {
            doc: 'Create Mongo Pool',
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

        read_namespace_resource: {
            doc: 'Read Namespace Resource',
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
                $ref: '#/definitions/namespace_resource_info'
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

        delete_namespace_resource: {
            doc: 'Delete Namespace Resource',
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

        assign_hosts_to_pool: {
            doc: 'Add nodes to Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    hosts: {
                        type: 'array',
                        items: {
                            type: 'string'
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
        },

        get_pool_history: {
            doc: 'Return usage history for the specified pools',
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    pool_list: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['timestamp', 'pool_list'],
                    properties: {
                        timestamp: {
                            idate: true
                        },
                        pool_list: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['name', 'storage'],
                                properties: {
                                    name: {
                                        type: 'string'
                                    },
                                    storage: {
                                        $ref: 'common_api#/definitions/storage_info'
                                    },
                                    resource_type: {
                                        $ref: '#/definitions/resource_type'
                                    }
                                }
                            }
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },
        assign_pool_to_region: {
            doc: 'Add a region tag to a resource',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'region'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    region: {
                        type: 'string',
                    },
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

        namespace_resource_info: {
            type: 'object',
            required: ['name', 'endpoint_type', 'endpoint', 'target_bucket'],
            properties: {
                name: {
                    type: 'string'
                },
                endpoint: {
                    type: 'string'
                },
                endpoint_type: {
                    type: 'string',
                    enum: ['AWS', 'AZURE', 'S3_COMPATIBLE', 'NOOBAA', 'NET_STORAGE']
                },
                auth_method: {
                    $ref: 'common_api#/definitions/cloud_auth_method'
                },
                target_bucket: {
                    type: 'string'
                },
                cp_code: {
                    type: 'string'
                },
                identity: {
                    type: 'string'
                },
                mode: {
                    type: 'string',
                    enum: ['OPTIMAL']
                },
                undeletable: {
                    $ref: 'common_api#/definitions/undeletable_enum'
                },
            }
        },

        // Currently the extended info has an addition of secret_key
        namespace_resource_extended_info: {
            type: 'object',
            required: ['name', 'endpoint_type', 'endpoint', 'target_bucket'],
            properties: {
                name: {
                    type: 'string'
                },
                endpoint: {
                    type: 'string'
                },
                endpoint_type: {
                    type: 'string',
                    enum: ['AWS', 'AZURE', 'S3_COMPATIBLE', 'NOOBAA', 'NET_STORAGE']
                },
                auth_method: {
                    $ref: 'common_api#/definitions/cloud_auth_method'
                },
                target_bucket: {
                    type: 'string'
                },
                access_key: {
                    type: 'string'
                },
                cp_code: {
                    type: 'string'
                },
                secret_key: {
                    type: 'string'
                }
            }
        },

        pool_extended_info: {
            type: 'object',
            required: ['name', 'storage', 'associated_accounts', 'resource_type'],
            properties: {
                name: {
                    type: 'string'
                },
                nodes: {
                    $ref: 'node_api#/definitions/nodes_aggregate_info'
                },
                storage_nodes: {
                    $ref: 'node_api#/definitions/nodes_aggregate_info'
                },
                s3_nodes: {
                    $ref: 'node_api#/definitions/nodes_aggregate_info'
                },
                hosts: {
                    type: 'object',
                    properties: {
                        count: {
                            type: 'integer',
                        },
                        by_mode: {
                            type: 'object',
                            additionalProperties: true,
                            properties: {},
                        },
                        by_service: {
                            type: 'object',
                            properties: {
                                STORAGE: {
                                    type: 'integer',
                                },
                                GATEWAY: {
                                    type: 'integer',
                                }
                            }
                        }

                    }

                },
                storage: {
                    $ref: 'common_api#/definitions/storage_info'
                },
                undeletable: {
                    $ref: 'common_api#/definitions/undeletable_enum'
                },
                data_activities: {
                    type: 'object',
                    properties: {
                        host_count: {
                            type: 'integer'
                        },
                        activities: {
                            $ref: 'node_api#/definitions/data_activities'
                        }
                    }
                },
                cloud_info: {
                    type: 'object',
                    properties: {
                        endpoint: {
                            type: 'string'
                        },
                        endpoint_type: {
                            type: 'string',
                            enum: ['AWS', 'AZURE', 'S3_COMPATIBLE', 'GOOGLE', 'FLASHBLADE']
                        },
                        target_bucket: {
                            type: 'string'
                        },
                        auth_method: {
                            $ref: 'common_api#/definitions/cloud_auth_method'
                        }
                    }
                },
                mongo_info: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {},
                },
                pool_node_type: {
                    $ref: 'common_api#/definitions/node_type'
                },
                resource_type: {
                    $ref: '#/definitions/resource_type'
                },
                mode: {
                    $ref: '#/definitions/pool_mode'
                },
                associated_accounts: {
                    type: 'array',
                    items: {
                        type: 'string',
                    }
                },
                region: {
                    type: 'string'
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

        resource_type: {
            type: 'string',
            enum: ['HOSTS', 'CLOUD', 'INTERNAL']
        },

        pool_mode: {
            type: 'string',
            enum: [
                'HAS_NO_NODES',
                'ALL_NODES_OFFLINE',
                'NO_CAPACITY',
                'ALL_HOSTS_IN_PROCESS',
                'MOST_NODES_ISSUES',
                'MANY_NODES_ISSUES',
                'MOST_STORAGE_ISSUES',
                'MANY_STORAGE_ISSUES',
                'MOST_S3_ISSUES',
                'MANY_S3_ISSUES',
                'MANY_NODES_OFFLINE',
                'LOW_CAPACITY',
                'HIGH_DATA_ACTIVITY',
                'IO_ERRORS',
                'STORAGE_NOT_EXIST',
                'AUTH_FAILED',
                'INITIALIZING',
                'OPTIMAL'
            ]
        }
    }
};
