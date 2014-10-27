// this module is written for both nodejs, or for client with browserify.
'use strict';

var restful_api = require('../util/restful_api');


module.exports = restful_api({

    name: 'mgmt_api',

    methods: {

        system_stats: {
            method: 'GET',
            path: '/stats',
            reply: {
                type: 'object',
                required: ['allocated_storage', 'used_storage', 'counters'],
                properties: {
                    allocated_storage: {
                        type: 'integer',
                    },
                    used_storage: {
                        type: 'integer',
                    },
                    counters: {
                        type: 'object',
                        required: [
                            'accounts', 'nodes',
                            'buckets', 'objects',
                            'parts', 'chunks', 'blocks'
                        ],
                        properties: {
                            accounts: {
                                type: 'integer'
                            },
                            nodes: {
                                type: 'integer'
                            },
                            buckets: {
                                type: 'integer'
                            },
                            objects: {
                                type: 'integer'
                            },
                            parts: {
                                type: 'integer'
                            },
                            chunks: {
                                type: 'integer'
                            },
                            blocks: {
                                type: 'integer'
                            },
                        }
                    },
                }
            },
        },


        list_nodes: {
            method: 'GET',
            path: '/nodes',
            reply: {
                type: 'object',
                required: ['nodes'],
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: [
                                'name', 'ip', 'port', 'heatbeat',
                                'allocated_storage', 'used_storage'
                            ],
                            properties: {
                                name: {
                                    type: 'string'
                                },
                                ip: {
                                    type: 'string'
                                },
                                port: {
                                    type: 'integer'
                                },
                                heatbeat: {
                                    type: 'string',
                                    format: 'date',
                                },
                                allocated_storage: {
                                    type: 'integer'
                                },
                                used_storage: {
                                    type: 'integer'
                                },
                            }
                        }
                    }
                }
            }
        },


        list_node_blocks: {
            method: 'GET',
            path: '/node/:node_id/blocks',
            params: {
                type: 'object',
                required: ['node_id'],
                properties: {
                    node_id: {
                        type: 'string'
                    }
                }
            }
        },


        setup_nodes: {
            method: 'POST',
            path: '/nodes',
            params: {
                type: 'object',
                required: ['num', 'reset'],
                properties: {
                    num: {
                        type: 'integer'
                    },
                    reset: {
                        type: 'boolean'
                    },
                }
            }
        },

        start_node_agents: {
            method: 'POST',
            path: '/nodes/start',
            params: {
                type: 'object',
                required: [],
                properties: {}
            }
        },

        stop_node_agents: {
            method: 'POST',
            path: '/nodes/stop',
            params: {
                type: 'object',
                required: [],
                properties: {}
            }
        },

    }

});
