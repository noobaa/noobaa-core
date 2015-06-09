'use strict';

/**
 *
 * STATS API
 *
 *
 */
module.exports = {

    name: 'stats_api',

    methods: {

        get_systems_stats: {
            method: 'GET',
            reply: {
                $ref: '/stats_api/definitions/systems_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_nodes_stats: {
            method: 'GET',
            reply: {
                $ref: '/stats_api/definitions/nodes_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_ops_stats: {
            method: 'GET',
            reply: {
                $ref: '/stats_api/definitions/ops_stats'
            },
            auth: {
                system: 'admin'
            }
        },

        get_all_stats: {
            method: 'GET',
            reply: {
                $ref: '/stats_api/definitions/all_stats'
            },
            auth: {
                system: 'admin'
            }
        },
    },

    definitions: {

        systems_stats: {
            type: 'object',
            required: ['installid', 'version', 'agent_version', 'count'],
            properties: {
                installid: {
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
                        required: [],
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
            required: ['count', 'avg_allocation', 'avg_usage', 'avg_uptime'],
            properties: {
                count: {
                    type: 'integer'
                },
                avg_allocation: {
                    type: 'integer'
                },
                avg_usage: {
                    type: 'integer'
                },
                avg_uptime: {
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
                        }
                    }
                }
            }
        },

        ops_stats: {
            type: 'object',
            required: ['deletes', 'writes', 'reads', 'list_objects'],
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

        all_stats: {
            type: 'object',
            equired: ['systems_stats', 'nodes_stats', 'ops_stats'],
            properties: {
                systems_stats: {
                    $ref: '/stats_api/definitions/systems_stats'
                },
                nodes_stats: {
                    $ref: '/stats_api/definitions/nodes_stats'
                },
                ops_stats: {
                    $ref: '/stats_api/definitions/ops_stats'
                },
            }
        },
    },

};
