/* Copyright (C) 2016 NooBaa */
/**
 *
 * HOST API
 *
 */
'use strict';


module.exports = {

    id: 'host_api',

    methods: {


        read_host: {
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    host_name: {
                        type: 'string'
                    },
                },
            },
            reply: {
                $ref: '#/definitions/host_info'
            },
            auth: {
                system: 'admin'
            }
        },

        list_hosts: {
            method: 'GET',
            params: {
                type: 'object',
                // required: [],
                properties: {
                    query: {
                        $ref: '#/definitions/hosts_query'
                    },
                    skip: {
                        type: 'integer'
                    },
                    limit: {
                        type: 'integer'
                    },
                    pagination: {
                        type: 'boolean'
                    },
                    sort: {
                        type: 'string',
                        enum: [
                            'name',
                            'ip',
                            'online',
                            'used',
                            'trusted',
                            'accessibility',
                            'connectivity',
                            'data_activity',
                            'mode'
                        ]
                    },
                    order: {
                        type: 'integer',
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['hosts'],
                properties: {
                    total_count: {
                        type: 'integer'
                    },
                    filter_counts: {
                        $ref: '#/definitions/hosts_aggregate_info'
                    },
                    hosts: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/host_info'
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_host_services: {
            method: 'DELETE',
            params: {
                type: 'object',
                properties: {
                    updates: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['node', 'enabled'],
                            properties: {
                                node: {
                                    $ref: 'node_api#/definitions/node_identity'
                                },
                                enabled: {
                                    type: 'boolean'
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


        migrate_hosts_to_pool: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['hosts', 'pool_id'],
                properties: {
                    hosts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                host_name: {
                                    type: 'string'
                                },
                            },
                        }
                    },
                    pool_id: {
                        type: 'string'
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },


        // get_test_hosts: {
        //     method: 'GET',
        //     params: {
        //         type: 'object',
        //         required: ['count', 'source'],
        //         properties: {
        //             count: {
        //                 type: 'integer',
        //             },
        //             source: {
        //                 type: 'string',
        //             },
        //         }
        //     },
        //     reply: {
        //         type: 'array',
        //         items: {
        //             type: 'object',
        //             required: ['name', 'rpc_address'],
        //             properties: {
        //                 name: {
        //                     type: 'string'
        //                 },
        //                 rpc_address: {
        //                     type: 'string'
        //                 }
        //             }
        //         }
        //     },
        //     auth: {
        //         system: 'admin',
        //     }
        // },


    },


    definitions: {

        host_info: {
            type: 'object',
            required: ['host_info', 'storage_nodes_info', 's3_nodes_info'],
            properties: {

                // TODO: change host_info to hold only the neccessary fields. node_info contains
                // many unnecessary fields
                host_info: {
                    $ref: 'node_api#/definitions/node_info',
                },
                storage_nodes_info: {
                    type: 'array',
                    items: {
                        $ref: 'node_api#/definitions/node_info'
                    }
                },
                s3_nodes_info: {
                    type: 'array',
                    items: {
                        $ref: 'node_api#/definitions/node_info'
                    }
                },
            }
        },

        hosts_aggregate_info: {
            $ref: 'node_api#/definitions/nodes_aggregate_info'
        },

        hosts_query: {
            $ref: 'node_api#/definitions/nodes_query'
        }



    }

};
