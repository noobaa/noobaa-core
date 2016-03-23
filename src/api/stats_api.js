'use strict';

/**
 *
 * STATS API
 *
 *
 */
module.exports = {

    id: 'stats_api',

    methods: {

        get_systems_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/systems_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_nodes_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/nodes_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_ops_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/ops_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_all_stats: {
            method: 'GET',
            reply: {
                $ref: '#/definitions/all_stats'
            },
            auth: {
                system: 'admin'
            }
        },
    },

    definitions: {

        systems_stats: {
            type: 'object',
            required: ['version', 'agent_version', 'count'],
            properties: {
                clusterid: {
                    type: 'string',
                },
                version: {
                    type: 'string',
                },
                agent_version: {
                    type: 'string',
                },
                count: {
                    type: 'integer'
                },
                systems: {
                    type: 'array',
                    items: {
                        type: 'object',
                        // required: [],
                        properties: {
                            tiers: {
                                type: 'integer'
                            },
                            buckets: {
                                type: 'integer'
                            },
                            chunks: {
                                type: 'integer'
                            },
                            objects: {
                                type: 'integer'
                            },
                            roles: {
                                type: 'integer'
                            },
                            allocated_space: {
                                type: 'integer'
                            },
                            used_space: {
                                type: 'integer'
                            },
                            total_space: {
                                type: 'integer'
                            },
                            associated_nodes: {
                                type: 'object',
                                properties: {
                                    on: {
                                        type: 'integer'
                                    },
                                    off: {
                                        type: 'integer'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        nodes_stats: {
            type: 'object',
            required: ['count', 'os'],
            properties: {
                count: {
                    type: 'integer'
                },
                os: {
                    type: 'object',
                    properties: {
                        win: {
                            type: 'integer'
                        },
                        osx: {
                            type: 'integer'
                        },
                        linux: {
                            type: 'integer'
                        },
                        other: {
                            type: 'integer'
                        }
                    }
                },
                histograms: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                }
            }
        },

        ops_stats: {
            type: 'object',
            properties: {
                deletes: {
                    type: 'integer'
                },
                writes: {
                    type: 'integer'
                },
                reads: {
                    type: 'integer'
                },
                list_objects: {
                    type: 'integer'
                },
            }
        },

        pools_stats: {
            type: 'array',
            items: {
                type: 'integer',
            },
        },

        tier_stats: {
            type: 'array',
            items: {
                type: 'object',
                // required: [],
                properties: {
                    pools_num: {
                        type: 'integer',
                    },
                    data_placement: {
                        type: 'string',
                    }
                },
            }
        },

        all_stats: {
            type: 'object',
            required: ['systems_stats', 'nodes_stats', 'ops_stats'],
            properties: {
                systems_stats: {
                    $ref: '#/definitions/systems_stats'
                },
                nodes_stats: {
                    $ref: '#/definitions/nodes_stats'
                },
                ops_stats: {
                    $ref: '#/definitions/ops_stats'
                },
                pools_stats: {
                    $ref: '#/definitions/pools_stats'
                },
                tier_stats: {
                    $ref: '#/definitions/tier_stats'
                },
            }
        },
    },

};
