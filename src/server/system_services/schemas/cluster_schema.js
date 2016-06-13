'use strict';

module.exports = {
    id: 'cluster_schema',
    type: 'object',
    required: [
        'owner_secret',
        'cluster_id',
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        is_clusterized: {
            type: 'boolean'
        },
        owner_secret: {
            type: 'string'
        },
        cluster_id: {
            type: 'string'
        },
        owner_address: {
            type: 'string',
        },
        shards: {
            type: 'array',
            items: {
                type: 'object',
                required: ['shardname'],
                properties: {
                    shardname: {
                        type: 'string',
                    },
                    servers: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['address'],
                            properties: {
                                address: {
                                    type: 'string',
                                },
                            },
                        },
                    },
                },
            },
        },
        config_servers: {
            type: 'array',
            items: {
                type: 'object',
                required: ['address'],
                properties: {
                    address: {
                        type: 'string',
                    },
                },
            },
        },
    }
};
