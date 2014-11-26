'use strict';

var rest_api = require('../util/rest_api');

module.exports = rest_api({

    name: 'node_api',

    methods: {


        //////////
        // CRUD //
        //////////

        create_node: {
            method: 'POST',
            path: '/node',
            params: {
                type: 'object',
                required: ['name', 'tier', 'geolocation', 'allocated_storage'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    tier: {
                        type: 'string',
                    },
                    is_server: {
                        type: 'boolean',
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
                $ref: '/node_api/definitions/node_info'
            }
        },


        //////////
        // LIST //
        //////////

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
                            $ref: '/node_api/definitions/node_info'
                        }
                    }
                }
            }
        },


        ///////////
        // GROUP //
        ///////////

        group_nodes: {
            method: 'GET',
            path: '/group',
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
                                    $ref: '/system_api/definitions/bigint'
                                },
                                used_storage: {
                                    $ref: '/system_api/definitions/bigint'
                                },
                            }
                        }
                    }
                }
            }
        },


        ////////////////
        // START STOP //
        ////////////////

        start_nodes: {
            method: 'POST',
            path: '/start',
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

        stop_nodes: {
            method: 'POST',
            path: '/stop',
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


        // TODO is this still needed as api method?
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



        /////////////////////
        // apis for agents //
        /////////////////////

        heartbeat: {
            method: 'PUT',
            path: '/node/:name',
            params: {
                $ref: '/node_api/definitions/node_info'
            },
            reply: {
                $ref: '/node_api/definitions/node_info'
            },
        },

        ///////////////////////////
        // apis for node vendors //
        ///////////////////////////

        connect_node_vendor: {
            method: 'POST',
            path: '/node_vendor',
            params: {
                type: 'object',
                required: ['name', 'category', 'kind', 'details'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    // TODO revise this func and params
                    category: {
                        type: 'string',
                    },
                    kind: {
                        type: 'string',
                    },
                    details: {
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
                'started',
                'online',
                'heartbeat',
                'allocated_storage',
                'used_storage',
                'device_info',
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
                started: {
                    type: 'boolean',
                },
                online: {
                    type: 'boolean',
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
                device_info: {
                    type: 'object',
                    additionalProperties: true,
                }
            }
        }

    }

});
