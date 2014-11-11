'use strict';

var restful_api = require('../util/restful_api');

module.exports = restful_api({

    name: 'edge_node_api',

    methods: {

        create_node: {
            method: 'POST',
            path: '/node',
            params: {
                type: 'object',
                required: ['name', 'geolocation', 'allocated_storage'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    geolocation: {
                        type: 'string',
                    },
                    allocated_storage: {
                        type: 'integer'
                    },
                    vendor: {
                        type: 'string'
                    },
                    vendor_node_id: {
                        type: 'string'
                    }
                }
            },
        },

        delete_node: {
            method: 'DELETE',
            path: '/node/:name',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
        },

        read_node: {
            method: 'GET',
            path: '/node/:name',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    }
                }
            },
            reply: {
                $ref: '/edge_node_api/definitions/node_info'
            }
        },


        list_nodes: {
            method: 'GET',
            path: '/node',
            params: {
                type: 'object',
                required: [],
                properties: {
                    query: {
                        type: 'object',
                        required: [],
                        properties: {
                            name: {
                                // regexp
                                type: 'string'
                            },
                            geolocation: {
                                // regexp
                                type: 'string'
                            },
                            vendor: {
                                type: 'string'
                            }
                        }
                    },
                    skip: {
                        type: 'integer'
                    },
                    limit: {
                        type: 'integer'
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['nodes'],
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            $ref: '/edge_node_api/definitions/node_info'
                        }
                    }
                }
            }
        },

        nodes_stats: {
            method: 'GET',
            path: '/nodes_stats',
            params: {
                type: 'object',
                required: [],
                properties: {
                    group_by: {
                        type: 'object',
                        required: [],
                        properties: {
                            geolocation: {
                                type: 'boolean'
                            },
                            vendor: {
                                type: 'boolean'
                            }
                        }
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['groups'],
                properties: {
                    groups: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['count'],
                            properties: {
                                geolocation: {
                                    type: 'string'
                                },
                                vendor: {
                                    type: 'string'
                                },
                                count: {
                                    type: 'integer'
                                },
                                allocated_storage: {
                                    $ref: '/account_api/definitions/bigint'
                                },
                                used_storage: {
                                    $ref: '/account_api/definitions/bigint'
                                },
                            }
                        }
                    }
                }
            }
        },


        heartbeat: {
            method: 'PUT',
            path: '/node/:name',
            params: {
                $ref: '/edge_node_api/definitions/node_info'
            },
            reply: {
                $ref: '/edge_node_api/definitions/node_info'
            },
        },


        get_agents_status: {
            method: 'GET',
            path: '/agents/',
            params: {
                type: 'object',
                required: ['nodes'],
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'string', // node name
                        }
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['nodes'],
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['status'],
                            properties: {
                                status: {
                                    type: 'boolean',
                                },
                            },
                        }
                    }
                }
            },
        },

        start_agents: {
            method: 'POST',
            path: '/agents',
            params: {
                type: 'object',
                required: ['nodes'],
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'string', // node name
                        }
                    }
                }
            }
        },

        stop_agents: {
            method: 'PUT',
            path: '/agents',
            params: {
                type: 'object',
                required: ['nodes'],
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'string', // node name
                        }
                    }
                }
            }
        },

        get_node_vendors: {
            method: 'GET',
            path: '/node_vendor',
            reply: {
                type: 'object',
                required: ['vendors'],
                properties: {
                    vendors: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['id', 'kind'],
                            properties: {
                                id: {
                                    type: 'string',
                                },
                                name: {
                                    type: 'string',
                                },
                                kind: {
                                    type: 'string',
                                }
                            }
                        }
                    }
                }
            }
        },

        connect_node_vendor: {
            method: 'POST',
            path: '/node_vendor',
            params: {
                type: 'object',
                required: ['name', 'kind', 'info'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    kind: {
                        type: 'string',
                    },
                    info: {
                        type: 'object',
                        additionalProperties: true,
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['id', 'name', 'kind'],
                properties: {
                    id: {
                        type: 'string',
                    },
                    name: {
                        type: 'string',
                    },
                    kind: {
                        type: 'string',
                    },
                }
            }
        }


    },


    ////////////////////////////////
    // general schema definitions //
    ////////////////////////////////

    definitions: {

        node_info: {
            type: 'object',
            required: [
                'name',
                'geolocation',
                'ip',
                'port',
                'heartbeat',
                'allocated_storage',
                'used_storage',
                'system_info',
            ],
            properties: {
                name: {
                    type: 'string'
                },
                geolocation: {
                    type: 'string'
                },
                ip: {
                    type: 'string'
                },
                port: {
                    type: 'integer'
                },
                heartbeat: {
                    type: 'string',
                    format: 'date',
                },
                allocated_storage: {
                    type: 'integer'
                },
                used_storage: {
                    type: 'integer'
                },
                vendor: {
                    type: 'string'
                },
                vendor_node_id: {
                    type: 'string'
                },
                system_info: {
                    type: 'object',
                    required: ['os'],
                    properties: {
                        os: {
                            type: 'object',
                            additionalProperties: true,
                        }
                    }
                }
            }
        }

    }

});
