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
                $ref: '/node_api/definitions/node_config'
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


        update_node: {
            method: 'PUT',
            path: '/node/:name',
            params: {
                $ref: '/node_api/definitions/node_config'
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
                            tier: {
                                type: 'string'
                            },
                            name: {
                                // regexp
                                type: 'string'
                            },
                            geolocation: {
                                // regexp
                                type: 'string'
                            },
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
                            tier: {
                                type: 'boolean'
                            },
                            geolocation: {
                                type: 'boolean'
                            },
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
                                tier: {
                                    type: 'string'
                                },
                                geolocation: {
                                    type: 'string'
                                },
                                count: {
                                    type: 'integer'
                                },
                                storage: {
                                    $ref: '/system_api/definitions/storage_info'
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



        ///////////////
        // HEARTBEAT //
        ///////////////

        heartbeat: {
            method: 'PUT',
            path: '/heartbeat/:name',
            params: {
                $ref: '/node_api/definitions/node_info'
            },
            reply: {
                $ref: '/node_api/definitions/node_info'
            },
        },


    },


    ////////////////////////////////
    // general schema definitions //
    ////////////////////////////////

    definitions: {

        node_config: {
            type: 'object',
            required: ['name', 'tier', 'geolocation', 'storage_alloc'],
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
                storage_alloc: {
                    type: 'integer'
                },
            }
        },


        node_info: {
            type: 'object',
            required: [
                'name',
                'geolocation',
                'ip',
                'port',
                'online',
                'heartbeat',
                'storage',
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
                online: {
                    type: 'boolean',
                },
                heartbeat: {
                    type: 'string',
                    format: 'date',
                },
                storage: {
                    $ref: '/system_api/definitions/storage_info'
                },
                device_info: {
                    type: 'object',
                    additionalProperties: true,
                }
            }
        }

    }

});
